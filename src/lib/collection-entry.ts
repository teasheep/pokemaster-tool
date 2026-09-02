// 收藏練度的共用純邏輯 — /pairs 與 /inventory 都用這份, 不要各自再抄一份
// (兩頁曾各自實作 defaultEntry/cycleCount 而行為分岔)。

import type { CollectionEntry } from "@/lib/collection";
import type { ClientPairRecord } from "@/lib/pairs/types";

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
