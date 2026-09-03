"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Swords, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BattleStatusBadge } from "@/components/gym/gym-ui";
import { MemberAvatar, MemberOption, memberLabel, type MemberCardData } from "@/components/gym/member-card";
import { TypeIcon } from "@/components/sync-pair-badges";
import type { TeamPairRow, TeamRow } from "@/components/gym/team-sheet";
import type { CandyCounts } from "@/components/gym/candy";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { TYPE_LABELS } from "@/data/sync-pairs";
import {
  StageBoard,
  type BattleLogRow,
  type StageRow,
  type StageTeamRow,
} from "./stage-board";
import { ReportRunSheet } from "./report-run-sheet";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { reportBattleLog } from "@/lib/gym/battle-log";
import { cn } from "@/lib/utils";
import type { GymViewer } from "@/lib/gym/queries";
import {
  BATTLE_ROLE_LABELS,
  BATTLE_STATUS_LABELS,
  TICKETS_MAX,
  battleStatusFromDates,
  roundLabel,
  type BattleStatus,
} from "@/lib/gym/types";
import { spentByMember } from "@/lib/gym/tickets";
import type { BattleLogRole, Database, SyncPairType } from "@/lib/supabase/types";

/** realtime 事件合併的窗口 (ms) — 理由見下面掛 channel 的那個 effect */
const COALESCE_MS = 200;

// StageRow / BattleLogRow 是 stage-board 那邊的欄位投影 (兩處讀的是同一批資料)
type TicketRow = Pick<
  Database["public"]["Tables"]["member_tickets"]["Row"],
  "member_id" | "remaining" | "cap"
>;

/**
 * 看板兩份最大的資料在 RSC prop 裡都改用索引式傳輸 (pack 在 page.tsx, **兩邊一起改**) —
 * 一場 290 列的對戰紀錄與 2047 列的全館持有, 原樣送分別是 67.2KB / 32.8KB, 而其中
 * 一大半是同一批 36 字元 uuid 與 11 碼 pairId 被重複幾百上千次。壓完是 21.5KB / 13.2KB,
 * 解回來的物件與舊版逐欄相同 (下面兩支 unpack 就是唯一的還原處)。
 */
export type PackedLogs = {
  /** 紀錄裡出現過的成員 id (順序 = 索引; 由紀錄推導, 不是名冊 — 已移出道館的人也要留著) */
  memberIds: string[];
  /** 紀錄裡出現過的關卡 id (順序 = 索引) */
  stageIds: string[];
  /** [id, 成員索引, 關卡索引(-1=不指定), 角色, 用券數, 輪次, created_at epoch 毫秒] */
  rows: readonly (readonly [string, number, number, string, number, number | null, number])[];
};

export type PackedMemberGrades = {
  /** 有人持有的 pairId (順序 = 索引) */
  pairIds: string[];
  /** memberId → [pairId 索引, 練度, pairId 索引, 練度, …] */
  byMember: Record<string, number[]>;
};

function unpackLogs(packed: PackedLogs): BattleLogRow[] {
  return packed.rows.map(([id, mi, si, role, ticketsUsed, round, createdAt]) => ({
    id,
    member_id: packed.memberIds[mi],
    stage_id: si >= 0 ? packed.stageIds[si] : null,
    role: role as BattleLogRole,
    tickets_used: ticketsUsed,
    round,
    // 顯示只到分鐘 (toLocaleString), 排序由 server 的 order 決定 → 毫秒精度綽綽有餘
    created_at: new Date(createdAt).toISOString(),
  }));
}

function unpackMemberGrades(packed: PackedMemberGrades): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [memberId, flat] of Object.entries(packed.byMember)) {
    const inner: Record<string, number> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const pairId = packed.pairIds[flat[i]];
      if (pairId) inner[pairId] = flat[i + 1];
    }
    out[memberId] = inner;
  }
  return out;
}

export type PairLabelMap = Record<string, { label: string; type: SyncPairType }>;

type Props = {
  gymId: string;
  viewer: GymViewer;
  battle: {
    id: string;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
  };
  members: MemberCardData[];
  initialStages: StageRow[];
  initialTickets: TicketRow[];
  /** 對戰紀錄 (索引式傳輸, 見 PackedLogs) — 進到元件裡就還原成 BattleLogRow[] */
  initialLogs: PackedLogs;
  /** 全館持有 (索引式傳輸, 見 PackedMemberGrades) — 還原後就是 memberId → pairId → 練度 */
  memberGrades: PackedMemberGrades;
  memberCandies: Record<string, CandyCounts>;
  /** 圖鑑子集 (道館名單 ∪ 已在隊伍裡) — 整本由 fullCatalogUrl 按需抓 */
  catalog: ClientPairRecord[];
  /** 「全圖鑑」按需載入的網址 (`/api/catalog?v=<指紋>`) */
  fullCatalogUrl: string;
  initialTeams: TeamRow[];
  initialTeamPairs: TeamPairRow[];
  initialStageTeams: StageTeamRow[];
  /** 本道館的所有賽事 (切換器用, 依建立時間新→舊) */
  allBattles: { id: string; name: string; status: BattleStatus }[];
  /** 每關每輪的敘述 (stage_round_notes) */
  initialRoundNotes: { stage_id: string; round: number; note: string }[];
  /** 道館拍組名單 — 隊伍編輯候選池 */
  gymPairsList: { pairId: string; type: SyncPairType }[];
};

