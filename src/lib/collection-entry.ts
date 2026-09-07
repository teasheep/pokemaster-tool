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

/** owned 一律由寶數/超覺醒推導 — 寶0 = 沒有這隻拍組 */
export function deriveOwned(entry: Pick<CollectionEntry, "potential" | "superAwakening">): boolean {
  return entry.potential > 0 || entry.superAwakening > 0;
}
