// 拍組篩選的共用純邏輯 — /pairs 與 /inventory 同一份 (曾各抄一份而長歪)。
// 多選語意: 同一面向內是「或」(選了電+水 = 電或水), 面向之間是「且」; 空陣列 = 不限。

import { roleAssetToRole } from "@/data/sync-pairs";
import type { ClientPairRecord } from "@/lib/pairs/types";

export type PairFilters = {
  search: string;
  /** 屬性 (多選, 空 = 全部) */
  types: string[];
  /** 角色定位 (多選) */
  roles: string[];
  /** 系列 (多選) */
  series: string[];
  /** 地區 (多選) */
  regions: string[];
  /** 原始星級 (多選, 3/4/5) — 圖鑑星級一律 basePotential */
  stars: number[];
  /** 只看可超覺醒 */
  awakenOnly: boolean;
};

export const EMPTY_PAIR_FILTERS: PairFilters = {
  search: "",
  types: [],
  roles: [],
  series: [],
  regions: [],
  stars: [],
  awakenOnly: false,
};

/** 搜尋比對用字串 (中英名 + 地區) */
export function pairHaystack(p: ClientPairRecord): string {
  return `${p.trainerName} ${p.pokemonName} ${p.trainerNameZh ?? ""} ${p.pokemonNameZh ?? ""} ${p.region ?? ""}`.toLowerCase();
}

/**
 * 拍組本身的面向比對 (屬性/角色/系列/地區/星級/可超覺醒)。
 * 「我有沒有」「是不是道館指定」不是拍組的屬性 — 那是分頁在決定的, 不要塞進篩選器。
 * q = 已 trim().toLowerCase() 的搜尋字 (呼叫端用 useDeferredValue 後傳入)。
 */
export function matchesPairFilters(p: ClientPairRecord, f: PairFilters, q: string): boolean {
  if (f.types.length > 0 && !f.types.includes(p.type)) return false;
  if (f.series.length > 0) {
    // 徽章 (series) 或取得管道任一命中 — BP 兌換的大師拍組兩邊都要找得到
    const hit =
      f.series.includes(p.series ?? "general") ||
      (p.acquisitions ?? []).some((a) => f.series.includes(a));
    if (!hit) return false;
  }
  if (f.roles.length > 0) {
    const role = roleAssetToRole(p.roleAsset);
    if (!role || !f.roles.includes(role)) return false;
  }
  if (f.regions.length > 0 && !(p.region && f.regions.includes(p.region))) return false;
  if (f.stars.length > 0 && !f.stars.includes(Math.min(5, p.basePotential ?? 0))) return false;
  if (f.awakenOnly && p.hasAwakening !== true) return false;
  if (q && !pairHaystack(p).includes(q)) return false;
  return true;
}

/** 是否有任何啟用中的條件 (「清除」鈕的顯示依據) */
export function hasActiveFilters(f: PairFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.types.length > 0 ||
    f.roles.length > 0 ||
    f.series.length > 0 ||
    f.regions.length > 0 ||
    f.stars.length > 0 ||
    f.awakenOnly
  );
}
