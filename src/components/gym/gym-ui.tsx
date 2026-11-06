// 道館賽共用的小元件: 持有等級徽章、狀態徽章。
// (降抗燈號 LightDot 已隨降抗數值一起移除 — 見 docs/rebuff-notes.md)

import { Badge } from "@/components/ui/badge";
import { BATTLE_STATUS_LABELS, GRADE_LABELS, type BattleStatus } from "@/lib/gym/types";

const GRADE_STYLES: Record<number, string> = {
  0: "bg-muted text-muted-foreground",
  1: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  2: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  3: "bg-green-500/20 text-green-700 dark:text-green-300",
  4: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  5: "bg-red-500/20 text-red-700 dark:text-red-300",
  // 6-10 = 超覺醒1-5 (0038) — 同一組琥珀色
  6: "bg-amber-400/30 text-amber-700 dark:text-amber-300",
  7: "bg-amber-400/30 text-amber-700 dark:text-amber-300",
  8: "bg-amber-400/30 text-amber-700 dark:text-amber-300",
  9: "bg-amber-400/30 text-amber-700 dark:text-amber-300",
  10: "bg-amber-400/30 text-amber-700 dark:text-amber-300",
};

/**
 * 同一組顏色的 hex 版 —— 給 canvas 畫的匯出圖用 (成員頁「比較」的下載圖片)。
 * `bg` 是 500 那一階、`alpha` 是上面 className 的透明度, `fg` 是 700 那一階 (亮色主題)。
 * ⚠ 改上面的配色要一起改這裡 (tests/compare-pairs.test.ts 釘住兩邊的色名一致)。
 */
export const GRADE_SWATCH: Record<number, { bg: string; alpha: number; fg: string; name: string }> = {
  0: { bg: "#e7e0d2", alpha: 1, fg: "#8a8174", name: "muted" },
  1: { bg: "#a855f7", alpha: 0.2, fg: "#7e22ce", name: "purple" },
  2: { bg: "#3b82f6", alpha: 0.2, fg: "#1d4ed8", name: "blue" },
  3: { bg: "#22c55e", alpha: 0.2, fg: "#15803d", name: "green" },
  4: { bg: "#f97316", alpha: 0.2, fg: "#c2410c", name: "orange" },
  5: { bg: "#ef4444", alpha: 0.2, fg: "#b91c1c", name: "red" },
  6: { bg: "#fbbf24", alpha: 0.3, fg: "#b45309", name: "amber" },
  7: { bg: "#fbbf24", alpha: 0.3, fg: "#b45309", name: "amber" },
  8: { bg: "#fbbf24", alpha: 0.3, fg: "#b45309", name: "amber" },
  9: { bg: "#fbbf24", alpha: 0.3, fg: "#b45309", name: "amber" },
  10: { bg: "#fbbf24", alpha: 0.3, fg: "#b45309", name: "amber" },
};

export function GradeBadge({ grade }: { grade: number }) {
  const g = Math.max(0, Math.min(grade, GRADE_LABELS.length - 1));
  return (
    <Badge variant="secondary" className={GRADE_STYLES[g]}>
      {GRADE_LABELS[g]}
    </Badge>
  );
}

const STATUS_STYLES: Record<BattleStatus, string> = {
  planning: "bg-muted text-muted-foreground",
  active: "bg-green-500/20 text-green-700 dark:text-green-300",
  finished: "bg-stone-400/20 text-stone-600 dark:text-stone-300",
};

export function BattleStatusBadge({ status }: { status: BattleStatus }) {
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status]}>
      {BATTLE_STATUS_LABELS[status]}
    </Badge>
  );
}
