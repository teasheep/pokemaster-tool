"use client";

// 手機版「我要出刀」bottom sheet — 看板底部主行動鈕點開後的登記流程:
//   關卡 → 輪次 (預設目前輪) → 分工 (主力/補刀/降抗) → 挑戰券張數 → 送出。
//
// 這是**關卡卡片輪次列那顆 Swords 的同一條路徑**的手機捷徑 (拇指可及), 不是第二套寫入:
// 一律 reportBattleLog (插 battle_logs + 自動扣券), 欄位、預設值 (主力 / 3 張)、
// 管理員可代成員登記、已結束賽事仍可補登記 — 兩邊行為必須一致, 改一邊就要改另一邊。

import { useMemo, useState } from "react";
import { Swords } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MemberAvatar,
  MemberOption,
  memberLabel,
  type MemberCardData,
} from "@/components/gym/member-card";
import { TypeIcon } from "@/components/sync-pair-badges";
import { TYPE_LABELS } from "@/data/sync-pairs";
import { createClient } from "@/lib/supabase/client";
import { reportBattleLog } from "@/lib/gym/battle-log";
import { BATTLE_ROLE_LABELS, roundLabel, type BattleStatus } from "@/lib/gym/types";
import { cn } from "@/lib/utils";
import type { BattleLogRole } from "@/lib/supabase/types";
import type { BattleLogRow, StageRow } from "./stage-board";

/** 輪次上限與看板輪次列同一條 (r >= 1 && r <= 20) */
const MAX_ROUND = 20;

export type ReportRunSheetProps = {
  open: boolean;
  onClose: () => void;
  gymId: string;
  battleId: string;
  /** 目前輪 (由紀錄推導) — 預設就登記在這一輪 */
  round: number;
  /** 賽期推導的狀態 — 已結束只是提示語不同, 不擋登記 (與關卡卡片一致) */
  status: BattleStatus;
  stages: StageRow[];
  logs: BattleLogRow[];
  members: MemberCardData[];
  myMemberId: string | null;
  isAdmin: boolean;
  /** 我這場的挑戰券 (剩餘/上限); 尚未發放 = null */
  myTickets: { remaining: number; cap: number } | null;
  onChanged: () => Promise<void>;
};