export function BattleClient({
  gymId,
  viewer,
  battle,
  members,
  initialStages,
  initialTickets,
  initialLogs,
  memberGrades: packedGrades,
  memberCandies,
  catalog,
  fullCatalogUrl,
  initialTeams,
  initialTeamPairs,
  initialStageTeams,
  allBattles,
  initialRoundNotes,
  gymPairsList,
}: Props) {
  const router = useRouter();
  /** 換賽事是 router.push (不是 Link, 吃不到 useLinkStatus) → 用 transition 自己給回饋 */
  const [switchingBattle, startSwitchBattle] = useTransition();
  const supabase = useMemo(() => createClient(), []);
  const [stages, setStages] = useState(initialStages);
  const [tickets, setTickets] = useState(initialTickets);
  // 索引式的初始資料只在這裡還原一次; 之後 realtime 重抓拿到的本來就是完整列
  const [logs, setLogs] = useState<BattleLogRow[]>(() => unpackLogs(initialLogs));
  const memberGrades = useMemo(() => unpackMemberGrades(packedGrades), [packedGrades]);
  const [teams, setTeams] = useState(initialTeams);
  const [teamPairs, setTeamPairs] = useState(initialTeamPairs);
  const [stageTeams, setStageTeams] = useState(initialStageTeams);
  const [roundNotes, setRoundNotes] = useState(initialRoundNotes);
  /** 目前輪 — 由出戰紀錄推導 (最大已回報輪; 0047 起不再存欄位, 同狀態推導哲學) */
  const round = useMemo(
    () => Math.max(1, ...logs.map((l) => l.round ?? 0)),
    [logs]
  );
  const [dates, setDates] = useState({ startsOn: battle.startsOn, endsOn: battle.endsOn });
  /** 狀態由賽期日期推導 (籌備中/進行中/已結束) — 改日期就換狀態, 沒有手動下拉 */
  const status = battleStatusFromDates(dates.startsOn, dates.endsOn);
  /** 「對戰紀錄」側滑面板 */
  const [panelOpen, setPanelOpen] = useState(false);
  /** 賽事改名中 (管理員, 失焦儲存) */
  const [renaming, setRenaming] = useState(false);
  /** 挑戰券側板 (點了才出現, 不常駐佔版面) */
  const [ticketsOpen, setTicketsOpen] = useState(false);
  /** 手機底部主行動鈕「我要出刀」的 bottom sheet */
  const [runSheetOpen, setRunSheetOpen] = useState(false);

  const ticketByMember = useMemo(
    () => new Map(tickets.map((t) => [t.member_id, t])),
    [tickets]
  );

  /**
   * 手機底部常駐「我要出刀」的出現條件 —— 與關卡卡片輪次列那顆 Swords 完全同一組:
   * 顧問 (canEdit=false) 唯讀不出現; 沒綁成員的人也不出現 (管理員例外, 他能代成員登記)。
   * 已結束的賽事照樣可以補登記 (關卡卡片就是這樣, 兩邊要一致)。
   */
  const canReportRun = viewer.canEdit && (viewer.memberId !== null || viewer.isAdmin);
  const myTicket = viewer.memberId ? ticketByMember.get(viewer.memberId) : undefined;

  // ── Realtime: 券數 / 關卡 / 出戰紀錄 任一變動就重抓該表 (RLS 管事件可見性) ──
  // select 一律明列欄位, 與 page.tsx 的初始查詢同一組 (型別就是那幾個欄位的投影)
  const refetchStages = useCallback(async () => {
    const { data } = await supabase
      .from("battle_stages")
      .select("id, weak_type")
      .eq("battle_id", battle.id)
      .order("seq");
    if (data) setStages(data);
  }, [supabase, battle.id]);

  const refetchTickets = useCallback(async () => {
    const { data } = await supabase
      .from("member_tickets")
      .select("member_id, remaining, cap")
      .eq("battle_id", battle.id);
    if (data) setTickets(data);
  }, [supabase, battle.id]);

  const refetchStatus = useCallback(async () => {
    const { data } = await supabase
      .from("gym_battles")
      .select("starts_on, ends_on")
      .eq("id", battle.id)
      .maybeSingle();
    if (data) {
      setDates({ startsOn: data.starts_on, endsOn: data.ends_on });
    }
  }, [supabase, battle.id]);

  const refetchLogs = useCallback(async () => {
    // **一定要分頁** —— PostgREST 一次最多回 1000 列。這一支之前是純 .eq() 沒有 range:
    // 首次 SSR (battles/[battleId]/page.tsx) 是分頁的, 但 realtime 刷新之後就會**靜默截斷**
    // 在剛好 1000 列, 而且只在場次夠大時才發生 (券上限可調到 99, 0 張券也能插列)。
    // AGENTS.md「PostgREST 一次最多 1000 列」列了三個地方, 這是漏掉的第四個。
    //
    // firstBatchPages: 1 —— 這支會被**每一個開著看板的人**同時呼叫, 預設的 3 頁平行
    // 等於把 2 個空請求乘上人數 (見 fetch-all.ts 的 FetchAllOptions)。
    // order 要有決勝鍵: offset 分頁在讀取期間有人寫入會讓列位移, 邊界會重複或漏。
    const data = await fetchAllRows<BattleLogRow>(
      (from, to) =>
        supabase
          .from("battle_logs")
          .select("id, member_id, stage_id, role, tickets_used, round, created_at")
          .eq("battle_id", battle.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      { firstBatchPages: 1 }
    );
    setLogs(data);
  }, [supabase, battle.id]);

  const refetchRoundNotes = useCallback(async () => {
    const { data } = await supabase
      .from("stage_round_notes")
      .select("stage_id, round, note")
      .eq("battle_id", battle.id);
    if (data) setRoundNotes(data);
  }, [supabase, battle.id]);

  const refetchTeams = useCallback(async () => {
    const [{ data: t }, { data: tp }, { data: st }] = await Promise.all([
      supabase.from("gym_teams").select("id, type, name, tag, note, sort_order").eq("gym_id", gymId),
      supabase
        .from("gym_team_pairs")
        .select("id, team_id, slot, pair_id, min_grade")
        .eq("gym_id", gymId),
      supabase.from("stage_teams").select("stage_id, team_id").eq("battle_id", battle.id),
    ]);
    if (t) setTeams(t);
    if (tp) setTeamPairs(tp);
    if (st) setStageTeams(st);
  }, [supabase, gymId, battle.id]);

  /** 8 關看板的任一操作後: 一次刷新相關資料 */
  const refetchBoard = useCallback(async () => {
    await Promise.all([
      refetchStages(),
      refetchLogs(),
      refetchTickets(),
      refetchTeams(),
      refetchRoundNotes(),
    ]);
  }, [refetchStages, refetchLogs, refetchTickets, refetchTeams, refetchRoundNotes]);

  /**
   * Realtime → 重抓。**事件要先合併再抓**, 不要一個事件一次查詢。
   *
   * 這是全站唯一會被放大的地方: 看板開著的每一個人都訂了同樣四張表, 所以
   * 「一個人做一件事」= 所有人各自發查詢。而且一次出刀本來就會產生**兩個**事件
   * (`reportBattleLog` 插 battle_logs + `adjust_member_ticket` 更新 member_tickets),
   * 道館戰進行中大家幾秒出一刀 —— 沒有合併的話, 每一刀都乘上開著看板的人數。
   *
   * 合併之後: 同一個 COALESCE_MS 窗口內不管進來幾個事件、幾張表, 每張表最多只重抓一次
   * (`pending` 是 Set)。十個人同時出刀從 20 次查詢/人 變成 2 次查詢/人。
   *
   * 200ms 是「看起來仍然是即時的」與「真的合併得到東西」的折衷 —— 人對 200ms 的延遲
   * 不會有感, 但同一批動作幾乎都落在同一個窗口裡。
   */
  useEffect(() => {
    const filter = `battle_id=eq.${battle.id}`;
    const jobs: Record<string, () => Promise<void>> = {
      tickets: refetchTickets,
      stages: refetchStages,
      logs: refetchLogs,
      status: refetchStatus,
    };
    const pending = new Set<keyof typeof jobs>();
    let timer = 0;

    const flush = () => {
      timer = 0;
      const due = [...pending];
      pending.clear();
      void Promise.all(due.map((k) => jobs[k]()));
    };
    const mark = (k: keyof typeof jobs) => {
      pending.add(k);
      if (!timer) timer = window.setTimeout(flush, COALESCE_MS);
    };

    const channel = supabase
      .channel(`battle-${battle.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_tickets", filter },
        () => mark("tickets")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "battle_stages", filter },
        () => mark("stages")
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "battle_logs", filter }, () =>
        mark("logs")
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gym_battles", filter: `id=eq.${battle.id}` },
        () => mark("status")
      )
      .subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, battle.id, refetchTickets, refetchStages, refetchStatus, refetchLogs]);

  async function updateDates(patch: { starts_on?: string | null; ends_on?: string | null }) {
    const { error } = await supabase.from("gym_battles").update(patch).eq("id", battle.id);
    if (error) {
      toast.error("更新日期失敗", { description: error.message });
      return;
    }
    setDates((d) => ({
      startsOn: patch.starts_on !== undefined ? patch.starts_on : d.startsOn,
      endsOn: patch.ends_on !== undefined ? patch.ends_on : d.endsOn,
    }));
  }

  /** 管理員改賽事名稱 (失焦儲存; 空值或沒改就只收起) */
  async function saveName(raw: string) {
    setRenaming(false);
    const v = raw.trim();
    if (!v || v === battle.name) return;
    const { error } = await supabase.from("gym_battles").update({ name: v }).eq("id", battle.id);
    if (error) toast.error("改名失敗", { description: error.message });
    else {
      toast.success(`已改名「${v}」`);
      router.refresh();
    }
  }

  /** 管理員刪除賽事 — cascade 連鎖刪關卡/紀錄/券數, 回到一覽 */
  async function deleteBattle() {
    const { error } = await supabase.from("gym_battles").delete().eq("id", battle.id);
    if (error) {
      toast.error("刪除失敗", { description: error.message });
      return;
    }
    toast.success(`已刪除「${battle.name}」`);
    router.push(`/gyms/${gymId}/battles`);
    router.refresh();
  }

  const spent = spentByMember(logs);

  // 出刀列是 fixed 的, 頁尾又在這個元件外面 (root layout) —— 只有 body 補得到那 65px。
  // 標記在 body 上由 globals.css 的 media query 接手 (只在手機生效), 離開頁面就拿掉。
  useEffect(() => {
    if (!canReportRun) return;
    document.body.dataset.runBar = "1";
    return () => {
      delete document.body.dataset.runBar;
    };
  }, [canReportRun]);

  return (
    <div className={cn("space-y-3", canReportRun && "max-sm:pb-20")}>
      {/*
        頂部列: 賽事切換 / 改名 / 狀態 / 賽期 + 挑戰券 / 對戰紀錄 / 刪除賽事。
        手機一律「一組一整列」(basis-full) —— 之前擠成兩排還把右側動作推出畫面,
        入口等於消失。桌機 (sm:) 維持原本的單列排法。
      */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
        {/* 賽事名稱 + 改名 + 狀態 (手機自成一列) */}
        {/* 手機才收成 gap-1.5; 桌機這三者原本是外層 flex 的直接子項, 吃的是 gap-2 */}
        <div className="flex min-w-0 basis-full items-center gap-1.5 sm:basis-auto sm:gap-2">
          {/* 賽事切換器 — 歷屆賽事 (含已結束的紀錄) 直接跳 */}
          {allBattles.length > 1 ? (
            <Select
              value={battle.id}
              onValueChange={(v) =>
                startSwitchBattle(() => router.push(`/gyms/${gymId}/battles/${v}`))
              }
            >
              <SelectTrigger
                size="sm"
                // 切換中先淡掉 — 換賽事要重抓整個看板, 沒回饋會讓人以為沒選到
                className={`h-8 min-w-0 flex-1 border-none bg-transparent px-1 text-lg font-bold tracking-tight shadow-none transition-opacity hover:bg-accent motion-reduce:transition-none sm:flex-none${
                  switchingBattle ? " opacity-60" : ""
                }`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allBattles.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {BATTLE_STATUS_LABELS[b.status]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:flex-none">
              {battle.name}
            </h1>
          )}
          {/* 賽事名稱建立後也要能改 (稽核: 之前只有建立 dialog 一條寫入路) */}
          {viewer.isAdmin ? (
            renaming ? (
              <Input
                autoFocus
                defaultValue={battle.name}
                maxLength={50}
                className="h-8 w-44 max-w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={(e) => void saveName(e.target.value)}
              />
            ) : (
              <button
                onClick={() => setRenaming(true)}
                title="改賽事名稱"
                aria-label="改賽事名稱"
                className="inline-flex shrink-0 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )
          ) : null}
          {/* 狀態不用手動選 — 由旁邊的賽期日期直接推導 */}
          <BattleStatusBadge status={status} />
        </div>

        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />

        {/* 賽期 — 管理員直接改, 其他人看日期 */}
        {viewer.isAdmin ? (
          <span className="flex basis-full items-center gap-1 text-xs text-muted-foreground sm:basis-auto">
            <Input
              type="date"
              value={dates.startsOn ?? ""}
              onChange={(e) => void updateDates({ starts_on: e.target.value || null })}
              className="h-7 min-w-0 flex-1 text-xs sm:w-[128px] sm:flex-none"
            />
            ~
            <Input
              type="date"
              value={dates.endsOn ?? ""}
              onChange={(e) => void updateDates({ ends_on: e.target.value || null })}
              className="h-7 min-w-0 flex-1 text-xs sm:w-[128px] sm:flex-none"
            />
          </span>
        ) : dates.startsOn ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {dates.startsOn} ~ {dates.endsOn ?? "?"}
          </span>
        ) : null}

        <span className="flex basis-full items-center gap-1.5 sm:ml-auto sm:basis-auto sm:flex-wrap">
          {/* 隊伍庫 / 道館攻略 是上面的分頁, 這裡不再放第二個入口 (同一件事兩條路) */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 sm:flex-none"
            onClick={() => setTicketsOpen(true)}
            title="每位成員的挑戰券剩餘數"
          >
            <Ticket className="mr-1 h-3.5 w-3.5" />
            挑戰券
            {/* 手機把「我還剩幾張」直接寫在鈕上 — 最高頻的疑問 */}
            {myTicket ? (
              <span className="tabular-nums text-muted-foreground sm:hidden">
                {myTicket.remaining}/{myTicket.cap}
              </span>
            ) : null}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 sm:flex-none"
            onClick={() => setPanelOpen(true)}
            title="這場的對戰明細"
          >
            <Swords className="mr-1 h-3.5 w-3.5" />
            對戰紀錄
          </Button>
          {/* 刪除賽事 — 建錯場終於有出口 (之前只能求腳本); 連鎖刪關卡/紀錄/券數 */}
          {viewer.isAdmin ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  title="刪除這場賽事"
                  aria-label="刪除這場賽事"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>刪除「{battle.name}」?</AlertDialogTitle>
                  <AlertDialogDescription>
                    這場的關卡、對戰紀錄、挑戰券資料會一併刪除, 無法復原。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>先不要</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void deleteBattle()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    刪除賽事
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </span>
      </div>

      {/* 主體: 看板全寬 (券數收進「挑戰券」側板, 點了才出現) */}
      <div>
        <div className="min-w-0">
          <StageBoard
            gymId={gymId}
            battleId={battle.id}
            isAdmin={viewer.isAdmin}
            canEdit={viewer.canEdit}
            myMemberId={viewer.memberId}
            round={round}
            stages={stages}
            logs={logs}
            members={members}
            memberGrades={memberGrades}
            memberCandies={memberCandies}
            catalog={catalog}
            fullCatalogUrl={fullCatalogUrl}
            teams={teams}
            teamPairs={teamPairs}
            stageTeams={stageTeams}
            roundNotes={roundNotes}
            gymPairsList={gymPairsList}
            onChanged={refetchBoard}
          />
        </div>
      </div>

      {/*
        手機常駐的主行動鈕 —— 出刀是這頁最高頻的動作, 之前只藏在關卡卡片裡的 28px 小圖示。
        位置**疊在底部導覽列正上方**: 那一列是 fixed bottom-0 / min-h-14 (56px) + 1px border
        + iPhone 安全區 (見 mobile-tab-bar.tsx 與 layout 的 body padding, 三處同一組數字),
        所以這條的 bottom 用同一個 calc, 兩者不會互相蓋。層級 (三處要一致):
        出刀列 z-30 < 底部導覽列 z-40 (mobile-tab-bar.tsx) < 側板 z-50 (ui/side-panel.tsx),
        側板升起時一律蓋過兩者。內容的下方留白: 元件內 max-sm:pb-20, 頁尾底下那份靠
        body[data-run-bar] (見 globals.css) —— fixed 元素補不到元件外面的頁尾。
      */}
      {canReportRun ? (
        <div
          className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-3 py-2 backdrop-blur sm:hidden"
        >
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <span className="min-w-0 text-xs leading-tight">
              <span className="block font-semibold">目前 {roundLabel(round)}</span>
              <span className="block tabular-nums text-muted-foreground">
                {myTicket ? `我的挑戰券 ${myTicket.remaining}/${myTicket.cap}` : "尚未發放挑戰券"}
              </span>
            </span>
            <Button
              className="ml-auto min-h-12 flex-1 text-base"
              onClick={() => setRunSheetOpen(true)}
            >
              <Swords className="mr-1.5 h-4 w-4" />
              我要出刀
            </Button>
          </div>
        </div>
      ) : null}

      {/* 出刀 bottom sheet — 與關卡卡片同一條 reportBattleLog, 只是拇指可及的捷徑
          (顧問/未綁定成員連元件都不掛, 沒有第二條進得去的路) */}
      {canReportRun ? (
      <ReportRunSheet
        open={runSheetOpen}
        onClose={() => setRunSheetOpen(false)}
        gymId={gymId}
        battleId={battle.id}
        round={round}
        status={status}
        stages={stages}
        logs={logs}
        members={members}
        myMemberId={viewer.memberId}
        isAdmin={viewer.isAdmin}
        myTickets={myTicket ? { remaining: myTicket.remaining, cap: myTicket.cap } : null}
        onChanged={refetchBoard}
      />
      ) : null}

      {/* 挑戰券側板 — 誰還有幾券 (由多到少) */}
      <Sheet open={ticketsOpen} onOpenChange={setTicketsOpen}>
        <SheetContent className="max-w-sm">
          <SheetHeader>
            <SheetTitle>挑戰券</SheetTitle>
          </SheetHeader>
          <TicketRail
            gymId={gymId}
            battleId={battle.id}
            viewer={viewer}
            members={members}
            ticketByMember={ticketByMember}
            spent={spent}
            onChanged={refetchTickets}
          />
        </SheetContent>
      </Sheet>

      {/* 這場的對戰明細收進側滑面板 (「紀錄」分頁講的是成員練度變化, 兩者不同) */}
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent className="max-w-3xl">
          <SheetHeader>
            <SheetTitle>對戰紀錄</SheetTitle>
          </SheetHeader>

          <BattleLogsCard
            gymId={gymId}
            battleId={battle.id}
            viewer={viewer}
            members={members}
            stages={stages}
            logs={logs}
            onChanged={async () => {
              await Promise.all([refetchLogs(), refetchTickets()]);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── 券數排行 (側欄): 由多到少, 直接看誰還有票 ──

function TicketRail({
  gymId,
  battleId,
  viewer,
  members,
  ticketByMember,
  spent,
  onChanged,
}: {
  gymId: string;
  battleId: string;
  viewer: GymViewer;
  members: MemberCardData[];
  ticketByMember: Map<string, { remaining: number; cap: number }>;
  spent: Record<string, number>;
  onChanged: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);

  const rows = useMemo(
    () =>
      members
        .map((m) => {
          const t = ticketByMember.get(m.id);
          return {
            member: m,
            remaining: t?.remaining ?? null,
            cap: t?.cap ?? null,
            used: spent[m.id] ?? 0,
          };
        })
        .sort((a, b) => {
          // 自己永遠置頂 (最高頻查詢是「我剩幾張」), 其餘由多到少
          if (a.member.id === viewer.memberId) return -1;
          if (b.member.id === viewer.memberId) return 1;
          return (b.remaining ?? -1) - (a.remaining ?? -1);
        }),
    [members, ticketByMember, spent, viewer.memberId]
  );
  const issued = rows.filter((r) => r.remaining !== null).length;

  /** delta 調剩餘, capDelta 調上限 — DB 端原子運算, row 不存在以 30/30 建立 */
  async function adjust(memberId: string, patch: { delta?: number; capDelta?: number }) {
    const { error } = await supabase.rpc("adjust_member_ticket", {
      p_gym: gymId,
      p_battle: battleId,
      p_member: memberId,
      p_delta: patch.delta ?? 0,
      p_cap_delta: patch.capDelta ?? 0,
    });
    if (error) toast.error("更新挑戰券失敗", { description: error.message });
    else await onChanged();
  }

  async function issueAll() {
    const missing = rows.filter((r) => r.remaining === null);
    if (missing.length === 0) {
      toast.info("所有成員都已發放挑戰券");
      return;
    }
    const { error } = await supabase.from("member_tickets").upsert(
      missing.map((r) => ({
        gym_id: gymId,
        battle_id: battleId,
        member_id: r.member.id,
        remaining: TICKETS_MAX,
      })),
      { onConflict: "battle_id,member_id", ignoreDuplicates: true }
    );
    if (error) toast.error("發放挑戰券失敗", { description: error.message });
    else {
      toast.success(`已為 ${missing.length} 位成員發放挑戰券 (30/30)`);
      await onChanged();
    }
  }

  // 觸控目標一律靠 pointer-coarse 的 min-w/min-h 撐到 44px (min-* 蓋得過固定 h-*),
  // 視覺尺寸在桌機維持原樣 — 不是把電腦版整個放大
  const stepBtn =
    "flex w-8 items-center justify-center text-sm text-muted-foreground transition-colors " +
    "hover:bg-accent hover:text-foreground active:bg-accent/70 disabled:pointer-events-none " +
    "disabled:opacity-25 pointer-coarse:w-11 pointer-coarse:min-h-11";
  const capBtn =
    "flex h-5 w-5 items-center justify-center rounded-md border text-[11px] leading-none max-sm:text-xs " +
    "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground " +
    "disabled:pointer-events-none disabled:opacity-25 pointer-coarse:h-11 pointer-coarse:w-11";

  // 側板內容 — 外框/標題由 Sheet 提供, 這裡只有名單 (捲動交給 SheetContent)
  return (
    <div>
      <div className="space-y-0.5 py-1">
        {rows.map(({ member, remaining, cap, used }) => {
          const mine = member.id === viewer.memberId;
          const editable = viewer.isAdmin || mine;
          return (
            <div
              key={member.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40 ${
                mine ? "bg-primary/5" : ""
              }`}
            >
              <MemberAvatar member={member} size="sm" className="h-7 w-7" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium sm:text-xs">
                  {memberLabel(member)}
                </span>
                <span className="block text-[11px] tabular-nums text-muted-foreground max-sm:text-xs">
                  已使用 {used} 張
                </span>
              </span>
              {remaining === null ? (
                editable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => adjust(member.id, {})}
                  >
                    發放 (30/30)
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground max-sm:text-xs">尚未發放</span>
                )
              ) : !editable ? (
                <span className="text-sm tabular-nums">
                  <span className={`font-semibold ${remaining === 0 ? "text-red-500" : ""}`}>
                    {remaining}
                  </span>
                  <span className="text-xs text-muted-foreground"> / {cap}</span>
                </span>
              ) : (
                <span className="flex flex-col items-end gap-1">
                  {/* 剩餘: 一體式 stepper (− 27/30 ＋) */}
                  <span className="inline-flex items-stretch overflow-hidden rounded-lg border bg-background shadow-xs">
                    <button
                      onClick={() => adjust(member.id, { delta: -1 })}
                      disabled={remaining <= 0}
                      aria-label="剩餘數減一"
                      className={stepBtn}
                    >
                      −
                    </button>
                    <span className="flex items-baseline gap-1 border-x px-2 py-1.5 text-sm tabular-nums">
                      <span className={`font-semibold ${remaining === 0 ? "text-red-500" : ""}`}>
                        {remaining}
                      </span>
                      <span className="text-[11px] text-muted-foreground max-sm:text-xs">/ {cap}</span>
                    </span>
                    <button
                      onClick={() => adjust(member.id, { delta: 1 })}
                      disabled={remaining >= (cap ?? TICKETS_MAX)}
                      aria-label="剩餘數加一"
                      className={stepBtn}
                    >
                      ＋
                    </button>
                  </span>
                  {/* 上限 (分母) 微調 — 模擬用: 中途加入 / 未使用完畢 */}
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground max-sm:text-xs">
                    上限
                    <button
                      onClick={() => adjust(member.id, { capDelta: -1 })}
                      disabled={(cap ?? 0) <= 0}
                      aria-label="上限減一"
                      className={capBtn}
                    >
                      −
                    </button>
                    <button
                      onClick={() => adjust(member.id, { capDelta: 1 })}
                      disabled={(cap ?? 0) >= 99}
                      aria-label="上限加一"
                      className={capBtn}
                    >
                      ＋
                    </button>
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {viewer.isAdmin && issued < rows.length ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 w-full text-xs"
          onClick={issueAll}
        >
          全員發放挑戰券 (30/30)
        </Button>
      ) : null}
    </div>
  );
}

// ── 對戰紀錄 (新增 → 自動扣除挑戰券; 刪除 → 退回) ──

function BattleLogsCard({
  gymId,
  battleId,
  viewer,
  members,
  stages,
  logs,
  onChanged,
}: {
  gymId: string;
  battleId: string;
  viewer: GymViewer;
  members: MemberCardData[];
  stages: StageRow[];
  logs: BattleLogRow[];
  onChanged: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [memberSel, setMemberSel] = useState(viewer.memberId ?? "");
  const [stageSel, setStageSel] = useState("none");
  const [roundSel, setRoundSel] = useState<string>("none");
  const [role, setRole] = useState<BattleLogRole>("main");
  const [ticketsUsed, setTicketsUsed] = useState("3");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const canReport = viewer.isAdmin || viewer.memberId !== null;
  const stageOf = (id: string | null) => stages.find((x) => x.id === id);

  async function submit() {
    const memberId = viewer.isAdmin ? memberSel : viewer.memberId;
    if (!memberId) {
      toast.error("請先選擇成員");
      return;
    }
    const used = Number(ticketsUsed);
    setSaving(true);
    try {
      // 與看板輪次列同一條路 (reportBattleLog): 插 log + 自動扣除挑戰券
      const res = await reportBattleLog(supabase, {
        gymId,
        battleId,
        memberId,
        stageId: stageSel === "none" ? null : stageSel,
        round: roundSel === "none" ? null : Number(roundSel),
        role,
        ticketsUsed: used,
      });
      if (!res.ok) {
        toast.error("新增紀錄失敗", { description: res.error });
        return;
      }
      if (res.deductWarning) {
        toast.warning("已新增紀錄, 但挑戰券扣除失敗 (請手動調整)", {
          description: res.deductWarning,
        });
      } else {
        toast.success(used > 0 ? `已新增紀錄, 扣除 ${used} 張挑戰券` : "已新增紀錄");
      }
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(log: BattleLogRow) {
    const { error } = await supabase.from("battle_logs").delete().eq("id", log.id);
    if (error) {
      toast.error("刪除紀錄失敗", { description: error.message });
      return;
    }
    if (log.tickets_used > 0) {
      const { error: adjErr } = await supabase.rpc("adjust_member_ticket", {
        p_gym: gymId,
        p_battle: battleId,
        p_member: log.member_id,
        p_delta: log.tickets_used,
      });
      if (adjErr) {
        toast.warning("已刪除紀錄, 但挑戰券退回失敗 (請手動調整)", { description: adjErr.message });
      } else {
        toast.success(`已刪除紀錄, 退回 ${log.tickets_used} 張挑戰券`);
      }
    } else {
      toast.success("已刪除紀錄");
    }
    await onChanged();
  }

  const shown = showAll ? logs : logs.slice(0, 15);

  // 側板內容 — 外框/標題由 Sheet 提供
  return (
    <div className="space-y-3">
        {canReport ? (
          /* 手機: 兩欄格線 (原本 5 個固定寬下拉在 390px 會擠成四排歪的); 桌機維持單列 */
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:flex sm:flex-wrap sm:items-center">
            {viewer.isAdmin ? (
              <Select value={memberSel} onValueChange={setMemberSel}>
                <SelectTrigger
                  size="sm"
                  className="col-span-2 w-full sm:w-[130px]"
                >
                  <SelectValue placeholder="成員" />
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
            ) : (
              (() => {
                const me = memberById.get(viewer.memberId ?? "");
                return (
                  <span className="col-span-2 flex items-center gap-1.5 text-sm font-medium">
                    {me ? <MemberAvatar member={me} size="sm" className="h-6 w-6" /> : null}
                    {me ? memberLabel(me) : "我"}
                  </span>
                );
              })()
            )}
            <Select value={stageSel} onValueChange={setStageSel}>
              <SelectTrigger size="sm" className="w-full sm:w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不指定關卡</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-1.5">
                      <TypeIcon type={s.weak_type} className="h-4 w-4" />
                      {TYPE_LABELS[s.weak_type]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={roundSel} onValueChange={setRoundSel}>
              <SelectTrigger
                size="sm"
                className="h-8 w-full sm:w-[88px]"
              >
                <SelectValue placeholder="輪次" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">輪次 —</SelectItem>
                {Array.from({ length: 18 }, (_, i) => i + 1).map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {roundLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={(v) => setRole(v as BattleLogRole)}>
              <SelectTrigger size="sm" className="w-full sm:w-[88px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BATTLE_ROLE_LABELS) as BattleLogRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {BATTLE_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ticketsUsed} onValueChange={setTicketsUsed}>
              <SelectTrigger size="sm" className="w-full sm:w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} 張
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="col-span-2 sm:col-span-1"
              onClick={submit}
              disabled={saving}
            >
              新增紀錄
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">加入道館並綁定成員後才能新增紀錄。</p>
        )}

        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無對戰紀錄。</p>
        ) : (
          <div className="space-y-1">
            {/* 表格呈現 — 欄位對齊比一行到底好讀; 窄螢幕在自己的容器內橫向捲動 */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-2.5 py-2 font-medium">時間</th>
                    <th className="px-2.5 py-2 font-medium">成員</th>
                    <th className="px-2.5 py-2 font-medium">關卡</th>
                    <th className="px-2.5 py-2 font-medium">輪次</th>
                    <th className="px-2.5 py-2 font-medium">角色</th>
                    <th className="whitespace-nowrap px-2.5 py-2 text-right font-medium">挑戰券</th>
                    <th className="w-10 px-1 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((log) => {
                    const canDelete = viewer.isAdmin || log.member_id === viewer.memberId;
                    const m = memberById.get(log.member_id);
                    const stage = stageOf(log.stage_id);
                    const rLabel = log.round !== null ? roundLabel(log.round) : null;
                    const when = new Date(log.created_at).toLocaleString("zh-TW", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <tr
                        key={log.id}
                        className="border-b transition-colors last:border-0 hover:bg-accent/40"
                      >
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-[11px] tabular-nums text-muted-foreground max-sm:text-xs">
                          {when}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5">
                            {m ? <MemberAvatar member={m} size="sm" className="h-6 w-6" /> : null}
                            <span className="max-w-[10rem] truncate font-medium">
                              {m ? memberLabel(m) : "?"}
                            </span>
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          {stage ? (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <TypeIcon type={stage.weak_type} className="h-4 w-4" />
                              {TYPE_LABELS[stage.weak_type]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 tabular-nums">
                          {rLabel ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <Badge
                            variant="secondary"
                            className={
                              log.role === "debuff"
                                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                : undefined
                            }
                          >
                            {BATTLE_ROLE_LABELS[log.role]}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{log.tickets_used}</td>
                        <td className="px-1 py-1 text-right">
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 pointer-coarse:h-10 pointer-coarse:w-10 text-muted-foreground"
                              onClick={() => void remove(log)}
                              title="刪除紀錄 (退回挑戰券)"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {logs.length > 15 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "收合" : `顯示全部 ${logs.length} 筆`}
              </Button>
            ) : null}
          </div>
        )}

    </div>
  );
}
