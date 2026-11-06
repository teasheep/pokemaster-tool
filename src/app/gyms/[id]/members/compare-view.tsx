"use client";

// 成員頁的「比較」—— 選幾個人、選幾個屬性, 一張「拍組 × 成員」的表, 每一格是那個人的那張卡
// (2026-11-04 使用者:「道館系統想加一個比較功能 可以選人 然後選屬性 複數的 然後有個比較頁面」)。
//
// **放在成員頁名冊裡, 不是新分頁** (AGENTS「不要再長出新分頁」): 它回答的還是
// 「誰有什麼」, 正是「成員與拍組」這一頁的職責; 名冊第二項就是入口, 與「全館拍組」同一種偽成員。
//
// 版面改過兩次, 都是使用者 2026-11-05 指定的:
//   - 第一版: 同一張表, 但每格寫「寶5 / 6★EX Lv200」→「不要單獨列 寶X Ex xx 這種」
//     (那些資訊卡面本來就有: 左下角的寶數、官方卡面的星數、「顯示」勾了等級就畫在右上角)。
//   - 第二版: 每個屬性一段、逐人一排他持有的卡 →「前面的那種表格好像也不錯 只是顯示按照拍組顯示」。
//   - 現在: **表格留著, 格子是卡牆那一張卡** (`PairCell`, 與 PairTypeGrid 同一個元件)。
//     ⚠ 不要再把文字寫回格子裡。**每個屬性一張表**, 而且**手機與電腦的軸是相反的** (同日使用者:
//     「人員當作橫軸 拍組當作縱軸好像更符合使用體驗 不同屬性就分不同個表」「手機電腦相反如果是為了 UX
//     是可接受的」):
//       電腦 = 一列一個人、拍組往右排 (橫著看就是「這個人有哪些」, 寬螢幕放得下一個屬性的整份名單);
//       手機 = 一列一組拍組、人在上面 (手機是往下捲的, 四個人剛好一屏, 不用每張表各自橫捲)。
//     兩種排法吃同一份 `groups`, 只是 CSS 決定顯示哪一張 (sm 斷點)。
//     拍組名一律寫在卡片**上面** (電腦: 欄頭兩行置中, 與卡牆的卡名同一個長相; 手機: 卡片上面橫跨整列的一行) ——
//     放在最左邊的窄欄會從字中間斷開 (「美極套裝赤 / 紅」), 使用者:「這樣顯示起來很醜」。
//
// 三件刻意的事:
//   1. **他沒有的那格是灰卡** (全站「寶0 = 整卡反灰」), 不是空格 —— 一列裡亮著的就是有的人。
//      道館拍組列全部名單 (「大家都沒有」本身就是資訊); 所有遊戲拍組只列選到的人至少一位有的
//      (一個屬性三四十隻, 全列出來大半是整列灰卡)。
//   2. **只讀不寫**: 卡片點不了 (不給 onSelect / onCount, 卡片就渲染成 div)。
//      要改某個人的練度, 回名冊點那個人 (寫入路徑只有一條)。
//   3. 選了誰、哪些屬性、哪一批拍組、卡上顯示什麼都進網址 (?cmp= / ?types= / ?scope= / ?show=),
//      重新整理與貼連結都留得住。

