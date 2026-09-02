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
