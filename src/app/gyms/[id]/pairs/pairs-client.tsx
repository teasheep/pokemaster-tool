"use client";

// 道館拍組 — 這頁回答兩件事:
//   1. 這個屬性該練什麼 (★ 道館拍組名單, 管理員維護)
//   2. 全館練到哪 (每張卡下面的 n/20 持有人數, 點卡看名單)
//
// 互動與全站一致: 卡片牆 (PairTypeGrid) + 共用篩選列 (PairFilterBar) + 點卡開側板。
// 「範圍」切換 = 道館拍組 / 全圖鑑, 跟「我的拍組 / 所有拍組」同一個心智模型:
// 管理員在全圖鑑點灰卡開側板, 按 ★ 就加進名單 — 不需要另一個搜尋新增面板。

import { memo, useCallback, useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SidePanel } from "@/components/ui/side-panel";
import { GradeBadge } from "@/components/gym/gym-ui";
import { PairTypeGrid, type GridItem } from "@/components/gym/pair-type-grid";
import { PairFilterBar } from "@/components/pair-filter-bar";
import { TypeBadge } from "@/components/sync-pair-badges";
import { REGION_ORDER } from "@/data/sync-pairs";
import { MemberAvatar, memberLabel } from "@/components/gym/member-card";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { pairName, type PairSortKey } from "@/lib/pairs/name";
import {
  EMPTY_PAIR_FILTERS,
  matchesPairFilters,
  type PairFilters,
} from "@/lib/pairs/filter";
import { setGymPair } from "@/lib/gym/gym-pairs-client";
import { createClient } from "@/lib/supabase/client";
import { normPairKey } from "@/lib/gym/types";
import type { SyncPairType } from "@/lib/supabase/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

export type GymPairRow = {
  id: string;
  pair_label: string;
  pair_id: string | null;
  type: SyncPairType;
};

/**
 * 全館持有 (member_pairs, grade>=1) 的**傳輸形狀**。
 *
 * 原始的一列一物件 `{member_id, pair_id, grade}` 在這個道館是 2047 列 = RSC prop 174KB,
 * 而其中九成是「同一組 36 字元 member uuid 重複兩千次」。改成下面這種索引式之後
 * 同一份資料是 12.1KB (實測), 資訊一位元都沒少 — 解回來的 gradeMap 與舊版逐列建的完全一樣。
 * pair_label 一樣不取 (它只在 pair_id 為 null 時當 fallback, 那種列查詢就濾掉了)。
 *
 * pack 在 server 端 (`gyms/[id]/members/page.tsx`), unpack 在下面的 `gradeMap` —
 * **兩邊一起改**。
 */
export type PackedGrades = {
  /** 成員 id; 陣列位置 = 下面 byPair 用的索引 */
  memberIds: string[];
  /** pairId → [成員索引, 練度, 成員索引, 練度, …] */
  byPair: Record<string, number[]>;
};

type Props = {
  /** 網址帶來的初始範圍 — 重新整理要留在原本的畫面 (見 lib/use-url-state.ts) */
  initialScope?: "gym" | "all";
  gymId: string;
  isAdmin: boolean;
  members: { id: string; displayName: string; lineName: string | null; avatarUrl?: string | null }[];
  gymPairs: GymPairRow[];
  grades: PackedGrades;
  /** 圖鑑: 道館名單 ∪ 全館持有 的子集; 勾到「所有遊戲拍組」時由呼叫端補成整本 */
  catalog: ClientPairRecord[];
  /** catalog 已經是整本 645 筆 (= 不必再抓) */
  catalogIsFull?: boolean;
  /** 整本圖鑑正在抓 (呼叫端的狀態, 分頁按鈕要顯示回饋) */
  fullCatalogLoading?: boolean;
  /** 切到「所有遊戲拍組」前先把整本抓回來; 回傳 false = 失敗 (呼叫端已 toast) */
  onNeedFullCatalog?: () => Promise<boolean>;
};

