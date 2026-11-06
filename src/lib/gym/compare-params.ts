// 成員頁「比較」的網址參數 —— **這支不可以標 "use client"**。
// page.tsx (server) 要用 parse 讀初始值, compare-view (client) 要用 serialize 寫回去;
// 從標了 use client 的檔案 import 到的是 client reference 不是函式, 整頁直接掛掉
// (url-params.ts 2026-09-08、activity-filters.ts 2026-09-10 都踩過同一個坑)。
//
// 三個參數 (都是逗號分隔, 與 ?show= 同一個寫法):
//   cmp   = 要比的成員, 每人取 id 的短碼 (url-params 的 shortId); 沒帶 = 只選自己, none = 全部取消,
//           all = 全部 (2026-11-06 使用者:「人員應該要可以選全部」—— 寫成 all 而不是 20 個短碼:
//           網址短, 而且之後有新成員加入, 貼出去的連結照樣是「全部」)
//   types = 要比的屬性 (遊戲內順序)
//   pairs = 指定拍組 (pairId, 照加進來的順序 = 矩陣的欄位順序)
//   res   = 要比的資源 (背包的道具分組 / 投入屬性, 見 COMPARE_RES_KEYS)

import { ALL_TYPES } from "@/data/sync-pairs";
import type { SyncPairType } from "@/lib/supabase/types";
import { parseShortIds, resolveShortIds, serializeShortIds } from "@/lib/url-params";

/** 名冊上「比較」那一項的 id (與「全館拍組」的 __gym__ 同一種偽成員) */
export const COMPARE_ID = "__compare__";

/** ?cmp= 的「全部」 */
export const COMPARE_ALL = "all";

/** ?cmp= → 短碼清單。`null` = 網址沒帶 (用預設: 只選自己); `[]` = 明確清空; `"all"` = 全部 */
export function parseCompareMembers(raw: string | string[] | undefined): string[] | null | typeof COMPARE_ALL {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === COMPARE_ALL) return COMPARE_ALL;
  return parseShortIds(raw);
}

/** 短碼 (或 all) → 名冊上的成員 id (照名冊順序) */
export function resolveCompareMembers(short: readonly string[] | typeof COMPARE_ALL, ids: readonly string[]): string[] {
  return short === COMPARE_ALL ? [...ids] : resolveShortIds(short, ids);
}

/**
 * 寫回網址: 等於預設 (只選自己) 就不留; 名冊上的人全選了寫 all。
 * (只有一位成員時「全部」= 預設, 走前面那條不留。)
 */
export function serializeCompareMembers(
  ids: readonly string[],
  defaults: readonly string[],
  allIds: readonly string[],
): string | null {
  const fromDefault = serializeShortIds(ids, defaults);
  if (fromDefault === null) return null;
  const picked = new Set(ids);
  if (allIds.length > 0 && allIds.every((id) => picked.has(id))) return COMPARE_ALL;
  return fromDefault;
}

/** ?types= → 屬性清單 (照遊戲內順序, 重複與不認得的丟掉) */
export function parseCompareTypes(raw: string | string[] | undefined): SyncPairType[] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return [];
  const picked = new Set(v.split(","));
  return ALL_TYPES.filter((t) => picked.has(t));
}

export function serializeCompareTypes(types: readonly SyncPairType[]): string | null {
  const sorted = ALL_TYPES.filter((t) => types.includes(t));
  return sorted.length ? sorted.join(",") : null;
}

/** 指定拍組最多幾組 —— 再多矩陣就比不出東西了 (也擋住網址被塞一長串) */
export const MAX_COMPARE_PAIRS = 8;

/** ?pairs= → pairId 清單 (照網址順序, 重複的丟掉; 圖鑑裡有沒有交給呼叫端對) */
export function parseComparePairs(raw: string | string[] | undefined): string[] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return [];
  return [...new Set(v.split(",").map((s) => s.trim()))]
    .filter((s) => /^[\w-]{1,48}$/.test(s))
    .slice(0, MAX_COMPARE_PAIRS);
}

export function serializeComparePairs(pairIds: readonly string[]): string | null {
  return pairIds.length ? [...new Set(pairIds)].join(",") : null;
}

/**
 * ?res= 要比的資源 (2026-11-06 使用者:「可以再幫我加比較資源的部分嗎?」):
 * 背包的四組道具 (= candy.tsx 的 CANDY_GROUPS 的 key, 同一個順序) + 投入屬性 (member_type_focus)。
 * ⚠ 這裡是手抄的 —— candy.tsx 標了 "use client", 這支不能 import 它 (見檔頭)。
 * `tests/compare-resources.test.ts` 釘住兩邊一致。
 */
export const COMPARE_RES_KEYS = ["candy", "role", "limit", "misc", "focus"] as const;
export type CompareResKey = (typeof COMPARE_RES_KEYS)[number];

/** ?res= → 資源清單 (照固定順序, 重複與不認得的丟掉) */
export function parseCompareRes(raw: string | string[] | undefined): CompareResKey[] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return [];
  const picked = new Set(v.split(","));
  return COMPARE_RES_KEYS.filter((k) => picked.has(k));
}

export function serializeCompareRes(keys: readonly CompareResKey[]): string | null {
  const sorted = COMPARE_RES_KEYS.filter((k) => keys.includes(k));
  return sorted.length ? sorted.join(",") : null;
}
