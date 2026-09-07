"use client";

// 拍組頁 — 只處理「我自己」的拍組。三個子分頁:
//   我的道館拍組: 道館指定的名單全部列出, 我沒有的就是灰卡 (開賽前要補哪幾隻一目瞭然)
//   我的所有拍組: 我持有的全部
//   所有拍組圖鑑: 整份圖鑑 (訪客也能看)
// 別人的持有在「道館 → 成員」看; 這頁不放任何別人的資料。

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { Download, Layers } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { PageHeading } from "@/components/page-shell";
import { PairTypeGrid, type GridItem } from "@/components/gym/pair-type-grid";
import { PairEditPanel } from "@/components/pair-edit-panel";
import { PairFilterBar } from "@/components/pair-filter-bar";
import { ShareDialog } from "@/components/share-dialog";
import { ROLE_LABELS, TYPE_LABELS, roleAssetToRole } from "@/data/sync-pairs";
import { createClient } from "@/lib/supabase/client";
import type { SyncPairType } from "@/lib/supabase/types";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { CollectionEntry, CollectionMap } from "@/lib/collection";
import { syncMemberPair, type GymSyncInfo } from "@/lib/collection-sync";
import { pairName, type PairSortKey } from "@/lib/pairs/name";
import {
  EMPTY_PAIR_FILTERS,
  matchesPairFilters,
  type PairFilters,
} from "@/lib/pairs/filter";
import { cycleEntry, defaultEntry } from "@/lib/collection-entry";
import { setGymPair } from "@/lib/gym/gym-pairs-client";
import { cn } from "@/lib/utils";

type Props = {
  catalog: ClientPairRecord[];
  /** 是否登入 (訪客只有「所有拍組圖鑑」純瀏覽) */
  signedIn: boolean;
  initialCollection?: CollectionMap;
  /** 道館指定拍組的 pairId (目前道館) */
  gymPairIds?: string[];
  /** 自己在道館的身分 (改動時同步 member_pairs 用); null = 未入道館 */
  gymSync?: GymSyncInfo | null;
  /** ?tab= 深連結 */
  initialTab?: Tab | null;
  /** 道館管理員 (可在側板把拍組設為/取消道館拍組) */
  isGymAdmin?: boolean;
};

// 一筆收藏 = 練度 (CollectionEntry) + 圖鑑資料 (catalog) 合併後的顯示用 row
type OwnedRow = CollectionEntry & { pair: ClientPairRecord };

/** 子分頁 = 看哪一批拍組; 「只看我持有的」是獨立開關 (預設關 = 顯示全部) */
type Tab = "gym" | "all";

const TAB_LABELS: Record<Tab, string> = {
  gym: "道館重點拍組",
  all: "所有遊戲拍組",
};

