"use client";

// 道館切換器 — 一人可加入多館 (顧問常同時看好幾館)。
// 只有一館也要是下拉: 「加入 / 建立道館」的入口只在這裡, 而 /gyms 會自動轉進唯一道館 —
// 之前一館的人拿到別館的顧問碼根本無處輸入 (使用者抓包)。

import Link from "next/link";
import { ChevronDown, Plus, Shield } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理員",
  member: "成員",
  advisor: "顧問",
};

export function GymSwitcher({
  currentId,
  gyms,
}: {
  currentId: string;
  gyms: { gymId: string; gymName: string; role: string }[];
}) {
  const current = gyms.find((g) => g.gymId === currentId);
  if (gyms.length === 0) return null;

  const label = (
    <>
      <Shield className="h-4 w-4 shrink-0 text-amber-500" />
      {/* 手機獨佔一列: 名稱吃掉剩餘寬度 (館名可能很長, 截斷但看得到開頭),
          角色籤與 v 收在最右邊。桌機維持原本的 max-w-[9rem] 內嵌尺寸。 */}
      <span className="min-w-0 flex-1 truncate text-left sm:max-w-[9rem] sm:flex-none">
        {current?.gymName ?? "道館"}
      </span>
      {current && current.role !== "member" ? (
        // 手機字級下限 12px (text-xs), 桌機維持原本的 10px 小籤
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground max-sm:text-xs">
          {ROLE_LABELS[current.role]}
        </span>
      ) : null}
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tour="gym-switcher"
          className={cn(
            "flex items-center gap-1.5 rounded-md py-2 pr-1.5 text-sm font-medium",
            "transition-colors hover:bg-accent",
            // 手機: 自成一列且整列可點; 觸控裝置再撐到 44px 高
            "w-full pointer-coarse:min-h-11 sm:w-auto sm:shrink-0"
          )}
          title="切換道館"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {gyms.map((g) => (
          // 直接指終點 /members: 指 /gyms/[id] 會多吃一次 next.config 的 307 轉導,
          // 而且 Link 預取不到轉導來源 (轉導規則保留給直接打網址的人)。
          // cookie 仍由目標道館頁的 ActiveGymSync 寫入。
          <DropdownMenuItem
            key={g.gymId}
            asChild
            // 觸控裝置每一列 44px (與頭像選單同一套做法)
            className={cn("pointer-coarse:min-h-11", g.gymId === currentId && "bg-accent")}
          >
            <Link href={`/gyms/${g.gymId}/members`}>
              <Shield className="mr-2 h-4 w-4 text-amber-500" />
              <span className="truncate">{g.gymName}</span>
              <span className="ml-auto text-xs text-muted-foreground">{ROLE_LABELS[g.role]}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <Link href="/gyms?list=1" data-tour="gym-switcher-add">
            <Plus className="mr-2 h-4 w-4" />
            加入 / 建立道館
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
