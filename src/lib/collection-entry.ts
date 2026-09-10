// 收藏練度的共用純邏輯 — /pairs 與 /inventory 都用這份, 不要各自再抄一份
// (兩頁曾各自實作 defaultEntry/cycleCount 而行為分岔)。

import type { CollectionEntry } from "@/lib/collection";
import type { ClientPairRecord } from "@/lib/pairs/types";

/**
 * 等級的選項 —— 這是**合法值的全集**, 不只是選單
 * (2026-09-07 使用者: 「多一個 LV1 的選項, 預設 LV1, 其他不是選項內的數字不留, 都改回 LV1」)。
 *
 * **Lv1 = 還沒設定**。它同時是三件事的預設值, 三邊因此對得起來:
 *   1. 這裡的 `defaultEntry` (在網站上新點亮一隻);
 *   2. `user_collection.level` 的 DB 預設 (0002);
 *   3. `set_member_pair` 替沒有收藏列的成員建列時吃到的值 (它不帶 level)。
 * 舊版預設是 200, 於是那 167 列 Lv1 看起來像壞掉的資料 —— 其實只是「沒設定過」。
 *
 * 不在這份清單裡的值一律當成 Lv1 (見 `normalizeLevel`), 而且 0057 已經把線上那兩列
 * (Lv100 / Lv130) 一起改回 1。**不要**再做「把現值補進選單」那種事: 使用者要的是
 * 只有這五個值, 多一格就是多一種狀態。
 */
export const LEVEL_OPTIONS = [1, 140, 150, 180, 200] as const;

/**
 * 落到合法值上 —— 不在清單裡的一律回 1 ("還沒設定")。
 * 顯示與寫入都要過這一關: Radix 的 Select 找不到對應 SelectItem 時 trigger 會是**空白的**
 * (不是 placeholder, 也不報錯), 而側板是即改即存, 使用者看到空框隨手一選就把值蓋掉了。
 */
export function normalizeLevel(level: number): number {
  return (LEVEL_OPTIONS as readonly number[]).includes(level) ? level : 1;
}

/**
 * 新點亮拍組的預設值: 保留拍組「原有初始星級」(basePotential), 不自動 6★/EX —
 * 星級與 EX 是個人練度, 在側板自己調。等級是 1 = 還沒設定 (見 LEVEL_OPTIONS)。
 * potential 預設 0 (未持有灰卡); 點亮走左下角 cycle 或呼叫端自帶 potential。
 */
export function defaultEntry(pair: ClientPairRecord): CollectionEntry {
  return {
    pairId: pair.pairId,
    owned: false,
    level: 1,
    promotion: pair.basePotential ?? 5,
    potential: 0,
    superAwakening: 0,
    exUnlocked: false,
    syncGrid: 0,
    exRoleUnlocked: false,
    exStyleWorn: false,
    notes: null,
  };
}

/**
 * 左下角計數循環: 寶0→1→…→5 →(可超覺醒) 覺1→…→覺5 → 歸零。
 * 寶0 = 沒有這隻 (卡片反灰); 不可超覺醒者寶5 再點即歸零。
 */
export function cycleEntry(entry: CollectionEntry, awakenable: boolean): CollectionEntry {
  let { potential, superAwakening } = entry;
  if (superAwakening > 0) {
    superAwakening = superAwakening >= 5 ? 0 : superAwakening + 1;
    if (superAwakening === 0) potential = 0;
  } else if (potential >= 5) {
    if (awakenable) superAwakening = 1;
    else potential = 0;
  } else {
    potential = potential + 1;
  }
  return { ...entry, potential, superAwakening };
}

/**
 * 星數循環 (卡片右鍵 / 長按) —— 原始星級 → … → 5★ → 6★EX → 繞回原始星級。
 *
 * 三件事:
 *  - **下限是原始星級**, 不是 1。星星只能從遊戲給的起點往上升, 5★ 拍組沒有 3★/4★ 這種狀態。
 *  - 6★EX 只有 `hasSixEx` 的拍組才進得去 (= 星數 6, AGENTS「6★EX 就是星數 6」)。
 *  - **會繞回去**。遊戲裡不能降星, 但誤點的人總要有辦法退回來, 而側板不是每個畫面都開得了。
 *    左下角的寶數循環本來就是繞回 0 的, 這裡跟它同一個心智模型。
 *
 * `exUnlocked` 一律跟著算出來的星數走 (6 = true), 不要讓兩者各自為政 ——
 * 側板的星數下拉也是這樣寫的 (pair-edit-panel.tsx 的 onValueChange)。
 */
export function cyclePromotion(
  current: number,
  basePotential: number,
  hasSixEx: boolean
): { promotion: number; exUnlocked: boolean } {
  const base = Math.max(1, Math.min(5, basePotential || 5));
  const max = hasSixEx ? 6 : 5;
  const from = Math.max(base, Math.min(max, current || base));
  const next = from >= max ? base : from + 1;
  return { promotion: next, exUnlocked: next >= 6 };
}

/**
 * 拍檔石盤 (官方名稱; 那個數字是「力量」的上限) —— 索引 0-5 對應 60 / 62 / 64 / 66 / 68 / 70。
 *
 * 遊戲規則 (2026-09-10 使用者更正, 他是實際在玩的人):
 *   **能升到第幾段受寶數限制** —— **上限索引 = 寶數** (夾在 0-5)。
 *   寶1 到 62、寶2 到 64、寶3 到 66、寶4 到 68、寶5 (或任何超覺醒) 才到 70;
 *   **寶0 只有 60**, 也就是還沒開始升。
 *   ⚠ 這條 2026-09-09 第一版寫成 `索引 = 寶數`, 每一段都多開了一格
 *   (使用者:「上限應該都多 2」) —— 那會讓資料出現遊戲裡不可能的狀態, 而畫面照樣渲染得出來。
 *   寶數退回去時石盤也要跟著夾回來。
 *
 * 索引 0 (= 60) 是**每個拍組的起點**, 畫面上刻意不畫 ——
 * 一整面牆如果每張卡都掛一顆「60」, 那個徽章就不帶任何資訊了。
 * 只有真的升過的才顯示, 這是照 pomasters 的做法 (他們用 CSS 把第一張圖藏起來)。
 */
export const SYNC_GRID_CAPS = [60, 62, 64, 66, 68, 70] as const;

/** 這個寶數最多能升到第幾段 (索引) —— 索引就等於寶數 */
export function maxSyncGrid(potential: number): number {
  return Math.min(5, Math.max(0, potential));
}

/** 循環到下一段; 超過上限就繞回 0 (與寶數循環同一個心智模型) */
export function cycleSyncGrid(current: number, potential: number): number {
  const max = maxSyncGrid(potential);
  const from = Math.max(0, Math.min(max, current || 0));
  return from >= max ? 0 : from + 1;
}

/** 寶數變動後把石盤夾回合法範圍 (寶數退回去時石盤要跟著降) */
export function clampSyncGrid(current: number, potential: number): number {
  return Math.max(0, Math.min(maxSyncGrid(potential), current || 0));
}

/** owned 一律由寶數/超覺醒推導 — 寶0 = 沒有這隻拍組 */
export function deriveOwned(entry: Pick<CollectionEntry, "potential" | "superAwakening">): boolean {
  return entry.potential > 0 || entry.superAwakening > 0;
}
