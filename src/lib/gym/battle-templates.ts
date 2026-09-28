// 道館戰的關卡屬性模板 —— **系統層級**, 全站共用一份, 不是每個道館各自建的資料
// (2026-09-07 使用者:「遊戲開放賽事的屬性是固定的, 所以可以新增賽事套用第一次、
//  第二次、第三次道館賽模板, 然後就會幫他們把屬性建好」)。
//
// 為什麼寫在程式裡而不是開一張表: 這是**遊戲本身的規則**, 不是某個道館的資料 ——
// 每一回帕希歐道館對戰的 8 關弱點屬性對所有玩家都一樣。做成資料表的話, 20 個道館
// 各自維護一份同樣的東西, 而且第一個建館的人得自己一格一格填 8 次。
// (與「糖果制度是查證過的遊戲規則」同一類: 遊戲的東西查證後寫死, 不要讓使用者自己設計。)
//
// 資料來源: 前三回是這個道館實際打過的三場 (2026-02 / 2026-04 / 2026-08) 的 battle_stages;
// 第四回 (2026-10) 起取自 pomatools 的道館戰資料 —— 前三回拿來對過, 24 關全部吻合。
// **之後遊戲開新的一回就在這裡加一筆** —— 順序 = 陣列順序 = 第 1..8 關,
// 再到 scripts/fetch-gvg-templates.mjs 的 EDITIONS 加上 pomatools 的 id, 跑 `npm run data:gvg`。
//
// 每關每輪的規則 (2026-09-28 使用者:「詞條限制那些的也要」) 在 src/data/gvg-stage-rules.json,
// 由上面那支腳本產生, 文字是 pomatools 語系檔裡的**官方繁中** —— 不要手改 JSON, 改腳本重跑。
// 建立賽事時寫進 stage_round_notes (每關每輪的說明), 管理員之後照樣可以改。

import type { SyncPairType } from "@/lib/supabase/types";
import GVG_RULES from "@/data/gvg-stage-rules.json";

export type BattleTemplate = {
  /** 識別碼。目前只活在建立賽事對話框的 state 裡 (沒有存進資料庫或網址) */
  id: string;
  /** 第幾次 —— 模板對齊成同一個格式, 挑的時候一眼看得出順序 */
  name: string;
  /** 那一回的副標 (官方的活動名) */
  subtitle: string;
  /** 第 1 關到第 8 關的弱點屬性 */
  types: SyncPairType[];
};

/** 某一關某一輪的規則 (R1 = 館主與固有被動, R2/R3 = 館主追加的被動, Ex1 起 = 對我方的限制) */
export type StageRoundRule = { round: number; note: string };

/** 模板那一回的每一關: 館主 + 每輪規則 (順序 = 第 1..8 關) */
export type TemplateStageRules = {
  weak: string;
  leader: string;
  pokemon: string;
  notes: StageRoundRule[];
};

const RULES = GVG_RULES.editions as Record<string, { stages: TemplateStageRules[] } | undefined>;

/** 這個模板每一關的館主與每輪規則; 沒有資料的模板回 null (只套屬性) */
export function templateStageRules(t: BattleTemplate): TemplateStageRules[] | null {
  return RULES[t.id]?.stages ?? null;
}

export const BATTLE_TEMPLATES: BattleTemplate[] = [
  {
    id: "r1-kanto",
    name: "第一次道館戰",
    subtitle: "集結關都館主",
    types: ["ice", "electric", "ground", "fire", "psychic", "dark", "water", "rock"],
  },
  {
    id: "r2-galar",
    name: "第二次道館戰",
    subtitle: "集結伽勒爾館主",
    types: ["bug", "grass", "flying", "psychic", "ghost", "water", "poison", "fighting"],
  },
  {
    id: "r3-johto",
    name: "第三次道館戰",
    subtitle: "城都館主大集合",
    types: ["ice", "electric", "fighting", "dark", "fairy", "fire", "steel", "dragon"],
  },
  {
    // 2026-10-01 ~ 10-21 (pomatools gvg 8090)
    id: "r4-sinnoh",
    name: "第四次道館戰",
    subtitle: "神奧館主大集合",
    types: ["grass", "flying", "fairy", "dragon", "dark", "fighting", "poison", "ground"],
  },
];

/** 賽事名稱的預設值 = 「第幾次道館戰（副標）」 */
export function templateBattleName(t: BattleTemplate): string {
  return `${t.name}（${t.subtitle}）`;
}

/** 一場固定 8 關 (建立賽事時由 DB trigger 開好, 屬性預設 normal) */
export const BATTLE_STAGE_COUNT = 8;

export function battleTemplate(id: string | null): BattleTemplate | null {
  return BATTLE_TEMPLATES.find((t) => t.id === id) ?? null;
}
