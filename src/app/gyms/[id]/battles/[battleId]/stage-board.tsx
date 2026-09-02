"use client";

// 道館看板 — 每關一張卡片 (關卡沒有順序概念, 一律以屬性稱呼):
//   標題列: 屬性 (管理員可改) / 本輪進度
//   隊伍: 從隊伍庫綁多套 (降抗/物攻/特攻/磨隊), 每套各自列三色符合度 (純檢視)
//   輪次: R1-R3 + Ex 輪縱向列出, 每輪行內出刀 (選角色+券數, 同對戰紀錄) 與敘述

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Layers, Plus, Swords, X } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberAvatar, MemberOption, memberLabel } from "@/components/gym/member-card";
import type { MemberCardData } from "@/components/gym/member-card";
import { useCatalogWithFullFallback } from "@/components/gym/pair-picker";
import { candyForRole, type CandyCounts, type CandyType } from "@/components/gym/candy";
import {
  TAG_STYLES,
  TEAM_TAGS,
  TeamFitRows,
  TeamPairs,
  TeamSheet,
  type TeamFitGroups,
  type TeamPairRow,
  type TeamRow,
} from "@/components/gym/team-sheet";
import { BATTLE_ROLE_LABELS, GRADE_LABELS, TEAM_TAG_LABELS, roundLabel } from "@/lib/gym/types";
import { reportBattleLog } from "@/lib/gym/battle-log";
import { pairName } from "@/lib/pairs/name";
import { cn } from "@/lib/utils";
import { TypeIcon } from "@/components/sync-pair-badges";
import { ALL_TYPES, TYPE_COLORS, TYPE_LABELS, roleAssetToRole } from "@/data/sync-pairs";
import { createClient } from "@/lib/supabase/client";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { BattleLogRole, Database, SyncPairType } from "@/lib/supabase/types";

// 看板/紀錄只讀這些欄位 — page.tsx 與 battle-client 的 select 明列同一組
// (battle_logs 一場 290 列, '*' 會白送 gym_id/battle_id/updated_at = 40KB)。
export type StageRow = Pick<
  Database["public"]["Tables"]["battle_stages"]["Row"],
  "id" | "weak_type"
>;
export type BattleLogRow = Pick<
  Database["public"]["Tables"]["battle_logs"]["Row"],
  "id" | "member_id" | "stage_id" | "role" | "tickets_used" | "round" | "created_at"
>;

export type StageBoardProps = {
  gymId: string;
  battleId: string;
  isAdmin: boolean;
  /** 顧問 = 唯讀觀察者: 看得到全部但不能新增對戰紀錄 */
  canEdit?: boolean;
  myMemberId: string | null;
  round: number;
  stages: StageRow[];
  logs: BattleLogRow[];
  members: MemberCardData[];
  /** memberId → pairId → grade (1-6); 供隊伍媒合 */
  memberGrades: Record<string, Record<string, number>>;
  /** memberId → 糖果庫存; 媒合時計算「吃糖可達」 */
  memberCandies: Record<string, CandyCounts>;
  /** 圖鑑子集 (道館名單 ∪ 已在隊伍裡) — 整本由 fullCatalogUrl 按需抓 */
  catalog: ClientPairRecord[];
  /** 「全圖鑑」按需載入的網址 (`/api/catalog?v=<指紋>`) — 往下傳給選隊側板 */
  fullCatalogUrl?: string;
  teams: TeamRow[];
  teamPairs: TeamPairRow[];
  stageTeams: StageTeamRow[];
  /** 每關每輪的敘述 (stage_round_notes) — 管理員可編 */
  roundNotes: { stage_id: string; round: number; note: string }[];
  /** 道館拍組名單 — 隊伍編輯候選池 */
  gymPairsList?: { pairId: string; type: SyncPairType }[];
  onChanged: () => Promise<void>;
};

export type StageTeamRow = Pick<
  Database["public"]["Tables"]["stage_teams"]["Row"],
  "stage_id" | "team_id"
>;


