// 道館戰的關卡屬性模板 —— **系統層級**, 全站共用一份, 不是每個道館各自建的資料
// (2026-09-07 使用者:「遊戲開放賽事的屬性是固定的, 所以可以新增賽事套用第一次、
//  第二次、第三次道館賽模板, 然後就會幫他們把屬性建好」)。
//
// 為什麼寫在程式裡而不是開一張表: 這是**遊戲本身的規則**, 不是某個道館的資料 ——
// 每一回帕希歐道館對戰的 8 關弱點屬性對所有玩家都一樣。做成資料表的話, 20 個道館
// 各自維護一份同樣的東西, 而且第一個建館的人得自己一格一格填 8 次。
// (與「糖果制度是查證過的遊戲規則」同一類: 遊戲的東西查證後寫死, 不要讓使用者自己設計。)
//
// 資料來源: 這個道館實際打過的三場 (2026-02 / 2026-04 / 2026-08) 的 battle_stages。
// **之後遊戲開新的一回就在這裡加一筆** —— 順序 = 陣列順序 = 第 1..8 關。

import type { SyncPairType } from "@/lib/supabase/types";

export type BattleTemplate = {
  /** 識別碼。目前只活在建立賽事對話框的 state 裡 (沒有存進資料庫或網址) */
  id: string;
  /** 第幾次 —— 三個模板對齊成同一個格式, 挑的時候一眼看得出順序 */
  name: string;
  /** 那一回的副標 (官方的活動名) */
  subtitle: string;
  /** 第 1 關到第 8 關的弱點屬性 */
  types: SyncPairType[];
};

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
