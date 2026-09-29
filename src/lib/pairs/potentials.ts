// 潛能 (lucky skill) 資料 —— 名稱、分類、每個拍組能用的特殊潛能餅乾。
// 資料檔由 scripts/fetch-potentials.mjs 產生 (brybry datamine × pomatools 交叉驗證, 505/505 一致)。
//
// ⚠ 資料檔約 140KB (gzip 14KB), **不要在模組頂層 import** —— 那會把它塞進每一頁的 bundle。
//   一律走 loadPotentials() 的 dynamic import: 只有打開側板、或卡牆勾了「潛能」才載入。

/** 一個拍組最多幾個潛能 (遊戲規則, 2026-09-29 使用者); DB 也夾同一個數字 (0076 的 check) */
export const MAX_LUCKY_SKILLS = 5;
/** 備註上限 (字); DB 也夾同一個數字 (0076 的 check) */
export const MAX_NOTES = 500;

export type PotentialCookieKind = "exclusive" | "tower1" | "tower2" | "gym";

/** 一種特殊潛能餅乾: 用了會得到 skills 其中一個 (多於一個 = 隨機) */
export type PotentialCookie = {
  kind: PotentialCookieKind;
  /** 遊戲裡的餅乾名 (已去掉 [Name:…] 插值), 例: 「美極套裝赤紅專用潛能餅乾1」 */
  label: string;
  skills: string[];
};

/** 一般潛能依餅乾分組 (照 pomatools 的潛能選單: 硬脆 / 鬆脆 / 酥脆 / 香脆 / 特別) */
export type GeneralCookieKey = "red" | "blue" | "yellow" | "pink" | "purple";
export type GeneralGroup = {
  key: GeneralCookieKey;
  /** 餅乾名, 例「硬脆潛能餅乾」 */
  label: string;
  /** 依 id 排 = 同一效果的各級相鄰; 一個潛能只歸一組 */
  skills: string[];
};

export type PotentialData = {
  /** 所有拍組都能用的一般潛能, 依餅乾分組 */
  general: GeneralGroup[];
  /** 潛能 id → [名稱, 說明] (官方繁中) */
  skills: Record<string, [string, string]>;
  /** pairId → 這個拍組的特殊潛能餅乾 (沒有 = 這個拍組沒有特殊潛能) */
  pairs: Record<string, PotentialCookie[]>;
};

let cache: Promise<PotentialData> | null = null;

/** 延遲載入 (同一頁只抓一次; 失敗會清掉快取, 下次再試) */
export function loadPotentials(): Promise<PotentialData> {
  cache ??= import("@/data/pair-potentials.json")
    .then((m) => (("default" in m ? m.default : m) as unknown as PotentialData))
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** 特殊潛能餅乾的分組標題 —— 專用餅乾的名字帶拍組名 (側板上方已經寫了是哪一隻), 去掉 */
export function cookieHeading(c: PotentialCookie): string {
  switch (c.kind) {
    case "exclusive":
      return c.label.replace(/^.*?(專用)/, "$1");
    case "tower1":
      return "塔潛能餅乾1";
    case "tower2":
      return "塔潛能餅乾2";
    case "gym":
      return "道館對戰潛能餅乾";
  }
}

/**
 * 餅乾圖示 (遊戲素材, scripts/fetch-potentials.mjs 一併抓下來轉 webp)。
 * 特殊餅乾四種**各有各的圖** (專用 = 咖啡色滿滿星星、塔2 = 星形吊牌、道館對戰 = 藍色), 不要合成一張。
 */
export function cookieIcon(key: GeneralCookieKey | PotentialCookieKind): string {
  return `/reference/ui/potential/cookie_${key}.webp`;
}

/**
 * 某個拍組身上的一個潛能該掛哪顆圖示: 在它的特殊潛能餅乾裡 → 那種餅乾; 否則看它屬於哪一種一般餅乾。
 * (有 11 個潛能同時出現在專用餅乾與一般餅乾裡 —— 以「這個拍組」為準, 所以要傳 pairId)
 */
export function skillIcon(data: PotentialData, pairId: string, id: string): string {
  // 同一拍組的餅乾已依 專用 → 塔1 → 塔2 → 道館對戰 排好, 取第一個 = 最「專屬」的那一種
  const c = data.pairs[pairId]?.find((x) => x.skills.includes(id));
  if (c) return cookieIcon(c.kind);
  const g = data.general.find((x) => x.skills.includes(id));
  return cookieIcon(g?.key ?? "purple");
}

/**
 * 一般潛能的「效果」與「級數」: 「沙暴時威力提升3」→ ["沙暴時威力提升", "3"]、
 * 「上場時攻擊提升G2」→ ["上場時攻擊提升G", "2"]。沒有數字的整個當效果名、級數空字串。
 * 選單把同一個效果的 1/2/3 級排在同一列 (219 種攤平成一長串的話手機上根本找不到)。
 */
export function splitTier(name: string): [family: string, tier: string] {
  const m = name.match(/^(.*?)(\d+)$/);
  return m ? [m[1]!, m[2]!] : [name, ""];
}

/** 卡牆上可以選擇顯示的資訊 (「顯示」多選下拉) —— 順序 = 選單順序 = 卡片上的行序 */
export const CARD_INFO_KEYS = ["grid", "level", "potential", "notes"] as const;
export type CardInfoKey = (typeof CARD_INFO_KEYS)[number];
export const CARD_INFO_LABELS: Record<CardInfoKey, string> = {
  grid: "拍檔石盤",
  level: "等級",
  potential: "潛能",
  notes: "備註",
};
/** 預設只開拍檔石盤 = 這個選單出現之前卡牆本來的樣子 (不要讓既有使用者一打開就變了) */
export const DEFAULT_CARD_INFO: readonly CardInfoKey[] = ["grid"];

/** 網址參數 `show=level,potential` ↔ 選項 (不認得的值丟掉; 沒帶 = 預設) */
export function parseCardInfo(raw: string | string[] | undefined): CardInfoKey[] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return [...DEFAULT_CARD_INFO];
  if (v === "none") return [];
  const picked = v.split(",").filter((k): k is CardInfoKey => (CARD_INFO_KEYS as readonly string[]).includes(k));
  return CARD_INFO_KEYS.filter((k) => picked.includes(k));
}

/** 選項 → 網址參數 (等於預設就不留; 全關寫成 none, 否則會被當成「沒帶 = 預設」) */
export function serializeCardInfo(keys: readonly CardInfoKey[]): string | null {
  const sorted = CARD_INFO_KEYS.filter((k) => keys.includes(k));
  if (sorted.join(",") === DEFAULT_CARD_INFO.join(",")) return null;
  return sorted.length ? sorted.join(",") : "none";
}
