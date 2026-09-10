// 單一資料來源: pomatools-pairs.json (由 scripts/scrape-brybry.mjs 建) 的 record 型別。
// 所有 page/api/client 都從這裡 import, 加欄位只改這一處。

export type PairForm = {
  index: number;
  id: string;
  kind: string;          // BASE / MEGA / DMAX / TERA_XX / ARIA / ULTRA / ...
  weak?: string;         // TYPE_002 etc (弱點)
  formType?: string | null; // TERA 後屬性 (TERA_XX 才有)
};

export type PairRecord = {
  pairId: string;
  trainerId: string;
  pokemonId: string;
  trainerName: string;
  pokemonName: string;
  trainerNameZh?: string | null;
  pokemonNameZh?: string | null;
  type: string;
  region: string | null;
  group: string | null;
  basePotential: number;
  exMode?: number;
  role?: string | null;
  roleAsset?: string | null;
  exRole?: string | null;
  change?: string;            // ALTR / MEGA / SYNC / TERA / EVOL / NONE
  forms?: PairForm[];
  /** 招式屬性 (小寫屬性名, 可多個) —— 2026-09-10 起由上游的 MoveType* 標籤覆寫。
   *  舊版這裡其實只是「拍組自己的屬性」(658 筆全是單一值), 拿來篩選等於白篩。 */
  moveTypes?: string[];
  /** 這隻寶可夢的弱點屬性 (小寫, 單一) —— 上游 pokemonWeak */
  weakType?: string | null;
  /** 主題: 角色/造型/身分 (冠軍、道館館主、美極套裝…), 繁中名見 data/pair-facets.ts */
  themes?: string[];
  /** 標籤: 戰鬥機制與寶可夢分類 (天候、屬性抵抗、傳說、御三家…) + 訓練家性別 */
  tags?: string[];
  pairKind?: string;
  hasSixEx?: boolean;
  hasExRole?: boolean;
  hasAwakening?: boolean;
  hasExStyle?: boolean;
  exStyleImagePath?: string | null;
  /** **初上線日** (ISO yyyy-mm-dd) — 拍組第一次在遊戲裡登場, 復刻與二次開放不算。對不到的為 null。 */
  releaseDate?: string | null;
  /** 系列標籤 (每拍組唯一): arc/exmaster/master/fair/limited/... 見 SERIES_LABELS */
  series?: string;
  /**
   * 有哪些外部來源證實這個拍組真的存在 ("pomatools" / "wiki"; 由 scripts/reconcile-db.mjs 寫入)。
   * **空陣列 = 只有 datamine 撈得到, 官方還沒公布** → 對外輸出要濾掉,
   * 判定一律走 loader.ts 的 `isUnreleasedPair()` (不要在別處自己寫 inline 條件)。
   * 這欄**不進 CLIENT_PAIR_FIELDS** — 它是過濾的輸入, 不是 client 要顯示的東西。
   */
  verifiedSources?: string[];
  /**
   * 取得管道 (可多個) — 卡面徽章會蓋掉 series, 例如「掛大師徽章但其實是對戰點數兌換」。
   * 篩選時 series 或這裡任一命中都算, 否則 BP 兌換的大師拍組永遠篩不出來。
   */
  acquisitions?: string[];
  pokemonImagePath?: string;
  pokemonImageUrl?: string;
  trainerImagePath?: string;
  trainerImageUrl?: string;
  trainerFacePath?: string;
  trainerCirclePath?: string;
  pokemonCirclePath?: string;
  cardImagePath?: string;
};

// ── client 投影 ──
// pomatools-pairs.json 每筆 record 有 40+ 欄位 (含一堆 verification / 圖檔路徑),
// 但 client (卡片 / 上傳 / 收藏) 只用得到下面這些。傳整包進 RSC/HTML 是死重量
// (每頁 ~800KB → ~125KB)。loader.loadPairsForClient() 用這份清單做欄位投影。
// SyncPairCardData 直接 alias 此型別 (單一來源, 不再手動同步兩份)。
//
// **加欄位前先確認 client 真的在讀它** — 每加一個就是每頁白送的位元組。
// 已刪 (client 零使用): group / exMode / role / hasExStyle / exStyleImagePath;
// forms 最肥 (~62KB, client 只為了判斷 11 隻太晶) → 投影時折成 isTera 布林。
// EX 換裝要重啟時把 exStyleImagePath 加回來 (見 AGENTS.md『EX 裝』, 資料與圖檔都還在)。
export const CLIENT_PAIR_FIELDS = [
  "pairId", "trainerId", "pokemonId",
  "trainerName", "pokemonName", "trainerNameZh", "pokemonNameZh",
  "type", "region", "basePotential",
  "roleAsset", "exRole", "change", "moveTypes", "pairKind",
  "weakType", "themes", "tags",
  "hasSixEx", "hasExRole", "hasAwakening",
  "releaseDate", "series", "acquisitions",
] as const;

export type ClientPairRecord = Pick<PairRecord, (typeof CLIENT_PAIR_FIELDS)[number]> & {
  /** 太晶化拍組 (卡片的寶可夢用六角框): 由 loadPairsForClient 從 change/forms 折出來的衍生欄位 */
  isTera: boolean;
};
