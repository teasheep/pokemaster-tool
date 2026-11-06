// 道館賽 domain 型別與顯示標籤 (對應 0005_gyms.sql)。
// 屬性 (SyncPairType) 與其標籤/顏色沿用 src/data/sync-pairs.ts, 這裡只放道館賽特有的。

import type { AttackCategory, BattleStatus, GymMemberRole } from "@/lib/supabase/types";

export type { AttackCategory, BattleStatus, GymMemberRole };

/**
 * 拍組名稱正規化 (gym_pairs ↔ member_pairs 以 pair_label 對照時用;
 * 規則同 scripts/gym-import-lib.mjs 的 normKey: NFKC + 去空白與 CJK 中點)
 */
export function normPairKey(s: string): string {
  return s.normalize("NFKC").replace(/[\s・·‧]+/g, "");
}

/** 持有等級: 0=無持有, 1..5=寶1..寶5, 6..10=超覺醒1..5 (值即排序強度; 0038 起同一條軸) */
export const GRADE_LABELS = [
  "無持有",
  "寶1",
  "寶2",
  "寶3",
  "寶4",
  "寶5",
  "超覺醒1",
  "超覺醒2",
  "超覺醒3",
  "超覺醒4",
  "超覺醒5",
] as const;

export const GRADE_MAX = 10;

/**
 * 管理員代改成員練度時「這次真的改了哪些欄位」—— **沒有的欄位 = 不要動**
 * (set_member_pair 的 null 語意, 0058 起)。左下角的寶數循環一個都不帶。
 * ⚠ 新增一條練度軸就在這裡加一欄, 然後 members-client 的側板 onChange / flushGrade /
 *   樂觀更新各補一行 —— 少一行的症狀是「側板改得動、卻存不進去」, 沒有任何徵兆。
 */
export type MemberPairExtra = {
  level?: number;
  promotion?: number;
  syncGrid?: number;
  exRoleUnlocked?: boolean;
  /** 潛能 (最多 5 個, 0076)。[] = 清空 */
  luckySkills?: string[];
  /** 備註 (最多 500 字, 0076)。"" = 清空 */
  notes?: string;
};

/** grade (0-10) → 卡片顯示用的 寶數/超覺醒 兩段值 */
export function gradeParts(grade: number): { potential: number; superAwakening: number } {
  if (grade >= 6) return { potential: 5, superAwakening: Math.min(5, grade - 5) };
  return { potential: Math.max(0, grade), superAwakening: 0 };
}

export const CATEGORY_LABELS: Record<AttackCategory, string> = {
  physical: "物理",
  special: "特殊",
};

export const BATTLE_STATUS_LABELS: Record<BattleStatus, string> = {
  planning: "籌備中",
  active: "進行中",
  finished: "已結束",
};

/**
 * 賽事狀態一律由賽期日期推導 (使用者指定, 不再有手動下拉):
 * 沒設開賽日或還沒到 = 籌備中; 過了結束日 = 已結束; 其間 = 進行中。
 * today 用台北時區的 YYYY-MM-DD — Workers 跑 UTC, 直接 new Date() 會慢 8 小時。
 */
export function battleStatusFromDates(
  startsOn: string | null,
  endsOn: string | null,
  today: string = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })
): BattleStatus {
  if (!startsOn || today < startsOn) return "planning";
  if (endsOn && today > endsOn) return "finished";
  return "active";
}

/** 輪次標籤 (全站唯一寫法): 1-3 = 一般對戰 R1-R3; 4+ = 額外對戰 Ex1… */
export const roundLabel = (r: number) => (r <= 3 ? `R${r}` : `Ex${r - 3}`);

/** 挑戰券上限 — 券制是「剩餘 / 上限」預設 30/30 從上限往下扣 (0043) */
export const TICKETS_MAX = 30;

/**
 * 戰鬥紀錄的分工: 主力 / 補刀 / 降抗。**出刀的降抗不分物 / 特** (2026-11-05 使用者:
 * 「道館戰選幾票打什麼的時候 降抗不用分物特」) —— 物 / 特是**隊伍庫**的分類 (TEAM_TAG_LABELS),
 * 那邊照舊分開。
 * 0078 到這天之間登記的是 `debuff_physical` / `debuff_special` (第四次道館戰 131 筆), 資料不動,
 * 畫面一律顯示「降抗」—— 同一張對戰紀錄表裡一半寫「物降抗」一半寫「降抗」就是兩種說法。
 * 資料庫的 check 照舊允許這兩個值 (舊列要合法), 只是登記時不會再寫進去。
 */
export const BATTLE_ROLE_LABELS = {
  main: "主力",
  assist: "補刀",
  debuff: "降抗",
  debuff_physical: "降抗",
  debuff_special: "降抗",
} as const;

/** 登記出刀時可以選的分工 —— 順序 = 按鈕順序 */
export const BATTLE_ROLES = ["main", "assist", "debuff"] as const;

/** 降抗 (含 0078 那段時間的物 / 特) —— 著色用 (降抗一族同一個色系) */
export const isDebuffRole = (r: string) => r === "debuff" || r.startsWith("debuff_");

/**
 * 挑戰隊伍的分類 (每屬性通常備 3-5 套)。降抗分成物降抗 / 特降抗 (0078)。
 * `debuff` = 之前沒分的「降抗」: 不能新增, 只在那一館還有這種隊伍時才出現, 等管理員改分類。
 */
export const TEAM_TAG_LABELS = {
  debuff_physical: "物降抗",
  debuff_special: "特降抗",
  physical: "物攻",
  special: "特攻",
  closer: "磨隊/其他",
  debuff: "降抗（未分）",
} as const;


// 「全體屬性戰力」矩陣 (成員 × 屬性) 已整塊移除 — 燈號吃的降抗數值與格子裡的主打手分數
// 都是匯入的舊試算表, 使用者要之後重做。要復原看 docs/rebuff-notes.md 記的 commit。
