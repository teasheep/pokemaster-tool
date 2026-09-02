/* eslint-disable @next/next/no-img-element */
// 屬性/角色/星級徽章。屬性徽章帶官方 icon (小圖, 不經 next/image 以免 Workers 上多一層轉檔)。
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ROLE_LABELS,
  TYPE_COLORS,
  TYPE_LABELS,
  typeIconUrl,
} from "@/data/sync-pairs";
import type { SyncPairRole, SyncPairType } from "@/lib/supabase/types";

export function TypeIcon({ type, className }: { type: SyncPairType; className?: string }) {
  return (
    <img
      src={typeIconUrl(type)}
      alt=""
      aria-hidden
      className={cn("inline-block h-3.5 w-3.5 shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

export function TypeBadge({
  type,
  className,
  showIcon = true,
}: {
  type: SyncPairType;
  className?: string;
  showIcon?: boolean;
}) {
  return (
    <Badge variant="secondary" className={cn("gap-1", TYPE_COLORS[type], className)}>
      {showIcon ? <TypeIcon type={type} /> : null}
      {TYPE_LABELS[type]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: SyncPairRole }) {
  return <Badge variant="outline">{ROLE_LABELS[role]}</Badge>;
}

export function StarLevel({ value }: { value: number }) {
  return (
    <span className="text-amber-500" aria-label={`${value} 星`}>
      {"★".repeat(Math.min(value, 6))}
    </span>
  );
}