// 卡片/側板的識別鍵。注意 grades 現在只用 pair_id 當鍵 (members/page.tsx 的查詢不再取
// pair_label), 所以 label 那條分支只剩「識別」用途 — 對 pair_id 為 null 的舊列查持有人數
// 一律是 0 人。這是刻意的 (線上實測沒有那種列); 要恢復就得先把 pair_label 加回那支查詢。
const pairKey = (pairId: string | null, label: string) => pairId ?? normPairKey(label);

/**
 * 全館持有率 — 這頁的卡片底下放的是「20 人中幾人有」, 不是個人寶數。
 * 用一條長條 + 數字, 讓它跟「我的拍組」那種個人卡一眼就分得出來。
 */
const CoverageBar = memo(function CoverageBar({
  count,
  total,
}: {
  count: number;
  total: number;
}) {
  const ratio = total > 0 ? count / total : 0;
  const tone =
    ratio === 1
      ? "bg-emerald-500"
      : ratio >= 0.5
        ? "bg-sky-500"
        : ratio > 0
          ? "bg-amber-500"
          : "bg-muted-foreground/30";
  return (
    <div className="mt-0.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      {/* 手機字級下限 12px (卡片寬 96px, 放得下「20/20」) */}
      <div className="tabular-nums text-[10px] text-muted-foreground max-sm:text-xs">
        <span className="font-medium text-foreground">{count}</span>/{total}
      </div>
    </div>
  );
});

