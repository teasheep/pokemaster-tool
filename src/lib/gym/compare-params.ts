// 成員頁「比較」的網址參數 —— **這支不可以標 "use client"**。
// page.tsx (server) 要用 parse 讀初始值, compare-view (client) 要用 serialize 寫回去;
// 從標了 use client 的檔案 import 到的是 client reference 不是函式, 整頁直接掛掉
// (url-params.ts 2026-09-08、activity-filters.ts 2026-09-10 都踩過同一個坑)。
//
// 兩個參數 (都是逗號分隔, 與 ?show= 同一個寫法):
//   cmp   = 要比的成員, 每人取 id 的短碼 (url-params 的 shortId); 沒帶 = 只選自己, none = 全部取消
//   types = 要比的屬性 (遊戲內順序)

import { ALL_TYPES } from "@/data/sync-pairs";
import type { SyncPairType } from "@/lib/supabase/types";
import { parseShortIds, resolveShortIds, serializeShortIds } from "@/lib/url-params";

/** 名冊上「比較」那一項的 id (與「全館拍組」的 __gym__ 同一種偽成員) */
export const COMPARE_ID = "__compare__";

/** ?cmp= → 短碼清單。`null` = 網址沒帶 (用預設: 只選自己); `[]` = 明確清空 */
export const parseCompareMembers = parseShortIds;

/** 短碼 → 名冊上的成員 id (照名冊順序) */
export const resolveCompareMembers = resolveShortIds;

/** 寫回網址: 等於預設 (只選自己) 就不留 */
export const serializeCompareMembers = serializeShortIds;

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