export function PairsHub({
  catalog,
  signedIn,
  initialCollection = {},
  gymPairIds = [],
  gymSync = null,
  isGymAdmin = false,
  initialTab = null,
}: Props) {
  const [collection, setCollection] = useState<CollectionMap>(initialCollection);
  const hasGym = gymPairIds.length > 0;
  const [tab, setTab] = useState<Tab>(
    !signedIn || !hasGym ? "all" : (initialTab ?? "gym")
  );
  /** 只看我持有的 — 預設關 (顯示全部, 沒有的是灰卡) */
  const [ownedOnly, setOwnedOnly] = useState(false);

  const [filters, setFilters] = useState<PairFilters>(EMPTY_PAIR_FILTERS);
  // 篩選延後處理: 打字/點選即時更新控制項, 600+ 卡重篩交給 React 排程
  const deferredFilters = useDeferredValue(filters);
  const [sortBy, setSortBy] = useState<PairSortKey>("release-desc");
  // 兩條 transition 刻意分開:
  //   startTransition = 練度寫入 (內含 supabase 的 await; React 19 會 pending 到 promise 完成)
  //     → 它的 isPending 不能拿來做視覺, 不然每點一次寶數整牆就灰一下。
  //   startViewTransition = 切子分頁 / 切持有開關 (三個 useMemo 要對 600+ 筆重算) — 這條才給 stale 用。
  const [, startTransition] = useTransition();
  const [viewPending, startViewTransition] = useTransition();
  const [editDraft, setEditDraft] = useState<CollectionEntry | null>(null);
  /**
   * 本次操作過的拍組 — 在「我的所有拍組」即使被調回寶0 也留著顯示成灰卡
   * (調過頭想再點回來時卡片不該當場消失; 重新整理後才真的移出)
   */
  const [stickyIds, setStickyIds] = useState<Set<string>>(() => new Set());

  const pairsById = useMemo(() => {
    const m = new Map<string, ClientPairRecord>();
    for (const p of catalog) m.set(p.pairId, p);
    return m;
  }, [catalog]);

  // 道館名單做成 state — 側板可即時設為/取消道館拍組
  const [gymPairSet, setGymPairSet] = useState<Set<string>>(() => new Set(gymPairIds));

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const p of catalog) if (p.region) set.add(p.region);
    return [...set];
  }, [catalog]);

  /** 管理員: 側板切換道館拍組 (共用 setGymPair; 失敗回滾樂觀更新) */
  const toggleGymPair = (pair: ClientPairRecord) => {
    if (!gymSync || !isGymAdmin) return;
    const isIn = gymPairSet.has(pair.pairId);
    const apply = (set: Set<string>, add: boolean) => {
      const next = new Set(set);
      if (add) next.add(pair.pairId);
      else next.delete(pair.pairId);
      return next;
    };
    setGymPairSet((prev) => apply(prev, !isIn));
    void setGymPair(createClient(), gymSync.gymId, pair, !isIn).then((ok) => {
      if (!ok) setGymPairSet((prev) => apply(prev, isIn));
    });
  };

  const owned = useMemo<OwnedRow[]>(() => {
    return Object.values(collection)
      .filter((c) => c.owned)
      .map((c) => {
        const pair = pairsById.get(c.pairId);
        return pair ? { ...c, pair } : null;
      })
      .filter((r): r is OwnedRow => r !== null);
  }, [collection, pairsById]);

  /**
   * 顯示用清單: gym = 道館重點名單 / all = 整份圖鑑。
   * 「只看我持有的」再往上疊一層 (本次操作過但調回寶0 的留著顯示灰卡, 免得當場消失)。
   */
  const rows = useMemo<OwnedRow[]>(() => {
    const withEntry = (pair: ClientPairRecord): OwnedRow => {
      const c = collection[pair.pairId];
      return c ? { ...c, pair } : { ...defaultEntry(pair), pair };
    };
    const base =
      tab === "gym" ? catalog.filter((p) => gymPairSet.has(p.pairId)) : catalog;
    const list = base.map(withEntry);
    if (!ownedOnly) return list;
    return list.filter((r) => r.owned || stickyIds.has(r.pairId));
  }, [tab, catalog, collection, gymPairSet, ownedOnly, stickyIds]);

  const filtered = useMemo(() => {
    const q = deferredFilters.search.trim().toLowerCase();
    return rows.filter((r) => matchesPairFilters(r.pair, deferredFilters, q));
  }, [rows, deferredFilters]);

  /**
   * pairId → 目前這批 row。放進 ref 給卡牆的 grid 級 handler 讀:
   * 若把整份清單綁進 callback 的 deps, 每改一次練度 handler 就換一顆,
   * PairTypeGrid 與 600+ 張 SyncPairCard 的 memo 就全數失效 (前科: 每按一鍵跑兩次全量 render)。
   */
  const rowByPairId = useMemo(() => {
    const m = new Map<string, OwnedRow>();
    for (const r of rows) m.set(r.pairId, r);
    return m;
  }, [rows]);
  const rowsRef = useRef(rowByPairId);
  useEffect(() => {
    rowsRef.current = rowByPairId;
  }, [rowByPairId]);

  /**
   * 寫入一筆練度 (樂觀更新 + 背景 upsert)。
   * owned 由寶數/超覺醒推導 — 寶0 = 沒有這隻拍組。
   */
  const persist = useCallback((entry: CollectionEntry, successMsg?: string) => {
    const isOwned = entry.potential > 0 || entry.superAwakening > 0;
    setCollection((prev) => ({ ...prev, [entry.pairId]: { ...entry, owned: isOwned } }));
    // 側板開著且是同一隻 → 同步面板內容 (卡片左下角點擊也會反映到面板)
    setEditDraft((d) => (d && d.pairId === entry.pairId ? { ...entry, owned: isOwned } : d));
    startTransition(async () => {
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        toast.error("請先登入");
        return;
      }
      const { error } = await supabase.from("user_collection").upsert(
        {
          user_id: u.user.id,
          pair_id: entry.pairId,
          owned: isOwned,
          level: entry.level,
          promotion: entry.promotion,
          potential: entry.potential,
          super_awakening: entry.superAwakening,
          ex_unlocked: entry.exUnlocked,
          ex_style_worn: entry.exStyleWorn,
          notes: entry.notes,
        },
        { onConflict: "user_id,pair_id" }
      );
      if (error) {
        toast.error("儲存失敗", { description: error.message });
        return;
      }
      if (successMsg) toast.success(successMsg);
      // 道館端同步: 排刀媒合/道館拍組頁讀的是 member_pairs, 不同步會看到舊資料
      const pair = pairsById.get(entry.pairId);
      if (pair)
        void syncMemberPair(
          supabase, gymSync, pair,
          entry.potential, entry.superAwakening, entry.exStyleWorn, entry.level, entry.promotion
        );
    });
  }, [gymSync, pairsById]);

  /** 左下角計數點擊: 寶0→1→…→5 →(可超覺醒) 覺1→…→覺5 → 循環回寶0 (共用 cycleEntry) */
  const onCycleCount = useCallback(
    (row: OwnedRow) => {
      // 記住操作過的卡: 循環回寶0 時在「我的所有拍組」留著顯示灰卡
      setStickyIds((prev) => (prev.has(row.pairId) ? prev : new Set(prev).add(row.pairId)));
      persist(cycleEntry(row, row.pair.hasAwakening === true));
    },
    [persist]
  );

  // 卡片互動標準 (整站一致): 點卡片 (含灰卡) = 開編輯側板; 點左下角 = 寶數循環。
  // 兩顆都是整面牆共用的穩定 handler (contract C4), row 從 ref 取。
  const onSelectCard = useCallback((key: string) => {
    const row = rowsRef.current.get(key);
    if (row) setEditDraft({ ...row });
  }, []);
  const onCountCard = useCallback(
    (key: string) => {
      const row = rowsRef.current.get(key);
      if (row) onCycleCount(row);
    },
    [onCycleCount]
  );

  const onExport = () => {
    const header = ["trainer", "pokemon", "zh", "type", "role", "star", "level", "potential", "superAwakening", "notes"];
    const rowsOut = filtered.map((r) => {
      const role = roleAssetToRole(r.pair.roleAsset);
      return {
        trainer: r.pair.trainerName,
        pokemon: r.pair.pokemonName,
        zh: pairName(r.pair),
        type: TYPE_LABELS[r.pair.type as SyncPairType] ?? r.pair.type,
        role: role ? ROLE_LABELS[role] : "",
        star: r.promotion,
        level: r.level,
        potential: r.potential,
        superAwakening: r.superAwakening,
        notes: r.notes ?? "",
      };
    });
    const csv = [
      header.join(","),
      ...rowsOut.map((row) =>
        header
          .map((k) => {
            const v = String(row[k as keyof typeof row] ?? "");
            return v.includes(",") || v.includes('"') || v.includes("\n")
              ? `"${v.replace(/"/g, '""')}"`
              : v;
          })
          .join(",")
      ),
    ].join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pm-pairs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 卡片牆資料 (按屬性分組; 卡片本身呈現圖、左下寶數、超覺醒星)。
  // 一定要 memo: 寫在 render body 的話開個側板都會重建 600+ 個 item 物件, 整牆重畫。
  const gridItems = useMemo<GridItem[]>(
    () =>
      filtered.map((r) => {
        if (!signedIn) {
          // 訪客: 純圖鑑瀏覽 — 彩色卡、無寶數計數、不可點
          return {
            key: r.pairId,
            type: r.pair.type as SyncPairType,
            pair: r.pair,
            owned: true,
            promotion: r.pair.basePotential ?? 5,
          };
        }
        // 寶0 = 沒有這隻 → 整張卡反灰 (但左下角仍可點著加寶數)
        const has = r.potential > 0 || r.superAwakening > 0;
        return {
          key: r.pairId,
          type: r.pair.type as SyncPairType,
          pair: r.pair,
          fallbackLabel: pairName(r.pair),
          owned: has,
          promotion: r.promotion,
          potential: r.potential,
          superAwakening: r.superAwakening,
          // 點擊 handler 不放在 item 上 — 交給 PairTypeGrid 的 onSelect/onCount (見下方)
        };
      }),
    [filtered, signedIn]
  );

  /** 清單還是舊的 (篩選字/分頁切換還在算) → 整面牆淡一下, 才不會看起來像沒反應 */
  const stale = deferredFilters !== filters || viewPending;


  return (
    <div className="space-y-4">
      <PageHeading
        title="拍組"
        action={
          signedIn ? (
            // 匯出 / 分享是頁面層級動作 (AGENTS: 放標題列, 不要塞進篩選列)。
            // 390px 上它們與 h1 同一列就放得下, 收進「⋯」省不到任何高度只會把入口藏起來 →
            // 維持兩顆看得見的按鈕 (觸控命中區由 ui/button 的 pointer-coarse 覆蓋層負責)。
            <>
              <Button variant="outline" size="sm" onClick={onExport} disabled={filtered.length === 0}>
                <Download className="mr-1 h-4 w-4" />
                匯出 CSV
              </Button>
              <ShareDialog disabled={owned.length === 0} />
            </>
          ) : null
        }
      />

      {/* 子分頁 (看哪一批) + 持有開關 (看多少) — 兩件事分開。
          手機: 兩者各自佔滿一列的等寬控制項 (44px 高, 拇指按得到, 也不會擠成一排半);
          桌機: 維持「底線分頁 + 靠右藥丸開關」同一列 */}
      <div
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:border-b"
        data-tour="pairs-tabs"
      >
        <nav className="flex gap-1 border-b sm:border-b-0">
          {(signedIn && hasGym ? (["gym", "all"] as const) : (["all"] as const)).map((v) => (
            <button
              key={v}
              onClick={() => startViewTransition(() => setTab(v))}
              className={cn(
                "inline-flex min-h-11 flex-1 items-center justify-center border-b-2 px-2 text-sm transition-colors",
                "sm:min-h-0 sm:flex-none sm:px-4 sm:py-2",
                tab === v
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {TAB_LABELS[v]}
            </button>
          ))}
        </nav>
        {signedIn ? (
          <div className="flex rounded-full border p-0.5 text-sm sm:mb-1 sm:ml-auto sm:text-xs">
            {(
              [
                [false, "顯示全部"],
                [true, "只看我持有的"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                onClick={() => startViewTransition(() => setOwnedOnly(v))}
                className={cn(
                  // 44px 是這顆藥丸自己的高度 (外框的 p-0.5 + border 不算觸控目標)
                  "min-h-11 flex-1 rounded-full px-2.5 py-1 transition-colors sm:min-h-0 sm:flex-none",
                  ownedOnly === v
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!signedIn ? null : tab === "gym" && !hasGym ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center sm:p-10">
          <h3 className="text-lg font-semibold">還沒有道館指定拍組</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            加入道館後, 這裡會列出道館指定要練的拍組, 你沒有的會顯示成灰卡。
          </p>
          <Button asChild className="mt-4">
            <Link href="/gyms">去道館</Link>
          </Button>
        </div>
      ) : null}

      {signedIn && (tab !== "gym" || hasGym) ? (
        <>
          <PairFilterBar
            filters={filters}
            onChange={setFilters}
            regions={regions}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />

        </>
      ) : null}

      {/* 訪客點需要登入的分頁 → 引導登入 */}
      {!signedIn ? (
        <>
          <PairFilterBar
            filters={filters}
            onChange={setFilters}
            regions={regions}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
        </>
      ) : null}

      {signedIn && ownedOnly && filtered.length === 0 && owned.length === 0 ? (
        <EmptyState onShowAll={() => startViewTransition(() => setOwnedOnly(false))} />
      ) : (
        /* 淡化只作用在外層容器 — 卡片本身的外觀規格 (照遊戲重現) 一個像素都不動 */
        <div
          className={cn(
            "transition-opacity motion-reduce:transition-none",
            stale && "opacity-60"
          )}
        >
          <PairTypeGrid
            items={gridItems}
            sortBy={sortBy}
            onSelect={signedIn ? onSelectCard : undefined}
            onCount={signedIn ? onCountCard : undefined}
            /* 這頁一次 645 張卡 = 全站最大的一份 HTML (訪客 1.5MB / 登入 2.4MB),
               Cloudflare 免費方案的 CPU 幾乎全花在把它編成 bytes → 隨機 Error 1102。
               SSR 只出首屏那 24 張, 其餘等 hydration 在瀏覽器補 (卡片外觀與互動完全不變)。 */
            ssrEagerOnly
          />
        </div>
      )}

      {/* 編輯練度 — 非模態側板: 不鎖畫面, 點其他卡直接切換內容 */}
      <SidePanel
        open={editDraft !== null}
        onClose={() => setEditDraft(null)}
        title={
          editDraft && pairsById.get(editDraft.pairId)
            ? pairName(pairsById.get(editDraft.pairId)!)
            : "編輯練度"
        }
      >
        {editDraft && pairsById.get(editDraft.pairId) ? (
          <PairEditPanel
            pair={pairsById.get(editDraft.pairId)!}
            entry={editDraft}
            gymPair={
              gymSync
                ? {
                    isGymPair: gymPairSet.has(editDraft.pairId),
                    canEdit: isGymAdmin,
                    onToggle: () => toggleGymPair(pairsById.get(editDraft.pairId)!),
                  }
                : undefined
            }
            onChange={(next) => persist(next)}
            onCountClick={() => {
              const pair = pairsById.get(editDraft.pairId)!;
              onCycleCount({ ...editDraft, pair });
            }}
          />
        ) : null}
      </SidePanel>
    </div>
  );
}

function EmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center sm:p-12">
      <h3 className="text-lg font-semibold">還沒有拍組</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        到「所有拍組圖鑑」點一下你持有的卡片就會點亮。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={onShowAll}>
          <Layers className="mr-1 h-4 w-4" />
          去所有拍組圖鑑
        </Button>
      </div>
    </div>
  );
}
