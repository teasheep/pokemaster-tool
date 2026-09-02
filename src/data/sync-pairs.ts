// 屬性 / 角色的中文標籤與顏色 + roleAsset 對應。
// (原本這裡還有 25 筆 MVP seed, 已隨資料模型收斂移除 — catalog 改由
//  src/data/pomatools-pairs.json 提供, 見 src/lib/pairs/loader.ts。)

import type { SyncPairRole, SyncPairType } from "@/lib/supabase/types";

export const TYPE_LABELS: Record<SyncPairType, string> = {
  normal: "一般",
  fire: "火",
  water: "水",
  electric: "電",
  grass: "草",
  ice: "冰",
  fighting: "格鬥",
  poison: "毒",
  ground: "地面",
  flying: "飛行",
  psychic: "超能力",
  bug: "蟲",
  rock: "岩石",
  ghost: "幽靈",
  dragon: "龍",
  dark: "惡",
  steel: "鋼",
  fairy: "妖精",
};

/** 18 屬性固定順序 (與遊戲/道館紀錄頁一致) */
export const ALL_TYPES = Object.keys(TYPE_LABELS) as SyncPairType[];

/** 屬性 → 官方 icon 檔名編號 (public/reference/ui/TYPE_0NN.webp) */
const TYPE_ICON_NO: Record<SyncPairType, string> = {
  normal: "001", fire: "002", water: "003", electric: "004", grass: "005",
  ice: "006", fighting: "007", poison: "008", ground: "009", flying: "010",
  psychic: "011", bug: "012", rock: "013", ghost: "014", dragon: "015",
  dark: "016", steel: "017", fairy: "018",
};

// 副檔名一律 .webp (scripts/convert-card-images.mjs 產); PNG 原檔不進部署, 見 public/.assetsignore
export function typeIconUrl(type: SyncPairType): string {
  return `/reference/ui/TYPE_${TYPE_ICON_NO[type] ?? "001"}.webp`;
}

// 遊戲內官方繁中譯名 — 全站只有這一份, 不要各處自己翻
export const ROLE_LABELS: Record<SyncPairRole, string> = {
  strike: "攻擊",
  tech: "技術",
  support: "輔助",
  field: "場地",
  sprint: "速戰",
  multi: "複合",
};

/** 地區繁中名 — 使用者看得到的值一律繁中, 不要直出資料裡的英文 */
export const REGION_LABELS: Record<string, string> = {
  Kanto: "關都",
  Johto: "城都",
  Hoenn: "豐緣",
  Sinnoh: "神奧",
  Unova: "合眾",
  Kalos: "卡洛斯",
  Alola: "阿羅拉",
  Galar: "伽勒爾",
  Paldea: "帕底亞",
  Pasio: "帕希歐",
  Hisui: "洗翠",
};

/** 地區顯示順序 = 世代順序 (帕希歐是 PoMa 原創, 排最後) — 篩選器不要按字母亂排 */
export const REGION_ORDER = [
  "Kanto",
  "Johto",
  "Hoenn",
  "Sinnoh",
  "Unova",
  "Kalos",
  "Alola",
  "Galar",
  "Hisui",
  "Paldea",
  "Pasio",
] as const;

/** 把資料裡出現過的地區依世代順序排好 (沒收錄在順序表的排最後) */
export function sortRegions(regions: string[]): string[] {
  const idx = (r: string) => {
    const i = (REGION_ORDER as readonly string[]).indexOf(r);
    return i === -1 ? REGION_ORDER.length : i;
  };
  return [...regions].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
}

export function regionLabel(region?: string | null): string {
  return region ? (REGION_LABELS[region] ?? region) : "";
}

export const TYPE_COLORS: Record<SyncPairType, string> = {
  normal: "bg-stone-400/20 text-stone-700 dark:text-stone-300",
  fire: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  water: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  electric: "bg-yellow-400/20 text-yellow-700 dark:text-yellow-300",
  grass: "bg-green-500/20 text-green-700 dark:text-green-300",
  ice: "bg-cyan-400/20 text-cyan-700 dark:text-cyan-300",
  fighting: "bg-red-700/20 text-red-700 dark:text-red-300",
  poison: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  ground: "bg-amber-700/20 text-amber-700 dark:text-amber-300",
  flying: "bg-sky-400/20 text-sky-700 dark:text-sky-300",
  psychic: "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  bug: "bg-lime-500/20 text-lime-700 dark:text-lime-300",
  rock: "bg-stone-600/20 text-stone-700 dark:text-stone-300",
  ghost: "bg-indigo-600/20 text-indigo-700 dark:text-indigo-300",
  dragon: "bg-violet-700/20 text-violet-700 dark:text-violet-300",
  dark: "bg-zinc-700/20 text-zinc-700 dark:text-zinc-300",
  steel: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  fairy: "bg-pink-300/30 text-pink-700 dark:text-pink-300",
};

// brybry roleAsset (ROLE_001P/S ...) → SyncPairRole enum (RoleBadge 用)。
// ROLE_032 (multi) 不在 5 種 enum 內, 回 null (不顯示徽章)。對齊 embed-matcher。
export function roleAssetToRole(asset?: string | null): SyncPairRole | null {
  switch (asset) {
    case "ROLE_001P":
    case "ROLE_001S":
      return "strike";
    case "ROLE_002":
      return "support";
    case "ROLE_004":
      return "tech";
    case "ROLE_008":
      return "sprint";
    case "ROLE_016":
      return "field";
    case "ROLE_032":
      // 複合角色 (阿爾套裝等) — 遊戲內同時具備多重定位
      return "multi";
    default:
      return null;
  }
}