export function GymPairsClient({
  initialScope = "gym",
  gymId,
  isAdmin,
  members,
  gymPairs,
  grades,
  catalog,
  catalogIsFull,
  fullCatalogLoading,
  onNeedFullCatalog,
}: Props) {
  const router = useRouter();
  const pairById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  const [filters, setFilters] = useState<PairFilters>(EMPTY_PAIR_FILTERS);
  // 篩選延後處理: 打字/點 chip 即時更新控制項, 600+ 卡重篩交給 React 排程
  const deferredFilters = useDeferredValue(filters);
  const [sortBy, setSortBy] = useState<PairSortKey>("release-desc");
  /** 範圍: 道館拍組 (★ 名單) / 全圖鑑 */
  const [scope, setScope] = useState<"gym" | "all">(initialScope);
  // 重新整理留在原本的範圍 (與成員視角共用同一個 ?scope=)
  useUrlState({ scope: scope === "all" ? "all" : null });
  /** 切範圍要對整份圖鑑重算 → 丟進 transition, 用 pending 讓卡牆淡一下 */
  const [scopePending, startScopeTransition] = useTransition();

  /**
   * 切分頁 —— 「所有遊戲拍組」需要整本圖鑑, 而頁面只送子集 (道館名單 ∪ 全館持有)。
   * **抓回來才切**: 先切過去再慢慢補會出現一份「只有 146 隻」的假清單, 使用者會以為
   * 那隻拍組不存在。抓失敗就留在原分頁 (呼叫端已經 toast), 入口不會變成空的/半套的。
   */
  async function switchScope(next: "gym" | "all") {
    if (next === "all" && !catalogIsFull && onNeedFullCatalog) {
      if (!(await onNeedFullCatalog())) return;
    }
    startScopeTransition(() => setScope(next));
  }
  /** 側板開在哪張卡 (key 與卡片牆一致) */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /** 點卡片 = 開側板。grid 級穩定 handler — 開側板時卡牆才不會整面重畫 */
  const onSelectCard = useCallback((key: string) => setExpandedKey(key), []);

  /** 道館名單 (樂觀更新, 側板按 ★ 即時反映) */
  const [gymSet, setGymSet] = useState<Set<string>>(
    () => new Set(gymPairs.map((p) => p.pair_id).filter((v): v is string => !!v))
  );

  /** 持有名單一律「頭像 + memberLabel」→ 這裡要整筆成員資料, 不能只留名字 */
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // 地區選項吃 REGION_ORDER 全集 (世代順序), 不從 catalog 推導 —
  // 這頁的 catalog 是子集, 推導會讓「所有遊戲拍組」還沒抓回來時少掉幾個地區選項。
  const regions = useMemo(() => [...REGION_ORDER], []);

  // pairId → memberId → grade (PackedGrades 的還原; server 端的 pack 在 members/page.tsx)
  const gradeMap = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const [pairId, flat] of Object.entries(grades.byPair)) {
      const inner = new Map<string, number>();
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const memberId = grades.memberIds[flat[i]];
        if (memberId) inner.set(memberId, flat[i + 1]);
      }
      m.set(pairId, inner);
    }
    return m;
  }, [grades]);

  /** 圖鑑外的舊匯入資料 (只有名字, 對不到卡圖) — 只在道館名單範圍出現 */
  const orphanRows = useMemo(
    () => gymPairs.filter((p) => !p.pair_id || !pairById.has(p.pair_id)),
    [gymPairs, pairById]
  );

  const q = deferredFilters.search.trim().toLowerCase();

  /** 目前範圍內、通過篩選的圖鑑拍組 */
  const shown = useMemo(() => {
    return catalog.filter((c) => {
      if (scope === "gym" && !gymSet.has(c.pairId)) return false;
      if (!matchesPairFilters(c, deferredFilters, q)) return false;
      return true;
    });
  }, [catalog, scope, gymSet, deferredFilters, q]);

  /** 清單還是舊的 (重篩/切範圍還在算) → 卡牆淡一下, 才不會看起來像沒反應 */
  const stale = deferredFilters !== filters || scopePending;

  const gridItems: GridItem[] = useMemo(() => {
    const items: GridItem[] = shown.map((pair) => {
      const owners = gradeMap.get(pair.pairId);
      const ownerCount = owners?.size ?? 0;
      const inGym = gymSet.has(pair.pairId);
      // 全館視角的寶數 = 持有者裡最高的那一個 (使用者指定); 下方長條講的是有幾人有
      const best = Math.max(0, ...(owners ? [...owners.values()] : [0]));
      return {
        key: pair.pairId,
        type: pair.type as SyncPairType,
        pair,
        owned: ownerCount > 0,
        potential: best >= 6 ? 5 : best,
        superAwakening: best >= 6 ? 5 : 0,
        // 點擊交給 grid 級 onSelect (key 就是 pairId), item 上不掛閉包
        // 只有「全圖鑑」範圍需要標出哪些已在名單 (名單範圍內每張都是 ★, 標了只是雜訊)
        corner:
          scope === "all" && inGym ? (
            <span className="text-sm text-amber-400" title="已是道館拍組">
              ★
            </span>
          ) : null,
        footer: <CoverageBar count={ownerCount} total={members.length} />,
      };
    });
    if (scope === "gym") {
      for (const p of orphanRows) {
        if (q && !p.pair_label.toLowerCase().includes(q)) continue;
        const owners = gradeMap.get(pairKey(p.pair_id, p.pair_label));
        items.push({
          key: p.id,
          type: p.type,
          pair: null,
          fallbackLabel: p.pair_label,
          owned: (owners?.size ?? 0) > 0,
          footer: <CoverageBar count={owners?.size ?? 0} total={members.length} />,
        });
      }
    }
    return items;
  }, [shown, gradeMap, members.length, gymSet, scope, orphanRows, q]);

  /** 側板內容 (圖鑑拍組 or 圖鑑外的舊資料) */
  const detailPair = expandedKey ? (pairById.get(expandedKey) ?? null) : null;
  const detailOrphan = expandedKey ? (orphanRows.find((p) => p.id === expandedKey) ?? null) : null;
  const detailKey = detailPair
    ? detailPair.pairId
    : detailOrphan
      ? pairKey(detailOrphan.pair_id, detailOrphan.pair_label)
      : null;

  /** 管理員: ★ 設為 / 取消道館拍組 (全站同一條寫入路徑 setGymPair) */
  async function toggleGymPair(pair: ClientPairRecord) {
    const isIn = gymSet.has(pair.pairId);
    const apply = (add: boolean) =>
      setGymSet((prev) => {
        const next = new Set(prev);
        if (add) next.add(pair.pairId);
        else next.delete(pair.pairId);
        return next;
      });
    apply(!isIn);
    const ok = await setGymPair(createClient(), gymId, pair, !isIn);
    if (!ok) apply(isIn);
    else router.refresh();
  }

  return (
    <div className="space-y-3 sm:space-y-5">
      {/* 看哪一批 (分頁) 與 怎麼找 (工具列) 分開 — 原本擠在同一列, 不知道要點哪個。
          手機兩個分頁等寬填滿一列 (44px 高), 桌機維持左靠的底線分頁 */}
      <nav className="flex gap-1 border-b">
        {(["gym", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => void switchScope(v)}
            disabled={v === "all" && fullCatalogLoading}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-1 border-b-2 px-2 text-sm transition-colors",
              "sm:min-h-0 sm:flex-none sm:px-4 sm:py-2",
              scope === v
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {v === "gym" ? "道館拍組" : "所有遊戲拍組"}
            {/* 整本圖鑑按需載入 (只會抓一次) — 有回饋才不會像是點了沒反應 */}
            {v === "all" && fullCatalogLoading ? (
              <span className="text-xs text-muted-foreground">載入中…</span>
            ) : null}
          </button>
        ))}
      </nav>

      <PairFilterBar
        filters={filters}
        onChange={setFilters}
        regions={regions}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      {/* 卡片牆 (按屬性分組) — 淡化只作用在外層容器, 卡片外觀規格不動 */}
      <div
        className={cn("transition-opacity motion-reduce:transition-none", stale && "opacity-60")}
      >
        <PairTypeGrid
          items={gridItems}
          sortBy={sortBy}
          emptyText="沒有符合條件的拍組。"
          onSelect={onSelectCard}
        />
      </div>

      {/* 點卡片 → 詳情 (道館名單 / 持有名單) */}
      <SidePanel
        open={expandedKey !== null}
        onClose={() => setExpandedKey(null)}
        title={detailPair ? pairName(detailPair) : (detailOrphan?.pair_label.replace("&", " & ") ?? "")}
      >
        {detailKey ? (
          <div className="space-y-4">
            <TypeBadge type={(detailPair?.type as SyncPairType) ?? detailOrphan!.type} />

            {/* 道館拍組 = 一顆 ★ 開關 (與我的拍組側板同一套語意與文案) */}
            {detailPair ? (
              isAdmin ? (
                <button
                  onClick={() => void toggleGymPair(detailPair)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all active:scale-[0.99] pointer-coarse:min-h-11",
                    gymSet.has(detailPair.pairId)
                      ? "border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25"
                      : "hover:bg-accent"
                  )}
                >
                  <span className="text-base text-amber-600 dark:text-amber-400">
                    {gymSet.has(detailPair.pairId) ? "★" : "☆"}
                  </span>
                  <span className="font-medium">
                    {gymSet.has(detailPair.pairId) ? "已設為道館拍組" : "設為道館拍組"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {gymSet.has(detailPair.pairId) ? "點擊取消" : "全館持有統計與道館戰看板會納入"}
                  </span>
                </button>
              ) : gymSet.has(detailPair.pairId) ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="text-base text-amber-600 dark:text-amber-400">★</span>
                  <span className="font-medium">道館拍組</span>
                </div>
              ) : null
            ) : null}

            {(() => {
              const owners = gradeMap.get(detailKey);
              if (!owners || owners.size === 0) {
                return <p className="text-sm text-muted-foreground">全館無人持有。</p>;
              }
              return (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    持有 {owners.size} / {members.length} 人
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...owners.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([mid, grade]) => {
                        const m = memberById.get(mid);
                        return (
                          <span
                            key={mid}
                            className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs"
                          >
                            {/* 密集列的頭像 = 28px (AGENTS 指定) */}
                            {m ? <MemberAvatar member={m} size="sm" className="h-7 w-7" /> : null}
                            <span className="max-w-36 truncate">{m ? memberLabel(m) : "?"}</span>
                            <GradeBadge grade={grade} />
                          </span>
                        );
                      })}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
