import type { ClientPairRecord } from "@/lib/pairs/types";

/**
 * 拍組顯示名的唯一標準:「人名 & 寶可夢名」(優先繁中, 缺翻譯退回英文)。
 * 所有 UI 顯示拍組名稱一律用這個 — 不要只顯示訓練家名。
 */
export function pairName(
  p: Pick<ClientPairRecord, "trainerName" | "pokemonName" | "trainerNameZh" | "pokemonNameZh">
): string {
  const trainer = p.trainerNameZh || p.trainerName || "???";
  const pokemon = p.pokemonNameZh || p.pokemonName || "???";
  return `${trainer} & ${pokemon}`;
}

/**
 * member_pairs / gym_pairs 的 pair_label 唯一標準寫法 (緊湊「人名&寶可夢名」)。
 * (member_id, pair_label) 是 unique key — 寫法不一會讓同拍組長出兩列, 一律用這個。
 */
export function pairLabel(
  p: Pick<ClientPairRecord, "trainerName" | "pokemonName" | "trainerNameZh" | "pokemonNameZh">
): string {
  return pairName(p).replace(" & ", "&");
}

/**
 * 系列標籤 (每拍組唯一, 官方 zh 用語):
 * 卡面徽章類 (阿爾/大師/EX大師) 優先, 其餘依取得途徑 (acquisition) 特異性取一。
 */
export const SERIES_LABELS: Record<string, string> = {
  arc: "阿爾",
  exmaster: "EX大師",
  master: "大師",
  fair: "群星盛典",
  limited: "繁星限定",
  seasonal: "季節限定",
  legendary: "傳說",
  bp: "對戰點數",
  lodge: "沙龍",
  ticket: "特訓票券",
  event: "活動",
  story: "主線",
  general: "一般",
  // datamine 先行、pomatools 還沒分類的拍組。「最新」是上架時間, 不是系列 —
  // 不要放進系列篩選 (卡片上的 NEW 徽章已經在講新舊了)
  upcoming: "未分類",
};

/** 系列篩選器的顯示順序 (稀有度/關注度高→低); upcoming 不是系列, 不列入 */
export const SERIES_ORDER = [
  "arc", "exmaster", "master", "fair", "limited", "seasonal",
  "legendary", "bp", "lodge", "ticket", "event", "story", "general",
] as const;

export function seriesLabel(series?: string | null): string {
  return SERIES_LABELS[series ?? ""] ?? "一般";
}

const HALF_YEAR_MS = 183 * 86400 * 1000;

/** 半年內上架 = 新拍組 (卡片標 NEW) */
export function isNewPair(p: Pick<ClientPairRecord, "releaseDate">): boolean {
  if (!p.releaseDate) return false;
  return Date.now() - new Date(p.releaseDate).getTime() < HALF_YEAR_MS;
}

/** 屬性分組內的排序: 越新排越前 (無日期的排最後), 同日期按名稱穩定 */
export function byReleaseDesc(
  a: Pick<ClientPairRecord, "releaseDate" | "pairId">,
  b: Pick<ClientPairRecord, "releaseDate" | "pairId">
): number {
  const da = a.releaseDate ?? "";
  const db = b.releaseDate ?? "";
  if (da !== db) return db.localeCompare(da);
  return a.pairId.localeCompare(b.pairId);
}

// ── 卡片牆排序選項 (我的拍組 / 圖鑑共用) ──────────────────────────────

export type PairSortKey = "release-desc" | "release-asc" | "name" | "star-desc";

export const PAIR_SORT_LABELS: Record<PairSortKey, string> = {
  "release-desc": "最新優先",
  "release-asc": "最舊優先",
  name: "名稱",
  "star-desc": "星級高→低",
};

export const PAIR_SORT_ORDER: readonly PairSortKey[] = [
  "release-desc", "release-asc", "name", "star-desc",
];

type SortablePair = Pick<
  ClientPairRecord,
  "releaseDate" | "pairId" | "basePotential" |
  "trainerName" | "pokemonName" | "trainerNameZh" | "pokemonNameZh"
>;

/** 取得排序比較器; 各鍵都以穩定的次序收尾 (同值時不跳動) */
export function pairComparator(key: PairSortKey) {
  return (a: SortablePair, b: SortablePair): number => {
    switch (key) {
      case "release-asc": {
        // 無日期排最後 (與 desc 同邏輯: 沒日期永遠沉底)
        const da = a.releaseDate ?? "9999-99-99";
        const db = b.releaseDate ?? "9999-99-99";
        if (da !== db) return da.localeCompare(db);
        return a.pairId.localeCompare(b.pairId);
      }
      case "name":
        return (
          pairName(a).localeCompare(pairName(b), "zh-Hant") ||
          a.pairId.localeCompare(b.pairId)
        );
      case "star-desc": {
        const d = (b.basePotential ?? 0) - (a.basePotential ?? 0);
        return d !== 0 ? d : byReleaseDesc(a, b);
      }
      default:
        return byReleaseDesc(a, b);
    }
  };
}