export function ReportRunSheet({
  open,
  onClose,
  gymId,
  battleId,
  round,
  status,
  stages,
  logs,
  members,
  myMemberId,
  isAdmin,
  myTickets,
  onChanged,
}: ReportRunSheetProps): React.ReactElement {
  const supabase = useMemo(() => createClient(), []);
  const [stageId, setStageId] = useState<string | null>(null);
  /** null = 跟著「目前輪」走 (有人回報就自動前進); 手動選過才固定 */
  const [roundOverride, setRoundOverride] = useState<number | null>(null);
  const [role, setRole] = useState<BattleLogRole>("main");
  const [tickets, setTickets] = useState(3);
  /** 管理員代登記的對象 (預設自己) */
  const [memberSel, setMemberSel] = useState(myMemberId ?? "");
  const [saving, setSaving] = useState(false);

  const r = roundOverride ?? round;
  const targetId = isAdmin ? memberSel || null : myMemberId;
  const targetMember = members.find((m) => m.id === targetId) ?? null;
  const forMe = targetId !== null && targetId === myMemberId;

  /** 這一輪每關的進度: 已用券 + 登記對象出過沒 (選關卡時直接看得出還缺哪關) */
  const roundInfo = useMemo(() => {
    const map = new Map<string, { used: number; mine: boolean }>();
    for (const s of stages) map.set(s.id, { used: 0, mine: false });
    for (const l of logs) {
      if (!l.stage_id || (l.round ?? 0) !== r) continue;
      const cur = map.get(l.stage_id);
      if (!cur) continue;
      cur.used += l.tickets_used;
      if (targetId && l.member_id === targetId) cur.mine = true;
    }
    return map;
  }, [stages, logs, r, targetId]);

  const stage = stages.find((s) => s.id === stageId) ?? null;
  const ready = stage !== null && targetId !== null && !saving;

  async function submit() {
    if (!stage || !targetId) return;
    setSaving(true);
    try {
      // 與關卡卡片、對戰紀錄側板同一條路: 插 log + 自動扣挑戰券
      const res = await reportBattleLog(supabase, {
        gymId,
        battleId,
        memberId: targetId,
        stageId: stage.id,
        round: r,
        role,
        ticketsUsed: tickets,
      });
      if (!res.ok) {
        toast.error("登記失敗", { description: res.error });
        return;
      }
      const who = forMe ? "" : `${memberLabel(targetMember ?? { displayName: "成員" })} `;
      if (res.deductWarning) {
        toast.warning("已登記, 但挑戰券扣除失敗 (請手動調整)", {
          description: res.deductWarning,
        });
      } else {
        toast.success(
          `已登記: ${TYPE_LABELS[stage.weak_type]}關 ${roundLabel(r)} ${who}${BATTLE_ROLE_LABELS[role]} ${tickets} 張`
        );
      }
      await onChanged();
      // 關卡每次都重選 (連續出刀通常換關), 分工/張數留著方便重複登記
      setStageId(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="我要出刀"
      // SidePanel 本身是 z-50, 蓋得過底部導覽列 (z-40) 與看板的出刀列 (z-30);
      // 這裡只調高度 (隨內容, 別留一大塊空白) 與 iPhone 底部安全區的內距
      className="max-sm:h-auto max-sm:max-h-[86dvh] max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      {/* 我的挑戰券 / 已結束提示 — 送出前該知道的事 */}
      <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {myTickets ? (
          <span className="tabular-nums">
            我的挑戰券{" "}
            <span
              className={cn(
                "font-semibold text-foreground",
                myTickets.remaining === 0 && "text-red-500"
              )}
            >
              {myTickets.remaining}
            </span>
            {" / "}
            {myTickets.cap}
          </span>
        ) : (
          <span>尚未發放挑戰券</span>
        )}
        {status === "finished" ? <span>・這場已結束, 仍可補登記</span> : null}
      </div>

      {/* 1. 代誰登記 (管理員才有; 一般成員固定是自己) */}
      {isAdmin ? (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">登記給</span>
          <Select value={memberSel} onValueChange={setMemberSel}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="選擇成員" />
            </SelectTrigger>
            <SelectContent>
              {members
                .filter((m) => m.role !== "advisor")
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <MemberOption member={m} />
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : targetMember ? (
        <div className="flex items-center gap-2 text-sm font-medium">
          <MemberAvatar member={targetMember} size="sm" className="h-7 w-7" />
          {memberLabel(targetMember)}
        </div>
      ) : null}

      {/* 2. 關卡 — 8 關一次看完, 順便看本輪誰打過沒 */}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground">
          關卡 (本輪 {roundLabel(r)} 進度)
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {stages.map((s) => {
            const info = roundInfo.get(s.id) ?? { used: 0, mine: false };
            const on = s.id === stageId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStageId(s.id)}
                aria-pressed={on}
                className={cn(
                  "relative flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors",
                  on
                    ? "border-primary bg-primary/10 ring-2 ring-primary"
                    : "bg-background hover:bg-accent/50"
                )}
              >
                <TypeIcon type={s.weak_type} className="h-5 w-5" />
                <span className="text-xs font-medium">{TYPE_LABELS[s.weak_type]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {info.used > 0 ? `${info.used} 張` : "—"}
                </span>
                {/* 這一輪已經幫這個人登記過了 — 避免重複出刀 */}
                {info.mine ? (
                  <span
                    title="本輪已登記過"
                    className="absolute right-0.5 top-0.5 rounded-full bg-emerald-500/20 px-1 text-xs font-semibold leading-4 text-emerald-700 dark:text-emerald-300"
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 輪次 — 預設目前輪, 要補登記舊輪就用左右調 */}
      <div className="flex items-center gap-2">
        <span className="block text-xs font-medium text-muted-foreground">輪次</span>
        <span className="ml-auto inline-flex items-stretch overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => setRoundOverride(Math.max(1, r - 1))}
            disabled={r <= 1}
            aria-label="上一輪"
            className="flex min-h-11 w-11 items-center justify-center text-base transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
          >
            −
          </button>
          <span className="flex min-w-16 items-center justify-center border-x px-2 text-sm font-semibold tabular-nums">
            {roundLabel(r)}
          </span>
          <button
            type="button"
            onClick={() => setRoundOverride(Math.min(MAX_ROUND, r + 1))}
            disabled={r >= MAX_ROUND}
            aria-label="下一輪"
            className="flex min-h-11 w-11 items-center justify-center text-base transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
          >
            ＋
          </button>
        </span>
        {roundOverride !== null && roundOverride !== round ? (
          <button
            type="button"
            onClick={() => setRoundOverride(null)}
            className="min-h-11 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            回到 {roundLabel(round)}
          </button>
        ) : null}
      </div>

      {/* 4. 分工 — 主力 / 補刀 / 降抗 (與關卡卡片同樣預設主力) */}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground">分工</span>
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border">
          {(["main", "assist", "debuff"] as const).map((ro) => (
            <button
              key={ro}
              type="button"
              onClick={() => setRole(ro)}
              aria-pressed={role === ro}
              className={cn(
                "min-h-11 border-r text-sm transition-colors last:border-r-0",
                role === ro
                  ? ro === "debuff"
                    ? "bg-sky-500/20 font-semibold text-sky-700 dark:text-sky-300"
                    : "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {BATTLE_ROLE_LABELS[ro]}
            </button>
          ))}
        </div>
      </div>

      {/* 5. 挑戰券張數 */}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground">挑戰券</span>
        <div className="grid grid-cols-3 gap-1.5">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTickets(n)}
              aria-pressed={tickets === n}
              className={cn(
                "min-h-11 rounded-lg border text-sm font-medium tabular-nums transition-colors",
                tickets === n
                  ? "border-primary bg-primary/10 ring-2 ring-primary"
                  : "bg-background hover:bg-accent/50"
              )}
            >
              {n} 張
            </button>
          ))}
        </div>
        {myTickets && forMe && tickets > myTickets.remaining ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            我只剩 {myTickets.remaining} 張 — 仍可登記, 差額請管理員在「挑戰券」調整
          </p>
        ) : null}
      </div>

      {/* 送出 — 一眼確認登記的內容 */}
      <Button
        className="min-h-12 w-full text-base"
        disabled={!ready}
        onClick={() => void submit()}
      >
        <Swords className="mr-1.5 h-4 w-4" />
        {stage
          ? `送出 ${roundLabel(r)} ${TYPE_LABELS[stage.weak_type]}・${BATTLE_ROLE_LABELS[role]}・${tickets} 張`
          : "先選一關"}
      </Button>
      {isAdmin && !targetId ? (
        <p className="-mt-2 text-xs text-muted-foreground">選一位成員才能登記。</p>
      ) : null}
    </SidePanel>
  );
}