import { Fragment, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { CardInfoSelect } from "@/components/gym/card-info-select";
import { MemberAvatar, memberCallName, memberLabel } from "@/components/gym/member-card";
import { PairCell, type GridItem } from "@/components/gym/pair-type-grid";
import { Chip } from "@/components/pair-filter-bar";
import { usePotentials } from "@/components/potential-picker";
import { Sk } from "@/components/skeletons";
import { TypeBadge, TypeIcon } from "@/components/sync-pair-badges";
import { PairStatusTag } from "@/components/sync-pair-card";
import { ALL_TYPES, TYPE_COLORS, TYPE_LABELS } from "@/data/sync-pairs";
import { serializeCompareMembers, serializeCompareTypes } from "@/lib/gym/compare-params";
import { pairComparator, pairName } from "@/lib/pairs/name";
import { serializeCardInfo, type CardInfoKey, type PotentialData } from "@/lib/pairs/potentials";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { SyncPairType } from "@/lib/supabase/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

export type CompareMember = {
  id: string;
  displayName: string;
  lineName: string | null;
  avatarUrl: string | null;
  badgeText: string | null;
};

/** member_pairs 的一列 —— 卡面要的欄位 (與成員卡牆 `items` 讀的是同幾欄) */
type MemberPairRow = {
  member_id: string;
  pair_id: string | null;
  grade: number;
  super_awakening: number;
  level: number;
  promotion: number | null;
  sync_grid: number | null;
  ex_role_unlocked: boolean | null;
  lucky_skills?: string[] | null;
  notes?: string | null;
};

const byRelease = pairComparator("release-desc");

/** 表格格子的寬度 —— 手機一列放得下四個人 (390 寬), 桌機與卡牆一樣 96px */
const CELL_W = "w-20 sm:w-24";
/** 第一張表的前幾列直接帶圖 (其餘捲到附近才載, 與卡牆同一套 IntersectionObserver) */
const EAGER_ROWS = 3;

/** 一格 = 這個人的這一張 (與成員卡牆的 items 逐欄相同); 他沒有就是灰卡 */
function cellOf(type: SyncPairType, rec: ClientPairRecord, row: MemberPairRow | undefined): GridItem {
  if (!row) return { key: rec.pairId, type, pair: rec, owned: false, potential: 0 };
  const grade = row.grade;
  return {
    key: rec.pairId,
    type,
    pair: rec,
    owned: true,
    // 舊資料 grade=6 無等級 = 表單時代「超覺醒當覺5」
    potential: grade >= 6 ? 5 : grade,
    superAwakening: row.super_awakening > 0 ? row.super_awakening : grade >= 6 ? 5 : 0,
    promotion: row.promotion ?? undefined,
    syncGrid: row.sync_grid ?? 0,
    exRoleUnlocked: row.ex_role_unlocked ?? false,
    level: row.level ?? 1,
    luckySkills: row.lucky_skills ?? [],
    notes: row.notes ?? null,
  };
}

/**
 * 比較的選擇。**放在 members-client 那一層不放在這裡**: 從比較點到某個人、再點回比較時
 * 這個元件會重新掛載 —— 狀態放這裡的話, 剛剛選好的人與屬性就沒了 (又是一種「跳回去」)。
 */
export type CompareState = {
  members: string[];
  types: SyncPairType[];
  scope: "gym" | "all";
  /** 卡上多顯示什麼 (與成員卡牆同一個「顯示」下拉、同一個 ?show=) */
  show: CardInfoKey[];
};

export function CompareView({
  members,
  defaultMemberIds,
  state,
  setState,
  catalog,
  gymPairIds,
}: {
  /** 比得到的人 = 正式成員 (顧問的練度不屬於這一館, 0072) */
  members: CompareMember[];
  /** 網址沒帶 ?cmp= 時選誰 (自己; 顧問 / 沒有成員列的人是空的) */
  defaultMemberIds: string[];
  state: CompareState;
  setState: Dispatch<SetStateAction<CompareState>>;
  /** 頁面的圖鑑子集 (道館名單 ∪ 全館持有) —— 比較只列有人持有的, 子集就夠 */
  catalog: ClientPairRecord[];
  gymPairIds: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const { members: picked, types, scope, show } = state;
  const setScope = (v: "gym" | "all") => setState((s) => ({ ...s, scope: v }));
  const setShow = (v: CardInfoKey[]) => setState((s) => ({ ...s, show: v }));
  const potentials = usePotentials(show.includes("potential"));

  useUrlState({
    // 照名冊順序寫 (= 重新整理時讀回來的順序), 網址才不會因為點選先後不同而在載入時又被改寫一次
    cmp: serializeCompareMembers(
      members.flatMap((m) => (picked.includes(m.id) ? [m.id] : [])),
      defaultMemberIds,
    ),
    types: serializeCompareTypes(types),
    scope: scope === "all" ? "all" : null,
    show: serializeCardInfo(show),
  });

  /** 照名冊順序排, 每一段裡的人才不會因為點選的先後跳來跳去 */
  const columns = useMemo(() => members.filter((m) => picked.includes(m.id)), [members, picked]);
  const toggleMember = (id: string) =>
    setState((s) => ({
      ...s,
      members: s.members.includes(id) ? s.members.filter((x) => x !== id) : [...s.members, id],
    }));
  const toggleType = (t: SyncPairType) =>
    setState((s) => ({
      ...s,
      types: s.types.includes(t) ? s.types.filter((x) => x !== t) : [...s.types, t],
    }));

  /**
   * 被選到的人的練度: 只抓還沒抓過的人, 抓過就留著 (同一頁來回點不重抓)。
   * 抓回來之前那個人那一排是骨架 —— 先用原始星級畫卡、回來再換成他的星數的話,
   * 6★EX 的卡會先載一張別的圖再換掉 (多一次下載, 畫面也閃一下)。
   */
  const [rowsOf, setRowsOf] = useState<Map<string, Map<string, MemberPairRow>>>(() => new Map());
  const [failed, setFailed] = useState(false);
  const missing = useMemo(() => picked.filter((id) => !rowsOf.has(id)), [picked, rowsOf]);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(",");
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchAllRows<MemberPairRow>((a, b) =>
          supabase
            .from("member_pairs")
            // "*" 而不是明列欄位 —— 與成員卡牆的 loadMember 同一條規矩 (migration 與前端不會同時落地)
            .select("*")
            .in("member_id", ids)
            .order("id")
            .range(a, b),
        );
        if (!alive) return;
        setRowsOf((prev) => {
          const next = new Map(prev);
          for (const id of ids) if (!next.has(id)) next.set(id, new Map());
          for (const r of rows) {
            if (r.pair_id && r.grade > 0) next.get(r.member_id)?.set(r.pair_id, r);
          }
          return next;
        });
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [missingKey, supabase]);

  const gymSet = useMemo(() => new Set(gymPairIds), [gymPairIds]);

  /**
   * 每個屬性一張表 (最新上架在前, 與卡牆預設排序一樣)。格子 cells[拍組][人] 在這裡就建好 ——
   * 每次 render 重建的話 PairCell 的 memo 等於白掛; 手機與電腦兩種排法吃的是同一份。
   */
  const loadingAny = missing.length > 0;
  const groups = useMemo(() => {
    if (columns.length === 0 || types.length === 0) return [];
    return ALL_TYPES.filter((t) => types.includes(t)).map((type) => {
      const rows = catalog
        .filter((p) => p.type === type)
        .filter((p) =>
          scope === "gym" ? gymSet.has(p.pairId) : columns.some((m) => rowsOf.get(m.id)?.has(p.pairId)),
        )
        .sort(byRelease)
        .map((rec) => ({
          rec,
          starred: scope === "all" && gymSet.has(rec.pairId),
          // null = 那個人的練度還沒抓回來 (畫骨架)
          cells: columns.map((m) => {
            const mine = rowsOf.get(m.id);
            return mine ? cellOf(type, rec, mine.get(rec.pairId)) : null;
          }),
        }));
      // 每個人在這個屬性有幾組 (欄頭 / 列頭那顆頭像底下)
      const owned = columns.map((m) => {
        const mine = rowsOf.get(m.id);
        return mine ? rows.filter(({ rec }) => mine.has(rec.pairId)).length : null;
      });
      return { type, rows, owned };
    });
  }, [catalog, columns, gymSet, rowsOf, scope, types]);

  const ready = columns.length > 0 && types.length > 0;

  return (
    <div className="space-y-3 sm:space-y-4" data-compare>
      <h2 className="hidden text-lg font-semibold lg:block">比較</h2>

      {/* 選人 / 選屬性 —— 手機一排橫捲 (與篩選列的屬性 chips 同一種), 桌機折行 */}
      <div className="space-y-2">
        <PickRow label="成員">
          {members.map((m) => (
            <Chip
              key={m.id}
              active={picked.includes(m.id)}
              onClick={() => toggleMember(m.id)}
              title={memberLabel(m)}
            >
              <MemberAvatar member={m} size="sm" className="h-6 w-6 text-[10px]" />
              <span className="max-w-28 truncate whitespace-nowrap">{memberCallName(m)}</span>
            </Chip>
          ))}
        </PickRow>
        <PickRow label="屬性">
          {ALL_TYPES.map((t) => (
            <Chip
              key={t}
              active={types.includes(t)}
              onClick={() => toggleType(t)}
              activeClass={TYPE_COLORS[t]}
              title={TYPE_LABELS[t]}
            >
              <TypeIcon type={t} className="h-5 w-5" />
              <span className="whitespace-nowrap">{TYPE_LABELS[t]}</span>
            </Chip>
          ))}
        </PickRow>
      </div>

      <div className="flex items-end gap-2 border-b">
        <nav className="flex min-w-0 flex-1 gap-1">
          {(["gym", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setScope(v)}
              className={cn(
                "-mb-px inline-flex min-h-11 flex-1 items-center justify-center gap-1 border-b-2 px-2 text-sm transition-colors",
                "sm:min-h-0 sm:flex-none sm:px-4 sm:py-2",
                scope === v
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {v === "gym" ? "道館拍組" : "所有遊戲拍組"}
            </button>
          ))}
        </nav>
        <div className="shrink-0 pb-1">
          <CardInfoSelect value={show} onChange={setShow} />
        </div>
      </div>

      {!ready ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {columns.length === 0 ? "選擇要比較的成員" : "選擇屬性"}
        </p>
      ) : failed && missing.length > 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          讀取成員的拍組失敗, 請重新整理
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g, gi) => (
            <section key={g.type} data-compare-type={g.type}>
              {/* 屬性徽章那一列 —— 與卡牆 (PairTypeGrid) 同一個長相 */}
              <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-1.5">
                <TypeBadge type={g.type} />
                <span className="text-xs text-muted-foreground">{g.rows.length} 組</span>
              </div>
              {g.rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {scope === "gym"
                    ? "道館名單上沒有這個屬性的拍組"
                    : loadingAny
                      ? "讀取中…"
                      : "選到的人都沒有這個屬性的拍組"}
                </p>
              ) : (
                <>
                  <PairsDownTable
                    group={g}
                    columns={columns}
                    eager={gi === 0}
                    show={show}
                    potentials={potentials}
                  />
                  <MembersDownTable
                    group={g}
                    columns={columns}
                    eager={gi === 0}
                    show={show}
                    potentials={potentials}
                  />
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type CompareGroup = {
  type: SyncPairType;
  rows: { rec: ClientPairRecord; starred: boolean; cells: (GridItem | null)[] }[];
  owned: (number | null)[];
};
type TableProps = {
  group: CompareGroup;
  columns: CompareMember[];
  /** 這是第一張表 → 前幾張卡直接帶圖 */
  eager: boolean;
  show: CardInfoKey[];
  potentials: PotentialData | null;
};

/** 表格只有內容那麼寬 (w-fit), 不撐滿 —— 撐滿的話三個人的欄位會隔三百多 px, 橫著比很吃力 */
const TABLE_BOX = "w-fit max-w-full overflow-x-auto rounded-xl border bg-card";
/** border-separate: collapse 模式下 sticky 那一欄的框線不會跟著走 */
const TABLE = "w-max border-separate border-spacing-0 text-sm [&>tbody>tr:last-child>*]:border-b-0";

/** 手機: 一列一組拍組、人在上面 (拍組名是卡片上面橫跨整列的一行, 字 sticky 在左邊) */
function PairsDownTable({ group: g, columns, eager, show, potentials }: TableProps) {
  return (
    <div className={cn(TABLE_BOX, "sm:hidden")} data-compare-layout="pairs-down">
      <table className={TABLE}>
        <thead>
          <tr className="[&>*]:border-b [&>*]:bg-muted">
            {columns.map((m, i) => (
              <th
                key={m.id}
                scope="col"
                className="px-0.5 py-1.5 align-bottom font-normal"
                data-compare-member={m.id}
              >
                <span
                  className={cn("mx-auto flex flex-col items-center gap-0.5", CELL_W)}
                  title={memberLabel(m)}
                >
                  <MemberAvatar member={m} size="sm" className="h-7 w-7 text-[11px]" />
                  <span className="w-full truncate text-center text-xs">{memberCallName(m)}</span>
                  <OwnedCount n={g.owned[i] ?? null} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.rows.map(({ rec, starred, cells }, ri) => (
            <Fragment key={rec.pairId}>
              <tr data-compare-label={rec.pairId}>
                <th
                  scope="colgroup"
                  colSpan={columns.length}
                  className="px-2 pb-1 pt-2.5 text-left font-normal"
                >
                  <PairLabel
                    rec={rec}
                    starred={starred}
                    className="sticky left-2 block w-max text-xs font-medium text-foreground/80"
                  />
                </th>
              </tr>
              <tr className="[&>*]:border-b [&>*]:border-border/60" data-compare-row={rec.pairId}>
                {cells.map((item, i) => (
                  <td
                    key={columns[i]!.id}
                    className="px-0.5 pb-2 align-top"
                    data-compare-cell={columns[i]!.id}
                  >
                    <CompareCell
                      item={item}
                      eager={eager && ri < EAGER_ROWS}
                      show={show}
                      potentials={potentials}
                    />
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 電腦: 一列一個人、拍組往右排 (拍組名在欄頭, 兩行置中 = 卡牆卡名的長相; 人名那一欄 sticky) */
function MembersDownTable({ group: g, columns, eager, show, potentials }: TableProps) {
  return (
    <div className={cn(TABLE_BOX, "max-sm:hidden")} data-compare-layout="members-down">
      <table className={TABLE}>
        <thead>
          <tr className="[&>*]:border-b [&>*]:bg-muted">
            <th className="sticky left-0 z-20" aria-hidden />
            {g.rows.map(({ rec, starred }) => (
              <th
                key={rec.pairId}
                scope="col"
                className="px-1.5 pb-1.5 pt-2 align-bottom font-normal"
                data-compare-pair={rec.pairId}
              >
                <PairLabel
                  rec={rec}
                  starred={starred}
                  className="mx-auto line-clamp-2 w-24 text-center text-[11px] leading-tight text-foreground/80"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((m, mi) => (
            <tr key={m.id} className="[&>*]:border-b [&>*]:border-border/60">
              <th
                scope="row"
                className="sticky left-0 z-20 bg-card px-3 py-1.5 text-left align-middle font-normal"
                data-compare-member={m.id}
              >
                <span className="flex w-32 items-center gap-2" title={memberLabel(m)}>
                  <MemberAvatar member={m} size="sm" className="h-8 w-8 shrink-0 text-xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{memberCallName(m)}</span>
                    <OwnedCount n={g.owned[mi] ?? null} />
                  </span>
                </span>
              </th>
              {g.rows.map(({ rec, cells }) => (
                <td key={rec.pairId} className="px-1.5 py-1.5 align-top" data-compare-cell={m.id}>
                  <CompareCell
                    item={cells[mi] ?? null}
                    eager={eager && mi < EAGER_ROWS}
                    show={show}
                    potentials={potentials}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnedCount({ n }: { n: number | null }) {
  return <span className="block text-[11px] text-muted-foreground">{n === null ? "…" : `${n} 組`}</span>;
}

function PairLabel({
  rec,
  starred,
  className,
}: {
  rec: ClientPairRecord;
  starred: boolean;
  className: string;
}) {
  return (
    <span className={className} title={pairName(rec)}>
      {starred ? (
        <span className="mr-0.5 text-amber-500" title="已是道館拍組">
          ★
        </span>
      ) : null}
      <PairStatusTag pair={rec} />
      {pairName(rec)}
    </span>
  );
}

/** 一格: 那個人的那張卡 (唯讀, 卡下不再寫名字 —— 名字在欄頭 / 卡片上面那一行); 還沒抓回來是骨架 */
function CompareCell({
  item,
  eager,
  show,
  potentials,
}: {
  item: GridItem | null;
  eager: boolean;
  show: CardInfoKey[];
  potentials: PotentialData | null;
}) {
  return item ? (
    <PairCell
      item={item}
      size="sm"
      eager={eager}
      show={show}
      potentials={potentials}
      showName={false}
      className={cn("mx-auto", CELL_W)}
    />
  ) : (
    <Sk className={cn("mx-auto aspect-square rounded-xl", CELL_W)} />
  );
}

function PickRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 w-8 shrink-0 text-xs font-medium text-muted-foreground max-sm:mt-3">
        {label}
      </span>
      <div className="relative -mx-1 min-w-0 flex-1">
        <div className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] max-sm:[&>button]:shrink-0 sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
