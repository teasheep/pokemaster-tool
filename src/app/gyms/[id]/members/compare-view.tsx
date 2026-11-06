"use client";

// 成員頁的「比較」—— 選幾個人、選幾個屬性 (或指定幾組拍組), 一張「拍組 × 成員」的表, 每一格是那個人的那張卡
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
// 2026-11-06 加的三件 (使用者:「要看特定 2-3 隻拍組的持有情況跟寶數 就要這樣分別點開來然後再截圖判斷」
// 「人員應該要可以選全部」「比較的格子最好還可以點選排序 排序的對象可以不只一個」):
//   - **指定拍組**: 挑幾組拍組, 排在屬性表格最上面, **跟屬性表格是同一張表** (第一版做成一格一顆「寶5」
//     徽章的矩陣, 被說「好醜」—— 那正是 11/05 否決過的文字格子)。有最多組的人排前面, 一組都沒有的人
//     不佔欄位, 收成表格下面一行「其餘 N 人都沒有」(選「全部」時, 一半是整排灰卡的話有的人反而被擠出畫面)。
//     挑拍組用隊伍庫同一塊搜尋面板 (`PairSearchPanel`) ——「選拍組的下拉選單怎麼長那樣 不要亂長」。
//   - **成員「全部」**: 網址寫 `cmp=all` (見 compare-params.ts)。
//   - **點拍組名排序, 可以疊好幾層**:「第一組按照寶數高低下去排 第二組在第一組成立的前提下去排」。
//     點一下 = 加到最後一層, 再點一下 = 拿掉; 欄頭的數字是第幾層。成員的順序**全部表格共用一份**
//     (同一個人在每張表的位置一樣, 上下對照才看得懂), 進網址 `?sort=`。
//     只看「現在畫面上有的拍組」—— 屬性取消掉之後, 那幾組的排序就不作用 (留著也看不到是誰在排)。
//
// **預設是精簡表格, 卡片是第二種樣子** (2026-11-06 使用者:「還是不能一眼看完 要再改改」
// 「你看我貼的圖 至少要比那個好」—— 貼的是三個「全館拍組」側板的持有者 chips 截圖拼在一起):
//   卡片表一個人一列要 114px, 20 個人一張表 2300px, 三組拍組要捲好幾屏 —— 比截圖還難看。
//   精簡 = 一個人一列 (32px, 頭像 28px = AGENTS 的密集列尺寸), 格子是**「全館拍組」側板持有者 chip 的那顆
//   `GradeBadge`** (寶1-5 / 超覺醒1-5)。沒有就是空的 —— 一列裡有徽章的就是有的人。
//   ⚠ 中間試過「卡片左下角那顆六角 + 6★EX 的星」, 使用者:「算了 就跟側邊欄一樣顯示 badge 寶幾 這樣就好
//   現在還是太亂了」—— 彩色六角一整片太吵。11/05 否決的是「卡片旁邊再寫一串寶X Ex xx」, 不是這顆徽章。
//   兩種樣子都是一個人一列 (手機也是): 精簡的格子窄, 手機一列放得下四組, 不用再把軸轉過來。
//   拍組名寫在欄頭的卡下面, `break-keep` —— 窄欄從字中間斷開 (「美極套裝赤 / 紅」) 是被說過醜的。
//   卡片表 (`?cards=1`) 留著: 要看星數、等級、石盤、潛能時切過去, 「顯示」下拉只在卡片表出現 (精簡畫不出那些)。
//   兩種樣子都把「這張表一組都沒有的人」收成表格下面一行 (屬性表也是), 電腦上精簡表一張張橫著排。
//
// 三件刻意的事:
//   1. **他沒有的那格是灰卡** (全站「寶0 = 整卡反灰」), 不是空格 —— 一列裡亮著的就是有的人。
//      道館拍組列全部名單 (「大家都沒有」本身就是資訊); 所有遊戲拍組只列選到的人至少一位有的
//      (一個屬性三四十隻, 全列出來大半是整列灰卡)。
//   2. **只讀不寫**: 卡片點不了 (不給 onSelect / onCount, 卡片就渲染成 div)。
//      要改某個人的練度, 回名冊點那個人 (寫入路徑只有一條)。點得動的只有拍組名 (排序)。
//   3. 選了誰、哪些屬性、哪幾組拍組、怎麼排、卡上顯示什麼都進網址
//      (?cmp= / ?types= / ?pairs= / ?sort= / ?scope= / ?show=), 重新整理與貼連結都留得住。

import { ArrowDown, Download, LayoutGrid, Plus, Rows3, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import {
  CANDY_GROUPS,
  CANDY_LABELS,
  CandyIcon,
  CandyPlate,
  type CandyCounts,
  type CandyType,
} from "@/components/gym/candy";
import { CardInfoSelect } from "@/components/gym/card-info-select";
import { GradeBadge } from "@/components/gym/gym-ui";
import {
  TYPE_FOCUS_KINDS,
  TYPE_FOCUS_LABELS,
  emptyTypeFocus,
  type TypeFocus,
  type TypeFocusKind,
} from "@/components/gym/type-focus";
import { MemberAvatar, memberCallName, memberLabel } from "@/components/gym/member-card";
import { PairSearchPanel } from "@/components/gym/pair-picker";
import { PairCell, type GridItem } from "@/components/gym/pair-type-grid";
import { Chip } from "@/components/pair-filter-bar";
import { usePotentials } from "@/components/potential-picker";
import { Sk } from "@/components/skeletons";
import { TypeBadge, TypeIcon } from "@/components/sync-pair-badges";
import { PairStatusTag, SyncPairCard } from "@/components/sync-pair-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ALL_TYPES, TYPE_COLORS, TYPE_LABELS } from "@/data/sync-pairs";
import {
  MAX_COMPARE_PAIRS,
  serializeCompareMembers,
  serializeComparePairs,
  serializeCompareRes,
  serializeCompareTypes,
  type CompareResKey,
} from "@/lib/gym/compare-params";
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
  /** 指定拍組 (pairId, 加進來的順序 = 表格裡的順序) */
  pairs: string[];
  /** 排序: 依序用這幾組的寶數排成員 (第一個是第一層) */
  sort: string[];
  /** true = 格子畫成卡片 (?cards=1); 預設是精簡表格 (格子只有寶數那一顆) */
  cards: boolean;
  /** 要比的資源 (?res=): 背包道具的分組 / 投入屬性 */
  res: CompareResKey[];
};

