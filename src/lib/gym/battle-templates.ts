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
//
// ⚠ **規則不存進資料庫, 由看板依模板直接畫成 tag** (同一天第二版, 使用者:「tag 跟血量資訊
// 不要跟文字放一起」)。第一版把規則組成一句話寫進 stage_round_notes, 兩個問題:
//   1. 說明欄是大家寫自己戰術的地方, 被一長串規則佔掉;
//   2. 「追加被動 X」只寫了這一輪多的, 看不出這一輪**總共**有哪些 —— 被動是逐輪累加的。
// 賽事沒有存「用哪個模板」, 看板用 8 關的弱點屬性認 (matchTemplate) —— 四回的屬性組合各不相同,
// 而且同一回裡 8 關屬性不重複, 所以「這一關是哪位館主」用屬性就對得到, 不必管關卡順序。
// 好處是既有賽事 (包括沒有用模板、自己一格一格選屬性的) 也自動看得到規則, 不用回填任何資料。

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

/** 資料檔裡的一輪 (fresh = 這一輪才加上的館主被動; 累積的由 stageRound 算) */
type RawRound = { round: number; rules: string[]; fresh: string[]; hp: number[] };

/** 模板那一回的某一關: 館主 + 每輪規則 (順序 = 第 1..8 關) */
export type TemplateStageRules = {
  weak: SyncPairType;
  leader: string;
  pokemon: string;
  /** 館主的固有被動 (從第 1 輪就有, 已排除 8 關都有的通用設定) */
  own: string[];
  rounds: RawRound[];
};

/** 某一關某一輪**全部生效**的東西 (畫成 tag) */
export type StageRoundState = {
  round: number;
  /** 這一輪對我方的限制 (Ex1 起) */
  rules: string[];
  /** 館主到這一輪為止累積的被動 —— 包含前面幾輪加上的 */
  passives: { name: string; fresh: boolean }[];
  /** 三隻對手的 HP: [館主 (中間), 左, 右] */
  hp: [number, number, number];
};

const RULES = GVG_RULES.editions as unknown as Record<
  string,
  { stages: TemplateStageRules[] } | undefined
>;

/** 這個模板每一關的館主與每輪規則; 沒有資料的模板回 null (只套屬性) */
export function templateStageRules(t: BattleTemplate): TemplateStageRules[] | null {
  return RULES[t.id]?.stages ?? null;
}

/** 這一關每一輪全部生效的東西 (被動往前累加; 固有被動算在每一輪裡) */
export function stageRounds(st: TemplateStageRules): StageRoundState[] {
  const acc: string[] = [];
  return st.rounds.map((r) => {
    acc.push(...r.fresh);
    return {
      round: r.round,
      rules: r.rules,
      passives: [
        ...st.own.map((name) => ({ name, fresh: false })),
        ...acc.map((name) => ({ name, fresh: r.fresh.includes(name) })),
      ],
      hp: [r.hp[0] ?? 0, r.hp[1] ?? 0, r.hp[2] ?? 0],
    };
  });
}

/** 7983360 → 「798萬」; 一億以上 → 「1.2億」 (看板上要一眼比大小, 不需要精確到個位) */
export function formatHp(n: number): string {
  return n >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}億` : `${Math.round(n / 1e4)}萬`;
}

/**
 * 用一場賽事 8 關的弱點屬性認出是哪一回的模板, 回傳「屬性 → 那一關的規則」。
 * 至少要有 6 關對得上、而且只有一個模板最符合才算 —— 管理員改錯一兩關的屬性時仍然認得出來
 * (改錯的那一關就沒有 tag), 但不會把一場自訂的賽事硬套成某一回。
 */
export function matchTemplate(
  types: SyncPairType[]
): { template: BattleTemplate; byType: Map<SyncPairType, TemplateStageRules> } | null {
  const have = new Set(types);
  const scored = BATTLE_TEMPLATES.filter((t) => templateStageRules(t)).map((t) => ({
    t,
    score: t.types.filter((ty) => have.has(ty)).length,
  }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (best < 6 || top.length !== 1) return null;
  const template = top[0]!.t;
  return {
    template,
    byType: new Map((templateStageRules(template) ?? []).map((st) => [st.weak, st])),
  };
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