export function StageBoard(props: StageBoardProps) {
  const { stages, logs, round, myMemberId } = props;

  /**
   * 本輪每關的進度 (已用券 / 我出過沒) — 手機的關卡摘要列用。
   * 手機一欄排 8 關要捲很久, 「我在哪一關、這輪還缺哪關」必須先一眼看完再決定往哪捲。
   */
  const perStage = useMemo(() => {
    const map = new Map<string, { used: number; mine: boolean }>();
    for (const s of stages) map.set(s.id, { used: 0, mine: false });
    for (const l of logs) {
      if (!l.stage_id || (l.round ?? 0) !== round) continue;
      const cur = map.get(l.stage_id);
      if (!cur) continue;
      cur.used += l.tickets_used;
      if (myMemberId && l.member_id === myMemberId) cur.mine = true;
    }
    return map;
  }, [stages, logs, round, myMemberId]);

  return (
    <div className="space-y-3">
      {/* 關卡摘要列 (只在手機) — 純導覽: 點一下捲到那一關, 不改關卡的資料或職責 */}
      {stages.length > 0 ? (
        <div className="sm:hidden">
          <p className="mb-1 text-xs text-muted-foreground">
            本輪 {roundLabel(round)} — 點屬性跳到該關 (✓ = 我出過)
          </p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {stages.map((s) => {
              const info = perStage.get(s.id) ?? { used: 0, mine: false };
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(`stage-${s.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs transition-transform active:scale-95",
                    info.used > 0
                      ? "bg-background"
                      : "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                  )}
                >
                  <TypeIcon type={s.weak_type} className="h-4 w-4" />
                  <span className="font-medium">{TYPE_LABELS[s.weak_type]}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {info.used > 0 ? `${info.used} 張` : "尚無"}
                  </span>
                  {info.mine ? (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">✓</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {stages.map((s) => (
          <StageCard key={s.id} stage={s} {...props} />
        ))}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  gymId,
  battleId,
  isAdmin,
  canEdit = true,
  myMemberId,
  round,
  logs,
  members,
  memberGrades,
  memberCandies,
  catalog: catalogSubset,
  fullCatalogUrl,
  teams,
  teamPairs,
  stageTeams,
  roundNotes,
  gymPairsList,
  onChanged,
}: StageBoardProps & { stage: StageRow }) {
  const supabase = useMemo(() => createClient(), []);
  // 側板勾過「全圖鑑」之後, 名單外的拍組也要畫得出來 (否則隊伍卡掉成灰字 pair_id)。
  // needed: 別人在這個分頁開著的時候把名單外的拍組加進某隊 → refetch 後自動補抓一次整本
  const neededPairIds = useMemo(() => teamPairs.map((p) => p.pair_id), [teamPairs]);
  const catalog = useCatalogWithFullFallback(catalogSubset, {
    ids: neededPairIds,
    fullCatalogUrl,
  });
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  /** 手機把「挑戰隊伍」整區收起來 (桌機忽略此狀態, 一律展開) */
  const [teamsOpen, setTeamsOpen] = useState(false);
  /**
   * 輪次列展開中的出刀選單 (一次只有一個):
   * self = 自己出刀 (選角色 + 券數); admin 加開成員選擇, 效果同「新增對戰紀錄」
   */
  const [addFor, setAddFor] = useState<{ r: number; admin: boolean } | null>(null);
  const [addRole, setAddRole] = useState<BattleLogRole>("main");
  const [addMember, setAddMember] = useState("");
  /** 待確認取消的出戰紀錄 (單擊即刪太危險 — 手機誤觸會直接動到全館共享資料) */
  const [undoTarget, setUndoTarget] = useState<BattleLogRow | null>(null);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  /** 這關的輪次敘述: round → note */
  const stageNotes = useMemo(
    () =>
      new Map(
        roundNotes.filter((n) => n.stage_id === stage.id).map((n) => [n.round, n.note])
      ),
    [roundNotes, stage.id]
  );

  // 本關採用的隊伍 (可多套, 依分類分區)
  const myTeamIds = stageTeams
    .filter((st) => st.stage_id === stage.id)
    .map((st) => st.team_id);
  const stageTeamList = TEAM_TAGS.flatMap((tag) =>
    teams.filter((t) => myTeamIds.includes(t.id) && t.tag === tag)
  );
  const allStageLogs = logs.filter((l) => l.stage_id === stage.id);
  const ticketsUsed = allStageLogs.reduce((s, l) => s + l.tickets_used, 0);

  /**
   * 本輪進度 — 8 張卡並排時要一眼看出「這關本輪打了沒」。
   * 全期累計券混了 R1-3 與各 Ex 輪, 對「現在還要投幾券」沒有資訊量。
   * R1-3 固定 3 券一人打過; Ex 輪沒有預排概念 (排刀已移除), 只顯示已用券。
   */
  const roundProgress = useMemo(() => {
    const used = allStageLogs
      .filter((l) => (l.round ?? 0) === round)
      .reduce((s, l) => s + l.tickets_used, 0);
    const planned = round <= 3 ? 3 : 0;
    const state: "idle" | "doing" | "done" =
      used >= planned && planned > 0 ? "done" : used === 0 ? "idle" : "doing";
    return { used, planned, state };
  }, [allStageLogs, round]);

  /** 要顯示的輪次: R1-R3 固定 + 有紀錄的 Ex 輪 + 目前輪 + 下一輪 (方便往前推) */
  const allRounds = useMemo(() => {
    const set = new Set<number>([1, 2, 3, round, round + 1]);
    for (const l of allStageLogs) if (l.round) set.add(l.round);
    return [...set].filter((r) => r >= 1 && r <= 20).sort((a, b) => a - b);
  }, [allStageLogs, round]);

  /**
   * 預設只展開「目前輪/下一輪」— 推到 Ex10 時一關會有 13+ 行,
   * 早就打完的 R1 跟今天要推的輪一樣搶眼, 卡片長到一屏放不下 (且舊輪的出刀鈕還會誤觸)。
   */
  const [showAllRounds, setShowAllRounds] = useState(false);
  const visibleRounds = showAllRounds ? allRounds : allRounds.filter((r) => r >= round);
  const hiddenRounds = allRounds.length - visibleRounds.length;
  const hiddenTickets = allRounds
    .filter((r) => !visibleRounds.includes(r))
    .reduce(
      (s, r) =>
        s + allStageLogs.filter((l) => (l.round ?? 0) === r).reduce((x, l) => x + l.tickets_used, 0),
      0
    );

  /**
   * 每套隊伍各自媒合, 分兩級:
   *   direct    — 全部達標
   *   withCandy — 缺口可用糖補足 (遊戲規則, 見 Bulbapedia Superawakening):
   *     寶數缺口: 該拍組「角色」的角色糖優先, 不夠用通用糖 (黃糖)
   *     超覺醒缺口: 專屬超覺糖可用 棒棒糖 / 通用糖 / 該拍組角色糖 任一兌換 —
   *       分配順序 棒棒糖 → 角色糖 → 通用糖
   *     (要求超覺醒但寶未滿: 先補寶到 5 再補缺的覺醒級數, 兩段都算)
   */
  const teamCandidates = useMemo(() => {
    const roleOf = new Map(catalog.map((p) => [p.pairId, roleAssetToRole(p.roleAsset)]));
    const map = new Map<
      string,
      {
        direct: { member: MemberCardData; grades: number[] }[];
        withCandy: { member: MemberCardData; cost: number }[];
        /** 三隻都有但寶數不夠 (糖也補不到) — 催練/調度參考 */
        nearMiss: { member: MemberCardData; grades: number[] }[];
      }
    >();
    // 算「全部」隊伍 (不只本關已綁的) — 選隊側板也要看每套隊伍有幾人可打
    for (const t of teams) {
      const req = teamPairs
        .filter((p) => p.team_id === t.id)
        .sort((a, b) => a.slot - b.slot);
      if (req.length === 0) continue;
      const direct: { member: MemberCardData; grades: number[] }[] = [];
      const withCandy: { member: MemberCardData; cost: number }[] = [];
      const nearMiss: { member: MemberCardData; grades: number[] }[] = [];
      for (const m of members) {
        const g = memberGrades[m.id] ?? {};
        const grades = req.map((pp) => g[pp.pair_id] ?? 0);
        if (req.every((pp, i) => grades[i] >= pp.min_grade)) {
          direct.push({ member: m, grades });
          continue;
        }
        // 缺口統計: 寶數與超覺醒都按拍組角色歸類 (角色糖兩者皆可用)
        const candies = memberCandies[m.id] ?? {};
        const needByRole: Partial<Record<CandyType, number>> = {};
        const awakeningByRole: Partial<Record<CandyType | "none", number>> = {};
        let awakeningTotal = 0;
        for (const [i, pp] of req.entries()) {
          const grade = grades[i];
          if (grade >= pp.min_grade) continue;
          // 複合角色 (multi) 沒有專屬糖 → 一律歸通用糖
          const candyRole = candyForRole(roleOf.get(pp.pair_id) ?? null);
          const roleKey = (candyRole ?? "none") as CandyType | "none";
          if (pp.min_grade >= 6) {
            // 0038 起 6-10 = 超覺醒1-5: 先補寶到 5, 再補缺的覺醒級數 (一級一顆)
            const potentialGap = Math.max(0, 5 - Math.min(grade, 5));
            if (potentialGap > 0) {
              const k = candyRole ?? "universal";
              needByRole[k] = (needByRole[k] ?? 0) + potentialGap;
            }
            const awakenGap = pp.min_grade - Math.max(grade, 5);
            awakeningByRole[roleKey] = (awakeningByRole[roleKey] ?? 0) + awakenGap;
            awakeningTotal += awakenGap;
          } else {
            const gap = pp.min_grade - grade;
            const k = candyRole ?? "universal";
            needByRole[k] = (needByRole[k] ?? 0) + gap;
          }
        }
        // 分配順序: 覺醒缺口先吃棒棒糖 (跨角色通用), 剩的併入該角色的糖需求;
        // 再逐角色吃角色糖, 最後缺額全部由通用糖吸收
        let lollipopLeft = candies.superawakening ?? 0;
        const useLollipop = Math.min(lollipopLeft, awakeningTotal);
        lollipopLeft -= useLollipop;
        let remainingAwaken = awakeningTotal - useLollipop;
        for (const [roleKey, cnt] of Object.entries(awakeningByRole)) {
          if (remainingAwaken <= 0) break;
          const take = Math.min(cnt, remainingAwaken);
          remainingAwaken -= take;
          const k = roleKey === "none" ? "universal" : (roleKey as CandyType);
          needByRole[k] = (needByRole[k] ?? 0) + take;
        }
        let universalNeed = needByRole.universal ?? 0;
        let cost = universalNeed;
        for (const [roleType, need] of Object.entries(needByRole)) {
          if (roleType === "universal") continue;
          const have = candies[roleType as CandyType] ?? 0;
          const useTyped = Math.min(have, need);
          universalNeed += need - useTyped;
          cost += need;
        }
        cost += useLollipop;
        if (cost > 0 && universalNeed <= (candies.universal ?? 0)) {
          withCandy.push({ member: m, cost });
        } else if (grades.every((x) => x > 0)) {
          // 三隻都有, 但寶數 (連吃糖都) 不夠 — 列出來供催練/hover 看差多少
          nearMiss.push({ member: m, grades });
        }
      }
      withCandy.sort((a, b) => a.cost - b.cost);
      nearMiss.sort(
        (a, b) => b.grades.reduce((s, x) => s + x, 0) - a.grades.reduce((s, x) => s + x, 0)
      );
      map.set(t.id, { direct, withCandy, nearMiss });
    }
    return map;
    // stageTeamList 由 stageTeams+teams 推導
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, memberGrades, memberCandies, stageTeams, teams, teamPairs, catalog]);

  /** 三列符合度 (綠/黃/紅) — 看板隊伍列與選隊側板共用 */
  const teamFitGroups = useMemo(() => {
    const candyOf = new Map<string, Map<string, number>>();
    for (const [teamId, c] of teamCandidates) {
      candyOf.set(teamId, new Map(c.withCandy.map((w) => [w.member.id, w.cost])));
    }
    const map = new Map<string, TeamFitGroups>();
    for (const t of teams) {
      const req = teamPairs.filter((p) => p.team_id === t.id).sort((a, b) => a.slot - b.slot);
      if (req.length === 0) continue;
      const g: TeamFitGroups = { green: [], yellow: [], red: [] };
      for (const m of members) {
        if (m.role === "advisor") continue;
        const grades = req.map((pp) => (memberGrades[m.id] ?? {})[pp.pair_id] ?? 0);
        const owned = grades.every((x) => x > 0);
        const meets = owned && req.every((pp, i) => grades[i] >= pp.min_grade);
        if (meets) g.green.push({ m });
        else if (owned) g.yellow.push({ m, candy: candyOf.get(t.id)?.get(m.id) });
        else g.red.push({ m });
      }
      g.yellow.sort((a, b) => (a.candy ?? 99) - (b.candy ?? 99));
      map.set(t.id, g);
    }
    return map;
  }, [teams, teamPairs, members, memberGrades, teamCandidates]);

  /** hover 明細: 這個人對這套隊伍的逐拍組寶數 (「小霞 寶3/需寶5、96皮 超覺醒✓」) */
  const teamGradeTooltip = useMemo(() => {
    const nameOf = new Map(catalog.map((p) => [p.pairId, pairName(p)]));
    return (teamId: string, memberId: string) => {
      const req = teamPairs
        .filter((p) => p.team_id === teamId)
        .sort((a, b) => a.slot - b.slot);
      const g = memberGrades[memberId] ?? {};
      return req
        .map((pp) => {
          const have = g[pp.pair_id] ?? 0;
          const ok = have >= pp.min_grade;
          const haveLabel = have === 0 ? "未持有" : GRADE_LABELS[have];
          return `${nameOf.get(pp.pair_id) ?? pp.pair_id} ${haveLabel}${
            ok ? "✓" : `／需${GRADE_LABELS[pp.min_grade]}`
          }`;
        })
        .join("、");
    };
  }, [teamPairs, memberGrades, catalog]);

  async function setWeakType(type: SyncPairType) {
    const { error } = await supabase
      .from("battle_stages")
      .update({ weak_type: type })
      .eq("id", stage.id);
    if (error) toast.error("更新屬性失敗", { description: error.message });
    else await onChanged();
  }


  /**
   * 新增一筆對戰紀錄 — 與「對戰紀錄」側板同一條路 (reportBattleLog: 插 log + 自動扣券)。
   * 登記自己的與管理員代為登記都走這裡, 差別只在 memberId 是誰。
   */
  async function report(memberId: string, role: BattleLogRole, tickets: number, r: number) {
    if (!memberId) {
      toast.error("你的帳號還沒綁定道館成員", {
        description: "向管理員索取邀請碼, 到道館列表加入",
        action: { label: "去加入", onClick: () => router.push("/gyms?list=1") },
      });
      return;
    }
    setBusy(true);
    try {
      const res = await reportBattleLog(supabase, {
        gymId,
        battleId,
        memberId,
        stageId: stage.id,
        round: r,
        role,
        ticketsUsed: tickets,
      });
      if (!res.ok) {
        toast.error("新增紀錄失敗", { description: res.error });
        return;
      }
      const who =
        memberId === myMemberId
          ? ""
          : `${memberLabel(memberById.get(memberId) ?? { displayName: "成員" })} `;
      if (res.deductWarning) {
        toast.warning("已新增紀錄, 但挑戰券扣除失敗 (請手動調整)", {
          description: res.deductWarning,
        });
      } else {
        toast.success(
          `已新增紀錄: ${TYPE_LABELS[stage.weak_type]}關 ${roundLabel(r)} ${who}${BATTLE_ROLE_LABELS[role]} ${tickets} 張`
        );
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  /** 這關這輪的敘述 — 管理員可編 (空字串 = 刪列, 不留幽靈列) */
  async function saveRoundNote(r: number, raw: string) {
    const v = raw.trim();
    if (v === (stageNotes.get(r) ?? "")) return;
    if (v === "") {
      const { error } = await supabase
        .from("stage_round_notes")
        .delete()
        .eq("stage_id", stage.id)
        .eq("round", r);
      if (error) {
        toast.error("清除敘述失敗", { description: error.message });
        return;
      }
    } else {
      const { error } = await supabase.from("stage_round_notes").upsert(
        { gym_id: gymId, battle_id: battleId, stage_id: stage.id, round: r, note: v },
        { onConflict: "stage_id,round" }
      );
      if (error) {
        toast.error("儲存敘述失敗", { description: error.message });
        return;
      }
    }
    await onChanged();
  }

  async function undoChallenge(log: BattleLogRow) {
    setBusy(true);
    try {
      const { error } = await supabase.from("battle_logs").delete().eq("id", log.id);
      if (error) {
        toast.error("刪除紀錄失敗", { description: error.message });
        return;
      }
      // 退回失敗不能吞: 紀錄已刪但挑戰券沒退 = 帳從此少算, 要當場講
      const { error: adjErr } = await supabase.rpc("adjust_member_ticket", {
        p_gym: gymId,
        p_battle: battleId,
        p_member: log.member_id,
        p_delta: log.tickets_used,
      });
      if (adjErr) {
        toast.warning("已刪除紀錄, 但挑戰券退回失敗 — 請手動調整", {
          description: adjErr.message,
        });
      } else {
        toast.success(`已刪除紀錄, 退回 ${log.tickets_used} 張挑戰券`);
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  /** 加入 / 移除本關的隊伍 (可多套) */
  async function toggleTeam(t: TeamRow, next: boolean) {
    if (next) {
      const { error } = await supabase.from("stage_teams").insert({
        gym_id: gymId,
        battle_id: battleId,
        stage_id: stage.id,
        team_id: t.id,
      });
      if (error) {
        toast.error("加入失敗", { description: error.message });
        return;
      }
      toast.success(`${TYPE_LABELS[stage.weak_type]}關 加入「${t.name}」`);
    } else {
      const { error } = await supabase
        .from("stage_teams")
        .delete()
        .eq("stage_id", stage.id)
        .eq("team_id", t.id);
      if (error) {
        toast.error("移除失敗", { description: error.message });
        return;
      }
    }
    await onChanged();
  }

  return (
    <div
      // 摘要列跳關的錨點; scroll-mt 要蓋過整疊 sticky 的高度, 否則跳過去卡片標題被切掉。
      // 手機: SiteHeader 57 + 道館導覽列兩列 89 (切換器 44 + 分頁 44 + 邊框) = 146 → 取 152 留一點餘裕。
      // 桌機: 56 + 單列 39 = 95 → 96 (sm:scroll-mt-24) 仍然正確, 不要動。
      id={`stage-${stage.id}`}
      className="scroll-mt-[9.5rem] overflow-hidden rounded-xl border transition-shadow hover:shadow-sm sm:scroll-mt-24"
    >
      {/* 標題列 */}
      <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${TYPE_COLORS[stage.weak_type]}`}>
        {/* 關卡沒有順序概念 — 標屬性, 不標第幾關 */}
        <Badge variant="outline" className="gap-1 bg-background/70">
          <TypeIcon type={stage.weak_type} className="h-4 w-4" />
          {TYPE_LABELS[stage.weak_type]}
        </Badge>
        {/* 道館只有屬性, 不另外命名 */}
        {isAdmin ? (
          <Select
            value={stage.weak_type}
            onValueChange={(v) => void setWeakType(v as SyncPairType)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-[110px] bg-background/70"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  弱點 {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm">弱點 {TYPE_LABELS[stage.weak_type]}</span>
        )}
        {/* 本輪進度為主 (缺人一眼看得出), 全期累計退為 tooltip */}
        <span
          title={`本關全期累計使用 ${ticketsUsed} 張挑戰券`}
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
            roundProgress.state === "done"
              ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
              : roundProgress.state === "idle"
                ? "bg-amber-500/25 text-amber-900 dark:text-amber-100"
                : "bg-background/70"
          )}
        >
          {roundLabel(round)}{" "}
          {roundProgress.state === "idle"
            ? "尚無紀錄"
            : roundProgress.planned === 0
              ? `已用 ${roundProgress.used} 張`
              : `已用 ${roundProgress.used}/${roundProgress.planned} 張${
                  roundProgress.state === "done" ? " ✓" : ""
                }`}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {/* 挑戰隊伍 — 一關可多套, 每套各自列出「可打」成員 (排刀就是按隊分配人) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {/*
              手機預設收合這一區 (燈號三列 × 多套隊伍 = 一關就佔掉大半個螢幕,
              真正要操作的輪次列被推到很下面)。桌機一律展開, 內容/職責沒變。
            */}
            {/* 手機是可收合的按鈕, 桌機是純標題 —— 桌機的內容一律展開 (hidden sm:block),
                所以那裡不能留一顆按了沒反應、卻能 Tab 聚焦、aria-expanded 還永遠回報
                false 的假按鈕。用兩個節點各自只在一邊出現, 比在元件裡判斷斷點單純。 */}
            <button
              type="button"
              onClick={() => setTeamsOpen((v) => !v)}
              aria-expanded={teamsOpen}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 sm:hidden"
            >
              挑戰隊伍
              <span>
                {stageTeamList.length > 0 ? `(${stageTeamList.length} 套)` : "(未設定)"}
              </span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", teamsOpen && "rotate-180")}
              />
            </button>
            <span className="hidden items-center text-xs font-medium text-muted-foreground sm:flex">
              挑戰隊伍
            </span>
            <button
              onClick={() => setTeamSheetOpen(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent active:scale-95 pointer-coarse:min-h-11 pointer-coarse:px-3"
            >
              <Layers className="h-3 w-3" />
              {stageTeamList.length > 0 ? "編輯隊伍" : "選隊伍"}
            </button>
          </div>

          <div className={cn(!teamsOpen && "hidden sm:block")}>
          {stageTeamList.length === 0 ? (
            <button
              onClick={() => setTeamSheetOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-3 text-xs text-muted-foreground transition-all hover:border-primary/50 hover:bg-accent/40 hover:text-foreground active:scale-[0.99]"
            >
              <Layers className="h-4 w-4" />
              {isAdmin
                ? "從隊伍庫挑選 (降抗 / 物攻 / 特攻 / 磨隊)"
                : "尚未設定隊伍 — 查看隊伍庫"}
            </button>
          ) : (
            <div className="space-y-2.5">
              {stageTeamList.map((t) => {
                return (
                  <div key={t.id} className="flex gap-2">
                    <span className={cn("w-1 shrink-0 rounded-full", TAG_STYLES[t.tag].bar)} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold max-sm:text-xs",
                            TAG_STYLES[t.tag].chip
                          )}
                        >
                          {TEAM_TAG_LABELS[t.tag]}
                        </span>
                        <span className="text-xs font-medium">{t.name}</span>
                        {t.note ? (
                          <span className="truncate text-[10px] text-muted-foreground max-sm:text-xs">
                            {t.note}
                          </span>
                        ) : null}
                      </div>
                      {/* 拍組在左、可打名單填右側空間 (窄卡自動換行回到下方) */}
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                      <TeamPairs
                        pairs={teamPairs.filter((p) => p.team_id === t.id)}
                        catalog={catalog}
                      />
                      {/* 這個隊伍誰有誰沒有 — 三列 (與選隊側板同一個元件, 純檢視); 券數是另一件事 */}
                      <div className="min-w-[11rem] flex-1 self-stretch py-1">
                        <TeamFitRows
                          groups={teamFitGroups.get(t.id) ?? { green: [], yellow: [], red: [] }}
                          tooltipOf={(memberId) => teamGradeTooltip(t.id, memberId)}
                        />
                      </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>

        {/* 各輪次: 直接看到每輪誰打了幾券, 行內挑戰 (舊輪預設收合) */}
        <div className="space-y-1 border-t pt-2">
          {hiddenRounds > 0 && !showAllRounds ? (
            <button
              onClick={() => setShowAllRounds(true)}
              className="w-full rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 pointer-coarse:min-h-11"
            >
              前 {hiddenRounds} 輪已完成 ✓ 共 {hiddenTickets} 張 — 點開查看
            </button>
          ) : null}
          {showAllRounds && allRounds.length > 3 ? (
            <button
              onClick={() => setShowAllRounds(false)}
              className="w-full rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 pointer-coarse:min-h-11"
            >
              收合已完成的輪次
            </button>
          ) : null}
          {visibleRounds.map((r) => {
            const rLogs = allStageLogs.filter((l) => (l.round ?? 0) === r);
            const rTickets = rLogs.reduce((s, l) => s + l.tickets_used, 0);
            return (
              <div
                key={r}
                className={`flex flex-wrap items-center gap-1.5 rounded-md px-1.5 py-1 text-xs ${
                  r === round ? "bg-accent/50" : ""
                }`}
              >
                <span className="w-10 shrink-0 font-medium tabular-nums">{roundLabel(r)}</span>
                {/* 這關這輪的敘述 (stage_round_notes) — 管理員直接編, 其他人看文字 */}
                {isAdmin ? (
                  <input
                    key={`note-${stage.id}-${r}-${stageNotes.get(r) ?? ""}`}
                    defaultValue={stageNotes.get(r) ?? ""}
                    placeholder="敘述…"
                    maxLength={100}
                    onBlur={(e) => void saveRoundNote(r, e.target.value)}
                    className="h-9 w-24 min-w-0 rounded border border-dashed border-transparent bg-transparent px-1 text-[11px] outline-none transition-all hover:border-input focus:w-44 focus:border-input pointer-coarse:min-h-11 max-sm:text-xs sm:h-6 sm:w-20"
                  />
                ) : stageNotes.get(r) ? (
                  // 全文直接排出來 (手機沒有 hover, 截斷+title 等於讀不到) — 長敘述讓列換行
                  <span className="min-w-0 text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere] max-sm:text-xs">
                    {stageNotes.get(r)}
                  </span>
                ) : null}

                {/* 已出戰成員 (頭像) */}
                <span className="flex flex-wrap items-center gap-1">
                  {rLogs.map((l) => {
                    const m = memberById.get(l.member_id);
                    if (!m) return null;
                    const mine = l.member_id === myMemberId;
                    return (
                      <button
                        key={l.id}
                        onClick={mine || isAdmin ? () => setUndoTarget(l) : undefined}
                        title={`${memberLabel(m)} 使用 ${l.tickets_used} 張挑戰券${
                          mine || isAdmin ? " (點擊刪除此紀錄並退回)" : ""
                        }`}
                        // 頭像維持 24-28px 的密集列尺寸 (AGENTS), 只把命中區在觸控裝置撐到 44px
                        className={`inline-flex items-center gap-0.5 rounded-full border py-1 pl-1 pr-1.5 pointer-coarse:min-h-11 pointer-coarse:px-2 ${
                          mine || isAdmin ? "hover:border-destructive/60 active:scale-95" : ""
                        } ${mine ? "ring-2 ring-primary ring-offset-1" : ""}`}
                      >
                        <MemberAvatar member={m} size="sm" className="h-6 w-6" />
                        <span className="tabular-nums text-[10px] max-sm:text-xs">{l.tickets_used}</span>
                      </button>
                    );
                  })}
                </span>

                <span className="ml-auto flex items-center gap-1.5">
                  {rTickets > 0 ? (
                    <span className="tabular-nums text-muted-foreground">{rTickets} 張</span>
                  ) : null}
                  {addFor?.r === r ? (
                    /* 登記選單 — 效果同「新增對戰紀錄」: (成員) + 角色 + 挑戰券張數 */
                    <span className="flex flex-wrap items-center gap-1">
                      {addFor.admin ? (
                        <Select value={addMember} onValueChange={setAddMember}>
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-[108px] text-[11px] max-sm:text-xs"
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
                      ) : null}
                      {/* 角色: 主力 / 補刀 / 降抗 (登記自己的紀錄也要選) */}
                      <span className="flex overflow-hidden rounded-full border">
                        {(["main", "assist", "debuff"] as const).map((ro) => (
                          <button
                            key={ro}
                            onClick={() => setAddRole(ro)}
                            className={cn(
                              "px-2 py-1.5 transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
                              addRole === ro
                                ? ro === "debuff"
                                  ? "bg-sky-500/20 font-semibold text-sky-700 dark:text-sky-300"
                                  : "bg-primary font-semibold text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent"
                            )}
                          >
                            {BATTLE_ROLE_LABELS[ro]}
                          </button>
                        ))}
                      </span>
                      {/* 挑戰券張數 — 點了就登記 (手機最高頻操作, 觸控目標 ~40px) */}
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          disabled={busy || (addFor.admin && !addMember)}
                          onClick={() => {
                            const target = addFor.admin ? addMember : (myMemberId ?? "");
                            setAddFor(null);
                            void report(target, addRole, n, r);
                          }}
                          title={`使用 ${n} 張挑戰券`}
                          className="min-w-9 rounded-full border bg-background px-2.5 py-1.5 font-medium transition-transform hover:bg-accent active:scale-95 disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        >
                          {n}
                        </button>
                      ))}
                      <button
                        onClick={() => setAddFor(null)}
                        aria-label="取消登記"
                        className="inline-flex items-center justify-center rounded-full p-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  ) : (
                    <>
                      {/* 登記自己的紀錄 (顧問唯讀, 不出現) — 點開選角色與挑戰券張數 */}
                      {myMemberId && canEdit ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setAddRole("main");
                            setAddFor({ r, admin: false });
                          }}
                          title="登記我在本輪的對戰紀錄 — 選角色 (主力/補刀/降抗) 與挑戰券張數"
                          aria-label="登記我在本輪的對戰紀錄"
                          className="inline-flex items-center justify-center rounded-full border p-2 text-muted-foreground transition-all hover:border-primary hover:text-primary active:scale-90 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        >
                          <Swords className="h-4 w-4" />
                        </button>
                      ) : null}
                      {/* 管理員: 為成員新增一筆 (與側板的新增對戰紀錄同一條路徑) */}
                      {isAdmin ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setAddRole("main");
                            setAddMember("");
                            setAddFor({ r, admin: true });
                          }}
                          title="為成員新增本輪的對戰紀錄"
                          aria-label="為成員新增本輪的對戰紀錄"
                          className="inline-flex items-center justify-center rounded-full border border-dashed p-2 text-muted-foreground transition-all hover:border-primary hover:text-primary active:scale-90 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 刪除紀錄確認 — 動的是全館共享紀錄, 手機誤觸不能直接刪 */}
      <AlertDialog open={undoTarget !== null} onOpenChange={(o) => !o && setUndoTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除這筆對戰紀錄?</AlertDialogTitle>
            <AlertDialogDescription>
              {undoTarget &&
                `${memberLabel(memberById.get(undoTarget.member_id) ?? { displayName: "成員" })} 在 ${roundLabel(
                  undoTarget.round ?? 0
                )} 的對戰紀錄會被刪除, 並退回 ${undoTarget.tickets_used} 張挑戰券。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>先不要</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (undoTarget) void undoChallenge(undoTarget);
                setUndoTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              刪除紀錄並退回挑戰券
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 隊伍庫 slideover — teamFit 讓每套隊伍直接顯示「幾人可打」 */}
      <TeamSheet
        open={teamSheetOpen}
        onOpenChange={setTeamSheetOpen}
        gymId={gymId}
        defaultType={stage.weak_type}
        isAdmin={isAdmin}
        teams={teams}
        teamPairs={teamPairs}
        gymPairs={gymPairsList}
        catalog={catalog}
        fullCatalogUrl={fullCatalogUrl}
        onChanged={onChanged}
        appliedTeamIds={myTeamIds}
        onToggle={isAdmin ? toggleTeam : undefined}
        teamFit={teamFitGroups}
      />
    </div>
  );
}