export function CompareView({
  members,
  defaultMemberIds,
  state,
  setState,
  catalog,
  gymPairIds,
  gymId,
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
  gymId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { members: picked, types, scope, show, pairs: pickedPairs, sort, cards, res } = state;
  const allIds = useMemo(() => members.map((m) => m.id), [members]);
  const setScope = (v: "gym" | "all") => setState((s) => ({ ...s, scope: v }));
  const setShow = (v: CardInfoKey[]) => setState((s) => ({ ...s, show: v }));
  const setCards = (v: boolean) => setState((s) => ({ ...s, cards: v }));
  const potentials = usePotentials(cards && show.includes("potential"));

  useUrlState({
    // 照名冊順序寫 (= 重新整理時讀回來的順序), 網址才不會因為點選先後不同而在載入時又被改寫一次
    cmp: serializeCompareMembers(allIds.filter((id) => picked.includes(id)), defaultMemberIds, allIds),
    types: serializeCompareTypes(types),
    pairs: serializeComparePairs(pickedPairs),
    sort: serializeComparePairs(sort),
    scope: scope === "all" ? "all" : null,
    show: serializeCardInfo(show),
    cards: cards ? "1" : null,
    res: serializeCompareRes(res),
  });

  /** 照名冊順序排 (排序之前的基準) */
  const columns = useMemo(() => members.filter((m) => picked.includes(m.id)), [members, picked]);
  const toggleMember = (id: string) =>
    setState((s) => ({
      ...s,
      members: s.members.includes(id) ? s.members.filter((x) => x !== id) : [...s.members, id],
    }));
  /** 「全部」: 已經全選 → 全部取消; 否則全選 */
  const allPicked = members.length > 0 && members.every((m) => picked.includes(m.id));
  const toggleAll = () => setState((s) => ({ ...s, members: allPicked ? [] : [...allIds] }));
  const toggleType = (t: SyncPairType) =>
    setState((s) => ({
      ...s,
      types: s.types.includes(t) ? s.types.filter((x) => x !== t) : [...s.types, t],
    }));
  const [pickingPair, setPickingPair] = useState(false);
  /**
   * 點「拍組」那一排與搜尋面板以外的地方 = 收起 (2026-11-06 使用者:「拍組的那個篩選框點其他位置的時候
   * 是不是應該收起來」) —— 與隊伍庫的 PairPicker 同一套 (mousedown + touchstart)。
   * 那一排本身不算外面: 「＋ 拍組」自己會切換, 點已選拍組的 × 也不該把面板關掉。
   */
  const pairPickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickingPair) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (pairPickRef.current && !pairPickRef.current.contains(e.target as Node)) setPickingPair(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [pickingPair]);
  const togglePair = (id: string) =>
    setState((s) =>
      s.pairs.includes(id)
        ? { ...s, pairs: s.pairs.filter((x) => x !== id), sort: s.sort.filter((x) => x !== id) }
        : s.pairs.length >= MAX_COMPARE_PAIRS
          ? s
          : { ...s, pairs: [...s.pairs, id] },
    );
  /** 點拍組名: 沒在排 → 加到最後一層; 已經在排 → 拿掉 */
  const toggleSort = (id: string) =>
    setState((s) => ({
      ...s,
      sort: s.sort.includes(id) ? s.sort.filter((x) => x !== id) : [...s.sort, id].slice(-MAX_COMPARE_PAIRS),
    }));
  const clearSort = () => setState((s) => ({ ...s, sort: [] }));
  /** 資源那一排: 取消一組道具時, 那幾種道具的排序跟著拿掉 (與拿掉指定拍組同一個做法) */
  const toggleRes = (k: CompareResKey) =>
    setState((s) => {
      if (!s.res.includes(k)) return { ...s, res: [...s.res, k] };
      const items = new Set<string>(CANDY_GROUPS.find((g) => g.key === k)?.types ?? []);
      return { ...s, res: s.res.filter((x) => x !== k), sort: s.sort.filter((x) => !items.has(x)) };
    });

  /**
   * 資源 = 全館一次抓 (一館最多 20 人 × 20 種道具 / 36 個屬性勾選, 一趟就夠), 抓過就留著。
   * 跟成員頁「資源」分頁讀的是同兩張表 (member_candies / member_type_focus), 只是一次讀全部人。
   * 一樣走 fetchAllRows + order("id"): 單發查詢遇到 1000 列會被靜默截斷 (AGENTS 的老規矩)。
   */
  const wantCandies = res.some((k) => k !== "focus");
  const wantFocus = res.includes("focus");
  const [candyOf, setCandyOf] = useState<Map<string, CandyCounts> | null>(null);
  const [focusOf, setFocusOf] = useState<Map<string, TypeFocus> | null>(null);
  const [resFailed, setResFailed] = useState(false);
  const needCandies = wantCandies && candyOf === null;
  const needFocus = wantFocus && focusOf === null;
  useEffect(() => {
    if (!needCandies) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchAllRows<{ member_id: string; candy_type: string; count: number }>((a, b) =>
          supabase
            .from("member_candies")
            .select("id, member_id, candy_type, count")
            .eq("gym_id", gymId)
            .order("id")
            .range(a, b),
        );
        if (!alive) return;
        const next = new Map<string, CandyCounts>();
        for (const r of rows) {
          const m = next.get(r.member_id) ?? {};
          m[r.candy_type as CandyType] = r.count;
          next.set(r.member_id, m);
        }
        setCandyOf(next);
      } catch {
        if (alive) setResFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [needCandies, gymId, supabase]);
  useEffect(() => {
    if (!needFocus) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchAllRows<{ member_id: string; kind: string; type: string }>((a, b) =>
          supabase
            .from("member_type_focus")
            .select("id, member_id, kind, type")
            .eq("gym_id", gymId)
            .order("id")
            .range(a, b),
        );
        if (!alive) return;
        const next = new Map<string, TypeFocus>();
        for (const r of rows) {
          const f = next.get(r.member_id) ?? emptyTypeFocus();
          const kind = r.kind as TypeFocusKind;
          if (f[kind]) f[kind].push(r.type as SyncPairType);
          next.set(r.member_id, f);
        }
        // 一律照遊戲的 18 屬性順序 (與 /resources 同一個順序), 不是勾選的先後
        for (const f of next.values()) {
          for (const k of TYPE_FOCUS_KINDS) f[k].sort((a, b) => ALL_TYPES.indexOf(a) - ALL_TYPES.indexOf(b));
        }
        setFocusOf(next);
      } catch {
        if (alive) setResFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [needFocus, gymId, supabase]);

  /**
   * 被選到的人的練度: 只抓還沒抓過的人, 抓過就留著 (同一頁來回點不重抓)。
   * 抓回來之前那個人那一排是骨架 —— 先用原始星級畫卡、回來再換成他的星數的話,
   * 6★EX 的卡會先載一張別的圖再換掉 (多一次下載, 畫面也閃一下)。
   */
  const [rowsOf, setRowsOf] = useState<Map<string, Map<string, MemberPairRow>>>(() => new Map());
  const [failed, setFailed] = useState(false);
  const wantRows = types.length > 0 || pickedPairs.length > 0;
  const missing = useMemo(
    () => (wantRows ? picked.filter((id) => !rowsOf.has(id)) : []),
    [picked, rowsOf, wantRows],
  );
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
  const catalogById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  /** 圖鑑子集裡找不到的 (網址被亂改 / 下架) 直接略過 */
  const pairRecs = useMemo(
    () => pickedPairs.flatMap((id) => catalogById.get(id) ?? []),
    [catalogById, pickedPairs],
  );
  const pickedSet = useMemo(() => new Set(pickedPairs), [pickedPairs]);
  const loadingAny = missing.length > 0;

  /** 每個屬性要列哪幾組 (最新上架在前, 與卡牆預設排序一樣) —— 跟成員怎麼排無關, 先算 */
  const typeRows = useMemo(() => {
    if (columns.length === 0) return [];
    return ALL_TYPES.filter((t) => types.includes(t)).map((type) => ({
      type,
      recs: catalog
        .filter((p) => p.type === type)
        .filter((p) =>
          scope === "gym" ? gymSet.has(p.pairId) : columns.some((m) => rowsOf.get(m.id)?.has(p.pairId)),
        )
        .sort(byRelease),
    }));
  }, [catalog, columns, gymSet, rowsOf, scope, types]);

  /** 畫面上有的道具分組 (資源那一排選了哪幾組) */
  const resGroupDefs = useMemo(() => CANDY_GROUPS.filter((g) => res.includes(g.key as CompareResKey)), [res]);
  const candyKeys = useMemo(() => new Set<string>(resGroupDefs.flatMap((g) => g.types)), [resGroupDefs]);

  /** 排序只看現在畫面上有的欄 (屬性 / 資源取消掉的那幾欄留著也看不到是誰在排) */
  const activeSort = useMemo(() => {
    const visible = new Set([
      ...pickedPairs,
      ...typeRows.flatMap((g) => g.recs.map((r) => r.pairId)),
      ...candyKeys,
    ]);
    return sort.filter((id) => visible.has(id));
  }, [candyKeys, pickedPairs, sort, typeRows]);

  /**
   * 成員的順序 —— **全部表格共用一份** (拍組表與資源表都是), 同一個人在每張表的位置一樣。
   * 一欄的值: 拍組 = 寶數 (0-10), 道具 = 數量; 一律高到低, 前一層同分才看下一層。
   */
  const { ordered, bySort, roster } = useMemo(() => {
    const valueOf = (m: CompareMember, key: string) =>
      candyKeys.has(key)
        ? (candyOf?.get(m.id)?.[key as CandyType] ?? 0)
        : (rowsOf.get(m.id)?.get(key)?.grade ?? 0);
    const roster = new Map(columns.map((m, i) => [m.id, i]));
    const bySort = (a: CompareMember, b: CompareMember) => {
      for (const id of activeSort) {
        const d = valueOf(b, id) - valueOf(a, id);
        if (d) return d;
      }
      return 0;
    };
    // 排序要用的資料還沒抓回來時照名冊排 (不然抓回來的那一刻整排跳一次)
    const waiting = loadingAny || (candyOf === null && activeSort.some((k) => candyKeys.has(k)));
    const ordered = waiting
      ? columns
      : [...columns].sort((a, b) => bySort(a, b) || roster.get(a.id)! - roster.get(b.id)!);
    return { ordered, bySort, roster };
  }, [activeSort, candyKeys, candyOf, columns, loadingAny, rowsOf]);

  /**
   * 每張表一份 (指定拍組在最前面)。格子 cells[拍組][人] 在這裡就建好 ——
   * 每次 render 重建的話 PairCell 的 memo 等於白掛; 手機與電腦兩種排法吃的是同一份。
   */
  const groups = useMemo<CompareGroup[]>(() => {
    if (columns.length === 0) return [];
    const gradeOf = (m: CompareMember, pairId: string) => rowsOf.get(m.id)?.get(pairId)?.grade ?? 0;

    const build = (
      key: string,
      type: SyncPairType | null,
      recs: ClientPairRecord[],
      cols: CompareMember[],
      rest: CompareMember[],
    ): CompareGroup => ({
      key,
      type,
      columns: cols,
      rest,
      // 這張表一共比了幾個人 (含收在下面那一行的), 欄頭的「持有 n / total」用
      total: cols.length + rest.length,
      rows: recs.map((rec) => ({
        rec,
        // 指定拍組本來就混著道館名單內外, ★ 一律標; 屬性表只在「所有遊戲拍組」時標 (道館拍組那頁全是)
        starred: (type === null || scope === "all") && gymSet.has(rec.pairId),
        holders: cols.filter((m) => rowsOf.get(m.id)?.has(rec.pairId)).length,
        // null = 那個人的練度還沒抓回來 (畫骨架)
        cells: cols.map((m) => {
          const mine = rowsOf.get(m.id);
          return mine ? cellOf(rec.type as SyncPairType, rec, mine.get(rec.pairId)) : null;
        }),
      })),
      // 每個人在這張表有幾組 (欄頭 / 列頭那顆頭像底下)
      owned: cols.map((m) => {
        const mine = rowsOf.get(m.id);
        return mine ? recs.filter((rec) => mine.has(rec.pairId)).length : null;
      }),
    });

    const out: CompareGroup[] = [];
    if (pairRecs.length > 0) {
      if (loadingAny) {
        out.push(build("picked", null, pairRecs, columns, []));
      } else {
        const scored = ordered.map((m) => {
          const gs = pairRecs.map((p) => gradeOf(m, p.pairId));
          return { m, n: gs.filter((g) => g > 0).length, sum: gs.reduce((a, b) => a + b, 0) };
        });
        const has = scored
          .filter((r) => r.n > 0)
          // 有點排序就照排序; 同分 (或沒點) 才看有幾組 → 寶數加總 → 名冊順序
          .sort((a, b) => bySort(a.m, b.m) || b.n - a.n || b.sum - a.sum || roster.get(a.m.id)! - roster.get(b.m.id)!)
          .map((r) => r.m);
        out.push(build("picked", null, pairRecs, has, scored.filter((r) => r.n === 0).map((r) => r.m)));
      }
    }
    // 屬性表也一樣: 這個屬性一組都沒有的人收成下面那一行 (順序照舊是共用的那一份)
    for (const g of typeRows) {
      if (loadingAny) {
        out.push(build(g.type, g.type, g.recs, ordered, []));
        continue;
      }
      const ownsAny = (m: CompareMember) => g.recs.some((rec) => rowsOf.get(m.id)?.has(rec.pairId));
      out.push(build(g.type, g.type, g.recs, ordered.filter(ownsAny), ordered.filter((m) => !ownsAny(m))));
    }
    return out;
  }, [bySort, columns, gymSet, loadingAny, ordered, pairRecs, roster, rowsOf, scope, typeRows]);

  /**
   * 資源表: 一組道具一張 (欄 = 道具, 格子 = 數量), 投入屬性一張 (欄 = 想投入 / 已投入較多)。
   * 成員順序是上面共用的那一份; 這張表什麼都沒有的人一樣收成下面一行。
   */
  const resGroups = useMemo<ResGroup[]>(() => {
    if (columns.length === 0) return [];
    const out: ResGroup[] = [];
    for (const def of resGroupDefs) {
      if (!candyOf) {
        out.push({ kind: "items", key: def.key, label: def.label, items: def.types, columns: ordered, rest: [], values: null });
        continue;
      }
      const has = (m: CompareMember) => def.types.some((t) => (candyOf.get(m.id)?.[t] ?? 0) > 0);
      const cols = ordered.filter(has);
      out.push({
        kind: "items",
        key: def.key,
        label: def.label,
        items: def.types,
        columns: cols,
        rest: ordered.filter((m) => !has(m)),
        values: cols.map((m) => def.types.map((t) => candyOf.get(m.id)?.[t] ?? 0)),
      });
    }
    if (res.includes("focus")) {
      if (!focusOf) {
        out.push({ kind: "focus", key: "focus", label: FOCUS_LABEL, columns: ordered, rest: [], values: null });
      } else {
        const has = (m: CompareMember) => TYPE_FOCUS_KINDS.some((k) => (focusOf.get(m.id)?.[k].length ?? 0) > 0);
        const cols = ordered.filter(has);
        out.push({
          kind: "focus",
          key: "focus",
          label: FOCUS_LABEL,
          columns: cols,
          rest: ordered.filter((m) => !has(m)),
          values: cols.map((m) => focusOf.get(m.id) ?? emptyTypeFocus()),
        });
      }
    }
    return out;
  }, [candyOf, columns.length, focusOf, ordered, res, resGroupDefs]);
  const resLoading = (wantCandies && candyOf === null) || (wantFocus && focusOf === null);

  /** 有沒有拍組表 (屬性 / 指定拍組) —— 精簡 / 卡片那顆切換只管它們 */
  const pairTables = types.length > 0 || pairRecs.length > 0;
  const ready = columns.length > 0 && (pairTables || res.length > 0);
  const sortRank = (pairId: string) => activeSort.indexOf(pairId);

  /**
   * 下載圖片 = 畫面上這幾張精簡表格 (同一份 groups: 順序、排序、收起來的人都一樣)。
   * 畫圖的程式只在按下去時才載 (compare-image.ts), 不進成員頁的首包。
   */
  const [exporting, setExporting] = useState(false);
  const exportImage = async () => {
    setExporting(true);
    try {
      const { exportCompareImage } = await import("./compare-image");
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
      const hasTypes = groups.some((g) => g.type !== null);
      const em = (m: CompareMember) => ({ m, label: memberCallName(m) });
      const title = groups.length === 0 ? "資源" : resGroups.length === 0 ? "拍組持有" : "拍組持有與資源";
      await exportCompareImage(
        [
          ...groups.map((g) => ({
            kind: "pairs" as const,
            type: g.type,
            pairs: g.rows.map(({ rec, starred, holders }) => ({ rec, starred, holders })),
            total: g.total,
            members: g.columns.map((m, mi) => ({
              em: em(m),
              grades: g.rows.map(({ cells }) => gradeOfCell(cells[mi] ?? null)),
            })),
            restNote: restLine(g.rest, g.rows.length > 1, "沒有"),
            empty:
              g.rows.length === 0
                ? scope === "gym"
                  ? "道館名單上沒有這個屬性的拍組"
                  : "選到的人都沒有這個屬性的拍組"
                : g.columns.length === 0
                  ? "選到的人都沒有"
                  : undefined,
          })),
          ...resGroups.map((g) =>
            g.kind === "items"
              ? {
                  kind: "items" as const,
                  label: g.label,
                  items: g.items,
                  members: g.columns.map((m, mi) => ({ em: em(m), counts: g.values?.[mi] ?? [] })),
                  restNote: restLine(g.rest, g.items.length > 1, "沒有"),
                  empty: g.columns.length === 0 ? "選到的人都沒有" : undefined,
                }
              : {
                  kind: "focus" as const,
                  label: g.label,
                  members: g.columns.map((m, mi) => ({ em: em(m), focus: g.values?.[mi] ?? emptyTypeFocus() })),
                  restNote: restLine(g.rest, true, "還沒選"),
                  empty: g.columns.length === 0 ? "選到的人都還沒選" : undefined,
                },
          ),
        ],
        {
          title,
          subtitle: hasTypes ? `${date} · ${scope === "gym" ? "道館拍組" : "所有遊戲拍組"}` : date,
          filename: `${title}-${date}.png`,
        },
      );
    } catch {
      toast.error("圖片匯出失敗");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4" data-compare>
      <h2 className="hidden text-lg font-semibold lg:block">比較</h2>

      {/* 選人 / 選屬性 / 選拍組 —— 手機一排橫捲 (與篩選列的屬性 chips 同一種), 桌機折行 */}
      <div className="space-y-2">
        <PickRow label="成員">
          <Chip active={allPicked} onClick={toggleAll} title="全部成員">
            <span className="whitespace-nowrap">全部</span>
          </Chip>
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
        <div ref={pairPickRef} className="space-y-2">
          {/* 「＋ 拍組」放最前面: 手機這一排是橫捲的, 放在最後面選了兩三組就被擠出畫面 */}
          <PickRow label="拍組">
            <Chip active={pickingPair} onClick={() => setPickingPair((v) => !v)} title="指定拍組">
              <Plus className="h-4 w-4" />
              <span className="whitespace-nowrap">拍組</span>
            </Chip>
            {pairRecs.map((p) => (
              <Chip key={p.pairId} active onClick={() => togglePair(p.pairId)} title={`拿掉 ${pairName(p)}`}>
                <TypeIcon type={p.type as SyncPairType} className="h-5 w-5" />
                <span className="max-w-40 truncate whitespace-nowrap">{pairName(p)}</span>
                <X className="h-3.5 w-3.5 opacity-60" />
              </Chip>
            ))}
          </PickRow>
          {/* 隊伍庫那一塊搜尋面板 (PairPicker 開出來的同一個元件) —— 不要另外刻一份 */}
          {pickingPair ? (
            <PairSearchPanel
              className="bg-muted/30"
              catalog={catalog}
              chosen={pickedSet}
              full={pickedPairs.length >= MAX_COMPARE_PAIRS}
              countLabel={`已選 ${pickedPairs.length}/${MAX_COMPARE_PAIRS}`}
              onToggle={togglePair}
              onClose={() => setPickingPair(false)}
            />
          ) : null}
        </div>
        {/* 背包: 分組與 /resources、成員頁「資源」分頁同一份 CANDY_GROUPS; 最後一顆是那兩塊投入屬性 */}
        <PickRow label="資源">
          {CANDY_GROUPS.map((g) => (
            <Chip
              key={g.key}
              active={res.includes(g.key as CompareResKey)}
              onClick={() => toggleRes(g.key as CompareResKey)}
              title={g.label}
            >
              <CandyIcon type={g.types[0]!} size={20} />
              <span className="whitespace-nowrap">{g.label}</span>
            </Chip>
          ))}
          <Chip active={res.includes("focus")} onClick={() => toggleRes("focus")} title={FOCUS_LABEL}>
            <span className="whitespace-nowrap">{FOCUS_LABEL}</span>
          </Chip>
        </PickRow>
      </div>

      <div className="flex items-end gap-2 border-b">
        {/* 範圍只管屬性表 (指定拍組與資源表都不吃它) —— 沒選屬性就不擺一組按了沒反應的分頁 */}
        <nav className="flex min-w-0 flex-1 gap-1">
          {(types.length > 0 ? (["gym", "all"] as const) : []).map((v) => (
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
        <div className="flex shrink-0 items-center gap-1 pb-1">
          {activeSort.length > 0 ? (
            <button
              type="button"
              onClick={clearSort}
              className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
            >
              <X className="h-3.5 w-3.5" />
              排序
            </button>
          ) : null}
          {/* 「顯示」只管卡片上多畫什麼 —— 精簡表格畫不出那些, 不要擺一個按了沒反應的鈕 */}
          {cards ? <CardInfoSelect value={show} onChange={setShow} /> : null}
          {/* 下載的是精簡表格 (那是要貼賴群的樣子); 卡片表照舊自己截圖 */}
          {(!cards || !pairTables) && ready ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              disabled={exporting || loadingAny || failed || resLoading || resFailed}
              onClick={() => void exportImage()}
              title="下載圖片"
              data-compare-download
            >
              <Download className="h-4 w-4" />
              <span className="max-sm:sr-only">下載</span>
            </Button>
          ) : null}
          {/* 精簡 / 卡片只換拍組表的格子 —— 只有資源表時不擺 */}
          {pairTables ? (
            <div className="inline-flex h-9 overflow-hidden rounded-md border pointer-coarse:h-11" role="group">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setCards(v)}
                  aria-pressed={cards === v}
                  aria-label={v ? "卡片" : "精簡"}
                  title={v ? "卡片" : "精簡"}
                  data-compare-mode={v ? "cards" : "dense"}
                  className={cn(
                    "inline-flex w-9 items-center justify-center transition-colors pointer-coarse:w-11",
                    cards === v ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  {v ? <LayoutGrid className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {!ready ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {columns.length === 0 ? "選擇要比較的成員" : "選擇屬性、拍組或資源"}
        </p>
      ) : failed && missing.length > 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          讀取成員的拍組失敗, 請重新整理
        </p>
      ) : (
        // 精簡表格很窄 (三組拍組 ≈ 400px): 電腦上一張張橫著排, 一屏看得到好幾張; 卡片表照舊一張一列
        <div className={cn(cards ? "space-y-6" : "flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-start")}>
          {groups.map((g, gi) => (
            <section key={g.key} data-compare-type={g.type ?? "picked"} className={cn(!cards && "min-w-0 max-w-full")}>
              {/* 屬性徽章那一列 —— 與卡牆 (PairTypeGrid) 同一個長相 */}
              <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-1.5">
                {g.type ? <TypeBadge type={g.type} /> : <Badge variant="secondary">指定拍組</Badge>}
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
              ) : g.columns.length === 0 ? (
                <p className="text-xs text-muted-foreground">選到的人都沒有</p>
              ) : !cards ? (
                <DenseTable group={g} eager={gi === 0} sortRank={sortRank} onSort={toggleSort} />
              ) : (
                <>
                  <PairsDownTable
                    group={g}
                    columns={g.columns}
                    eager={gi === 0}
                    show={show}
                    potentials={potentials}
                    sortRank={sortRank}
                    onSort={toggleSort}
                  />
                  <MembersDownTable
                    group={g}
                    columns={g.columns}
                    eager={gi === 0}
                    show={show}
                    potentials={potentials}
                    sortRank={sortRank}
                    onSort={toggleSort}
                  />
                </>
              )}
              {g.rest.length > 0 && g.columns.length > 0 ? (
                // w-0 min-w-full: 跟表格一樣寬就折行, 不要把橫排的精簡表格撐開
                <p className="mt-2 w-0 min-w-full text-xs text-muted-foreground" data-compare-rest>
                  {restLine(g.rest, g.rows.length > 1, "沒有")}
                </p>
              ) : null}
            </section>
          ))}
          {resGroups.map((g) => (
            <section key={g.key} data-compare-res={g.key} className={cn(!cards && "min-w-0 max-w-full")}>
              <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-1.5">
                <Badge variant="secondary" className="gap-1">
                  {g.kind === "items" ? <CandyIcon type={g.items[0]!} size={16} /> : null}
                  {g.label}
                </Badge>
              </div>
              {resFailed && !g.values ? (
                <p className="text-xs text-muted-foreground">讀取資源失敗, 請重新整理</p>
              ) : g.columns.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {g.kind === "focus" ? "選到的人都還沒選" : "選到的人都沒有"}
                </p>
              ) : g.kind === "items" ? (
                <ItemTable group={g} sortRank={sortRank} onSort={toggleSort} />
              ) : (
                <FocusTable group={g} />
              )}
              {g.rest.length > 0 && g.columns.length > 0 ? (
                <p className="mt-2 w-0 min-w-full text-xs text-muted-foreground" data-compare-rest>
                  {restLine(g.rest, g.kind === "focus" || g.items.length > 1, g.kind === "focus" ? "還沒選" : "沒有")}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type CompareGroup = {
  key: string;
  /** null = 指定拍組那張表 */
  type: SyncPairType | null;
  rows: {
    rec: ClientPairRecord;
    starred: boolean;
    /** 這張表的人裡有幾個有這組 */
    holders: number;
    cells: (GridItem | null)[];
  }[];
  /** 這張表的人 (已經照排序排好) */
  columns: CompareMember[];
  owned: (number | null)[];
  /** 這張表一組都沒有、收成表格下面一行的人 */
  rest: CompareMember[];
  total: number;
};
type TableProps = {
  group: CompareGroup;
  columns: CompareMember[];
  /** 這是第一張表 → 前幾張卡直接帶圖 */
  eager: boolean;
  show: CardInfoKey[];
  potentials: PotentialData | null;
  /** 這組拍組是第幾層排序 (-1 = 沒在排) */
  sortRank: (pairId: string) => number;
  onSort: (pairId: string) => void;
};

/** 資源表 (2026-11-06 使用者:「可以再幫我加比較資源的部分嗎?」) —— values 是 null = 還沒抓回來 (畫骨架) */
type ResGroup =
  | {
      kind: "items";
      key: string;
      label: string;
      items: CandyType[];
      columns: CompareMember[];
      rest: CompareMember[];
      /** values[人][道具] = 數量 */
      values: number[][] | null;
    }
  | {
      kind: "focus";
      key: "focus";
      label: string;
      columns: CompareMember[];
      rest: CompareMember[];
      values: TypeFocus[] | null;
    };

/** 資源那一排最後一顆 = /resources 的「想投入 / 已投入較多資源的屬性」那兩塊 */
const FOCUS_LABEL = "投入屬性";

/** 表格下面那一行 (畫面與匯出圖同一句); 沒有人被收起來 = null */
function restLine(rest: CompareMember[], many: boolean, verb: string): string | null {
  if (rest.length === 0) return null;
  return `其餘 ${rest.length} 人${many ? "都" : ""}${verb}：${rest.map(memberCallName).join("、")}`;
}

/** 道具那一欄 —— 手機 390 寬扣掉人名那一欄放得下七種 (糖果那一組) */
const ITEM_W = "w-8 sm:w-11";
/** 投入屬性那一欄 —— 手機放得下兩欄 (一行四顆屬性圖示) */
const FOCUS_W = "w-24 sm:w-44";

/** 表格只有內容那麼寬 (w-fit), 不撐滿 —— 撐滿的話三個人的欄位會隔三百多 px, 橫著比很吃力 */
const TABLE_BOX = "w-fit max-w-full overflow-x-auto rounded-xl border bg-card";
/** border-separate: collapse 模式下 sticky 那一欄的框線不會跟著走 */
const TABLE = "w-max border-separate border-spacing-0 text-sm [&>tbody>tr:last-child>*]:border-b-0";

/** 手機: 一列一組拍組、人在上面 (拍組名是卡片上面橫跨整列的一行, 字 sticky 在左邊) */
function PairsDownTable({ group: g, columns, eager, show, potentials, sortRank, onSort }: TableProps) {
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
                <th scope="colgroup" colSpan={columns.length} className="px-1 pb-0.5 pt-1.5 text-left font-normal">
                  <SortButton rank={sortRank(rec.pairId)} onClick={() => onSort(rec.pairId)} className="sticky left-1 flex w-max">
                    <PairLabel rec={rec} starred={starred} className="text-xs font-medium text-foreground/80" />
                  </SortButton>
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
function MembersDownTable({ group: g, columns, eager, show, potentials, sortRank, onSort }: TableProps) {
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
                className="px-1 pb-1 pt-1.5 align-bottom font-normal"
                data-compare-pair={rec.pairId}
              >
                <SortButton
                  rank={sortRank(rec.pairId)}
                  onClick={() => onSort(rec.pairId)}
                  className="mx-auto w-24 flex-col"
                >
                  <PairLabel
                    rec={rec}
                    starred={starred}
                    className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/80"
                  />
                </SortButton>
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

/** 精簡表格的欄寬 —— 手機 390 寬扣掉人名那一欄放得下四組 */
const DENSE_W = "w-16 sm:w-20";

/**
 * 精簡: 一列一個人 (手機也是), 拍組在欄頭 (卡片 + 名字 + 持有人數), 格子是那顆寶數。
 * 人名那一欄 sticky —— 屬性表拍組一多就要橫捲, 捲過去還要知道這一列是誰。
 */
function DenseTable({
  group: g,
  eager,
  sortRank,
  onSort,
}: {
  group: CompareGroup;
  eager: boolean;
  sortRank: (pairId: string) => number;
  onSort: (pairId: string) => void;
}) {
  return (
    <div className={TABLE_BOX} data-compare-layout="dense">
      <table className={TABLE}>
        <thead>
          <tr className="[&>*]:border-b [&>*]:bg-muted">
            <th className="sticky left-0 z-20" aria-hidden />
            {g.rows.map(({ rec, starred, holders }) => (
              <th
                key={rec.pairId}
                scope="col"
                className="px-0.5 pb-1 pt-1.5 align-bottom font-normal"
                data-compare-pair={rec.pairId}
              >
                <SortButton
                  rank={sortRank(rec.pairId)}
                  onClick={() => onSort(rec.pairId)}
                  className={cn("relative mx-auto flex-col gap-0.5 px-0.5", DENSE_W)}
                  badgeClassName="absolute right-0 top-0"
                >
                  <SyncPairCard pair={rec} size="sm" eager={eager} showName={false} className="w-10 sm:w-12" />
                  {/* ★ 疊在左上角 —— 寫在名字前面的話, 長名字 (沒有空白可以斷) 會把 ★ 單獨擠成一行 */}
                  {starred ? (
                    <span className="absolute left-0.5 top-0 text-xs text-amber-500" title="已是道館拍組">
                      ★
                    </span>
                  ) : null}
                  <PairLabel
                    rec={rec}
                    starred={false}
                    noStatus
                    className="line-clamp-2 w-full break-keep text-center text-[10px] leading-tight text-foreground/80 [overflow-wrap:anywhere]"
                  />
                  <span className="text-[10px] leading-none text-muted-foreground tabular-nums">
                    {holders}/{g.total}
                  </span>
                </SortButton>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.columns.map((m, mi) => (
            <tr key={m.id} className={DENSE_ROW}>
              <MemberHead m={m} />
              {g.rows.map(({ rec, cells }) => (
                <td key={rec.pairId} className="h-9 px-0.5 text-center align-middle" data-compare-cell={m.id}>
                  <DenseCell item={cells[mi] ?? null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 精簡表格 (拍組與資源) 的一列 */
const DENSE_ROW = "[&>*]:border-b [&>*]:border-border/60 hover:[&>*]:bg-muted";

/** 精簡表格最左邊那一格: 頭像 28px (AGENTS 的密集列尺寸) + 名字; sticky —— 橫捲時還要知道這一列是誰 */
function MemberHead({ m }: { m: CompareMember }) {
  return (
    <th
      scope="row"
      className="sticky left-0 z-10 bg-card px-2 py-0 text-left align-middle font-normal"
      data-compare-member={m.id}
    >
      <span className="flex w-28 items-center gap-1.5 sm:w-36" title={memberLabel(m)}>
        <MemberAvatar member={m} size="sm" className="h-7 w-7 shrink-0 text-[11px]" />
        <span className="min-w-0 flex-1 truncate text-sm">{memberCallName(m)}</span>
      </span>
    </th>
  );
}

/**
 * 道具表: 一列一個人, 欄頭是背包那一格的長相 (CandyPlate, 稀有度的底盤), 格子是數量, 0 就空著
 * (與拍組表「沒有就空著」同一個讀法)。欄頭一樣是排序鈕 —— 用數量排, 跟拍組的寶數疊在同一串排序裡。
 */
function ItemTable({
  group: g,
  sortRank,
  onSort,
}: {
  group: Extract<ResGroup, { kind: "items" }>;
  sortRank: (key: string) => number;
  onSort: (key: string) => void;
}) {
  return (
    <div className={TABLE_BOX} data-compare-layout="items">
      <table className={TABLE}>
        <thead>
          <tr className="[&>*]:border-b [&>*]:bg-muted">
            <th className="sticky left-0 z-20" aria-hidden />
            {g.items.map((t) => (
              <th key={t} scope="col" className="px-0 pb-1 pt-1.5 align-bottom font-normal" data-compare-item={t}>
                <SortButton
                  rank={sortRank(t)}
                  onClick={() => onSort(t)}
                  title={`${CANDY_LABELS[t]}${sortRank(t) >= 0 ? " · 取消排序" : " · 用數量排序"}`}
                  className={cn("relative mx-auto justify-center px-0", ITEM_W)}
                  // 不要往右凸出去 (-right-*): 最後一欄的徽章會把整張表撐寬 4px, 手機上就多一段橫捲
                  badgeClassName="absolute -top-1 right-0"
                >
                  <CandyPlate type={t} size={30} />
                </SortButton>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.columns.map((m, mi) => (
            <tr key={m.id} className={DENSE_ROW}>
              <MemberHead m={m} />
              {g.items.map((t, ti) => {
                const n = g.values ? (g.values[mi]?.[ti] ?? 0) : null;
                return (
                  <td
                    key={t}
                    className="h-9 px-0 text-center align-middle text-xs font-semibold tabular-nums sm:text-sm"
                    data-compare-cell={m.id}
                  >
                    {n === null ? (
                      <Sk className="mx-auto h-4 w-5 rounded" />
                    ) : n > 0 ? (
                      <span data-compare-count={t}>{n}</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 投入屬性: 一列一個人, 兩欄 (想投入 / 已投入較多), 格子是選了的那幾個屬性圖示 (遊戲的 18 屬性順序) */
function FocusTable({ group: g }: { group: Extract<ResGroup, { kind: "focus" }> }) {
  return (
    <div className={TABLE_BOX} data-compare-layout="focus">
      <table className={TABLE}>
        <thead>
          <tr className="[&>*]:border-b [&>*]:bg-muted">
            <th className="sticky left-0 z-20" aria-hidden />
            {TYPE_FOCUS_KINDS.map((k) => (
              <th
                key={k}
                scope="col"
                className="px-2 pb-1.5 pt-2 text-left align-bottom text-[11px] font-medium leading-tight text-muted-foreground"
              >
                {/* 不加 break-keep: 中文沒有空白可以斷, 鎖住的話「已投入較多資源的屬性」會凸出欄外撐出橫捲 */}
                <span className={cn("block", FOCUS_W)}>{TYPE_FOCUS_LABELS[k]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.columns.map((m, mi) => (
            <tr key={m.id} className={DENSE_ROW}>
              <MemberHead m={m} />
              {TYPE_FOCUS_KINDS.map((k) => {
                const list = g.values ? (g.values[mi]?.[k] ?? []) : null;
                return (
                  <td key={k} className="h-9 px-2 py-1 align-middle" data-compare-cell={m.id} data-compare-focus={k}>
                    {list === null ? (
                      <Sk className="h-5 w-16 rounded" />
                    ) : (
                      <span className={cn("flex flex-wrap gap-0.5", FOCUS_W)}>
                        {list.map((t) => (
                          <span key={t} role="img" aria-label={TYPE_LABELS[t]} title={TYPE_LABELS[t]} data-compare-type-icon={t}>
                            <TypeIcon type={t} className="h-5 w-5" />
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** GridItem 把那條 0-10 的軸拆成寶數 + 超覺醒 (給卡面用的), 這裡組回去; 沒有 = 0 */
function gradeOfCell(item: GridItem | null): number {
  if (!item?.owned) return 0;
  return (item.superAwakening ?? 0) > 0 ? 5 + item.superAwakening! : (item.potential ?? 0);
}

/**
 * 精簡的一格: 跟「全館拍組」側板的持有者 chip 同一顆 `GradeBadge` (寶1-5 / 超覺醒1-5);
 * 沒有就空著; 還沒抓回來是骨架。
 */
function DenseCell({ item }: { item: GridItem | null }) {
  if (!item) return <Sk className="mx-auto h-5 w-10 rounded-md" />;
  if (!item.owned) return null;
  const grade = gradeOfCell(item);
  return (
    <span data-compare-grade>
      <GradeBadge grade={grade} />
    </span>
  );
}

/**
 * 拍組名 = 排序鈕: 點一下用這組的寶數排 (高到低, 加在最後一層), 再點一下拿掉。
 * 在排的那幾組名字後面有「↓1」「↓2」= 第幾層; 沒在排的只在 hover 時露一個淡淡的箭頭
 * (觸控沒有 hover, 常駐淡淡的一個)。
 */
function SortButton({
  rank,
  onClick,
  className,
  badgeClassName,
  title,
  children,
}: {
  rank: number;
  onClick: () => void;
  className?: string;
  /** 精簡表格把「↓1」疊在卡片右上角 (不另外多佔一行) */
  badgeClassName?: string;
  /** 不給就是拍組的說法 (道具欄排的是數量, 而且要把道具名寫進去 —— 欄頭只有圖) */
  title?: string;
  children: React.ReactNode;
}) {
  const on = rank >= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title ?? (on ? "取消這組的排序" : "用這組的寶數排序")}
      data-compare-sort={on ? rank + 1 : undefined}
      className={cn(
        "group inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-accent/60 pointer-coarse:min-h-11",
        className,
      )}
    >
      {children}
      <span className={cn("inline-flex h-4 shrink-0 items-center", badgeClassName)}>
        {on ? (
          <span className="inline-flex items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums">
            <ArrowDown className="h-2.5 w-2.5" />
            {rank + 1}
          </span>
        ) : (
          <ArrowDown className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 pointer-coarse:opacity-40" />
        )}
      </span>
    </button>
  );
}

function OwnedCount({ n }: { n: number | null }) {
  return <span className="block text-[11px] text-muted-foreground">{n === null ? "…" : `${n} 組`}</span>;
}

function PairLabel({
  rec,
  starred,
  noStatus = false,
  className,
}: {
  rec: ClientPairRecord;
  starred: boolean;
  /** 不畫 NEW / 未上線 (精簡表格的欄只有 64px, 那兩個字會把名字擠掉一半) */
  noStatus?: boolean;
  className: string;
}) {
  return (
    <span className={className} title={pairName(rec)}>
      {starred ? (
        <span className="mr-0.5 text-amber-500" title="已是道館拍組">
          ★
        </span>
      ) : null}
      {noStatus ? null : <PairStatusTag pair={rec} />}
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
