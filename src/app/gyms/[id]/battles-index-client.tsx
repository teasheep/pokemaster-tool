"use client";

// 道館賽一覽 — 道館戰入口頁 (不再直接跳進單場看板)。
// 每場一張可展開的卡: 收合看狀態/賽期/戰果, 展開看每一關打成怎樣 (屬性/館主/出刀/分數)。

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {ChevronDown, Swords} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TypeIcon } from "@/components/sync-pair-badges";
import { TYPE_LABELS } from "@/data/sync-pairs";
import type { BattleStatus, SyncPairType } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type BattleListItem = {
  id: string;
  name: string;
  status: BattleStatus;
  startsOn: string | null;
  endsOn: string | null;
  summary: string | null;
  stages: {
    seq: number;
    weakType: SyncPairType;
    /** 該關累計出刀券數 (沒打過就是 0) */
    tickets: number;
  }[];
  /** battle_logs 彙總 (沒有紀錄 = null) */
  totals: { tickets: number; participants: number } | null;
};

const STATUS_LABEL: Record<BattleStatus, string> = {
  planning: "籌備中",
  active: "進行中",
  finished: "已結束",
};

const STATUS_STYLE: Record<BattleStatus, string> = {
  planning: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  active: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  finished: "bg-muted text-muted-foreground",
};

function fmtRange(startsOn: string | null, endsOn: string | null): string {
  // 日期以台北時間解讀 (DB 存台北零點 = UTC 前一日 16:00, 直接用 UTC 會少一天)
  const f = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
    });
  if (!startsOn && !endsOn) return "";
  return `${startsOn ? f(startsOn) : "?"} – ${endsOn ? f(endsOn) : "?"}`;
}

export function BattlesIndexClient({
  gymId,
  battles,
  isAdmin,
}: {
  gymId: string;
  battles: BattleListItem[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  // 進行中/籌備中預設展開; 都打完了就展開最新那場 (否則整頁只剩一排收合的標題)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = battles.filter((b) => b.status !== "finished").map((b) => b.id);
    return new Set(open.length > 0 ? open : battles.slice(0, 1).map((b) => b.id));
  });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function saveSummary(b: BattleListItem, value: string) {
    const v = value.trim() || null;
    if (v === b.summary) return;
    const { error } = await createClient().from("gym_battles").update({ summary: v }).eq("id", b.id);
    if (error) toast.error("儲存失敗", { description: error.message });
    else router.refresh();
  }

  if (battles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
        <h3 className="text-lg font-semibold">還沒有道館戰</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          管理員用右上角的「建立賽事」開第一場。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {battles.map((b, bi) => {
        const open = expanded.has(b.id);
        const range = fmtRange(b.startsOn, b.endsOn);
        return (
          <div
            key={b.id}
            data-tour={bi === 0 ? "battle-card" : undefined}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-shadow",
              b.status === "active" && "border-amber-500/50 shadow-md"
            )}
          >
            {/* 收合列: 整列可點展開 */}
            <button
              type="button"
              onClick={() => toggle(b.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-accent/40 pointer-coarse:min-h-11"
              aria-expanded={open}
            >
              <Badge variant="secondary" className={STATUS_STYLE[b.status]}>
                {STATUS_LABEL[b.status]}
              </Badge>
              <span className="text-base font-semibold">{b.name}</span>
              {range ? (
                <span className="text-sm tabular-nums text-muted-foreground">{range}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                {b.totals ? (
                  <span className="hidden tabular-nums sm:inline">
                    {b.totals.participants} 人參戰 ・ 使用 {b.totals.tickets} 張
                  </span>
                ) : null}
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                />
              </span>
            </button>


            {open ? (
              <div className="space-y-3 border-t px-4 py-3">
                {/* 每一關打成怎樣: 屬性 + 該關出刀券數 (只有屬性看不出東西)。
                    手機 4 欄 = 8 關兩排看完 (2 欄要排四排, 一支手機塞不下) */}
                <div className="grid grid-cols-4 gap-1.5 xl:grid-cols-8">
                  {b.stages.map((s) => (
                    <div
                      key={s.seq}
                      className="flex flex-col items-center gap-0.5 rounded-lg border bg-background px-1 py-2 text-center"
                    >
                      <TypeIcon type={s.weakType} className="h-6 w-6" />
                      <span className="text-xs font-medium">{TYPE_LABELS[s.weakType]}</span>
                      {s.tickets > 0 ? (
                        <span className="tabular-nums text-[10px] text-muted-foreground max-sm:text-xs">
                          {s.tickets} 張
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/50 max-sm:text-xs">
                          尚無紀錄
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* 結算備註 — 管理員直接改 (原本是匯入的一串文字, 沒地方編輯) */}
                {isAdmin ? (
                  <input
                    key={`${b.id}-summary-${b.summary ?? ""}`}
                    defaultValue={b.summary ?? ""}
                    maxLength={200}
                    placeholder="＋ 結算備註 (例: 全服排名 / 這次的檢討)"
                    onBlur={(e) => void saveSummary(b, e.target.value)}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-background focus:text-foreground pointer-coarse:min-h-11"
                  />
                ) : b.summary ? (
                  <p className="px-1 text-sm text-muted-foreground">{b.summary}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  {/* 手機: 主要動作整列可點 (原本 sm 尺寸的鈕只有 28px 高) */}
                  <Button
                    asChild
                    size="sm"
                    variant={b.status === "active" ? "default" : "outline"}
                    className="max-sm:w-full max-sm:min-h-11"
                  >
                    <Link href={`/gyms/${gymId}/battles/${b.id}`}>
                      <Swords className="mr-1 h-4 w-4" />
                      {b.status === "active"
                        ? "進入看板"
                        : b.status === "planning"
                          ? "進入籌備"
                          : "看完整紀錄"}
                    </Link>
                  </Button>
                  {b.totals && (
                    <span className="text-xs text-muted-foreground sm:hidden">
                      {b.totals.participants} 人參戰 ・ 使用 {b.totals.tickets} 張
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

    </div>
  );
}
