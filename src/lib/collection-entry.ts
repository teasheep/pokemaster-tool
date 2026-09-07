// 收藏練度的共用純邏輯 — /pairs 與 /inventory 都用這份, 不要各自再抄一份
// (兩頁曾各自實作 defaultEntry/cycleCount 而行為分岔)。

import type { CollectionEntry } from "@/lib/collection";
import type { ClientPairRecord } from "@/lib/pairs/types";

/**
 * 等級下拉的選項 (2026-09-07 使用者指定: 「選項就只留 140 150 180 200 就好, 其他不用」)。
 *
 * 這是**選單**不是合法值的全集 —— 資料庫裡本來就有別的值 (實測線上 2077 列: Lv1 有 167 列,
 * 來自辨識匯入的預設, 另有 Lv100/Lv130 各一)。所以呼叫端要把「現在這一列的值」補進選單,
 * 否則 Radix Select 找不到對應的 SelectItem, 那 169 列會顯示成**空白的下拉**
 * (看起來像資料掉了), 或被使用者不小心改掉。見 levelOptions()。
 */
export const LEVEL_OPTIONS = [140, 150, 180, 200] as const;

/** 選單 = 標準選項 ∪ {現值}, 由小到大 —— 現值不在標準選項裡時才會多一格 */
export function levelOptions(current: number): number[] {
  const set = new Set<number>(LEVEL_OPTIONS);
  if (Number.isFinite(current) && current > 0) set.add(current);
  return [...set].sort((a, b) => a - b);
}

/**
 * 新點亮拍組的預設值: 保留拍組「原有初始星級」(basePotential), 不自動 6★/EX —
 * 星級與 EX 是個人練度, 在側板自己調。等級給滿 (道館成員常態)。
 * potential 預設 0 (未持有灰卡); 點亮走左下角 cycle 或呼叫端自帶 potential。
 */
export function defaultEntry(pair: ClientPairRecord): CollectionEntry {
  return {
    pairId: pair.pairId,
    owned: false,
    level: 200,
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
