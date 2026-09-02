// 自動排刀 — 規則 (與實際協調方式一致, 對齊道館賽輪次機制):
//   R1-3 (一般對戰): 出刀固定 3 券, 每關 1 人打過
//   Ex 輪 (第 4 輪起):
//     0. 每輪有「輪次規則」: 物攻無效/特攻無效 → 對應標籤的隊伍該輪不用
//     1. 關卡有綁隊伍 → 按隊伍需求媒合 (全達標最優, 部分按比例);
//        沒綁隊伍 → 按該關屬性的道館拍組 × 成員持有寶數排; 每人預設 2 券
// 純函式, 不碰 DB — 配 vitest 測試。
//
// 註: 原本第一階段會依 member_debuffs 的降抗數值排「降抗先手 (1 券鋪場)」。那份數值是
// 匯入的舊試算表, 遊戲裡沒有對應, 已整塊移除 — 降抗要重做 (見 docs/rebuff-notes.md)。
//
// 分配:
//   - 券數以「實際成本」記帳 (每人 mainTickets 券); 不足不派
//   - 低於 minScore 不硬塞 (寧缺勿濫)
//   - 既有派遣 (手動/已完成) 透過 existing 傳入: 不重複派、計入負載
//   - 「可派人數最少的關卡優先」貪婪分配

import type { SyncPairType } from "@/lib/supabase/types";
import { GRADE_LABELS, GRADE_MAX } from "./types";
import { TYPE_LABELS } from "@/data/sync-pairs";

export type TeamRequirement = {
  name: string;
  pairs: { pairId: string; label: string; minGrade: number }[];
  /** 隊伍分類 (debuff/physical/special/closer) — 輪次規則過濾用 */
  tag?: string | null;
};

export type StageInput = {
  stageId: string;
  seq: number;
  weakType: SyncPairType;
  /** 本關綁定的挑戰隊伍 (可多套); 有隊伍時媒合以隊伍為準 */
  teams?: TeamRequirement[];
};

export type GymPairEntry = {
  pairId: string;
  label: string;
};

export type MemberInput = {
  memberId: string;
  name: string;
  /** 剩餘挑戰券; null = 未建立券數紀錄, 視為可派 */
  tickets: number | null;
  /** pairId → grade (1..6, 6=超覺醒) — 全部持有 */
  pairGrades: Record<string, number>;
};

/** 該輪的特殊規則 (道館賽 Ex 輪三種特規輪替; Ex4 起雙規則+非弱點無效) */
export type RoundRule = {
  /** 無效的攻擊類別 → 對應 tag 的隊伍該輪不採用 */
  blocked?: "physical" | "special" | null;
  /** 自由備註 (需狀態異常/量表-2/血量倍率等, 只顯示不參與計算) */
  note?: string | null;
};

export type AssignmentSuggestion = {
  stageId: string;
  memberId: string;
  score: number;
  reason: string;
  suggestedPairIds: string[];
  plannedTickets: number;
};

export type AutoAssignOptions = {
  stages: StageInput[];
  members: MemberInput[];
  /** 屬性 → 道館拍組名單 (無隊伍關卡的排刀依據) */
  gymPairsByType: Partial<Record<SyncPairType, GymPairEntry[]>>;
  /** 該輪規則 (排刀是逐輪跑的) */
  rule?: RoundRule | null;
  /** 排的是第幾輪 (1-3 = 一般對戰固定 3 券一人清關; 4+ = Ex 輪) */
  round?: number;
  /** 每關派幾個人 */
  perStage?: number;
  maxPerMember?: number;
  /** 低於此分不派 (預設 5) */
  minScore?: number;
  existing?: { stageId: string; memberId: string; role?: string | null }[];
  /** 每人預計券數 (預設 2; 要 3 券強攻再調) */
  mainTickets?: number;
  /** 排法: fit = 最佳解 (符合度優先); tickets = 票數 (剩券多的先上, 符合度同分排序) */
  mode?: "fit" | "tickets";
};

type Fitness = {
  score: number;
  reason: string;
  suggestedPairIds: string[];
};

/** 依輪次規則過濾隊伍 (物攻無效 → 跳過 physical 隊; 特攻無效 → 跳過 special 隊) */
export function filterTeamsByRule(
  teams: TeamRequirement[] | undefined,
  rule?: RoundRule | null
): TeamRequirement[] | undefined {
  if (!teams || !rule?.blocked) return teams;
  const filtered = teams.filter((t) => t.tag !== rule.blocked);
  return filtered;
}

/** 單一成員對單一關卡的適配分 (exported 供 UI 顯示「為什麼是這些人」) */
export function fitness(
  member: MemberInput,
  stage: StageInput,
  gymPairsByType: Partial<Record<SyncPairType, GymPairEntry[]>>
): Fitness {
  const typeLabel = TYPE_LABELS[stage.weakType];

  // 1. 有隊伍: 各隊算符合度取最高 — 全達標 100, 部分依 (達標數 + 寶數進度) 比例
  if (stage.teams && stage.teams.length > 0) {
    let best: { team: TeamRequirement; score: number; met: number; ownedIds: string[] } | null =
      null;
    for (const team of stage.teams) {
      if (team.pairs.length === 0) continue;
      let met = 0;
      let progress = 0; // 0..1 per pair
      const ownedIds: string[] = [];
      for (const req of team.pairs) {
        const grade = member.pairGrades[req.pairId] ?? 0;
        if (grade > 0) ownedIds.push(req.pairId);
        if (grade >= req.minGrade) {
          met++;
          progress += 1;
        } else {
          progress += Math.min(grade / Math.max(1, req.minGrade), 0.99);
        }
      }
      const full = met === team.pairs.length;
      const score = full ? 100 : (progress / team.pairs.length) * 80;
      if (!best || score > best.score) best = { team, score, met, ownedIds };
    }
    if (!best) return { score: 0, reason: "本關隊伍未設定拍組", suggestedPairIds: [] };
    const full = best.met === best.team.pairs.length;
    return {
      score: Math.round(best.score * 10) / 10,
      reason: full
        ? `隊伍「${best.team.name}」全符合`
        : `隊伍「${best.team.name}」${best.met}/${best.team.pairs.length} 符合`,
      suggestedPairIds: best.team.pairs.map((p) => p.pairId),
    };
  }

  // 2. 無隊伍: 該屬性道館拍組 × 持有寶數 (取最強 3 隻平均)
  const entries = gymPairsByType[stage.weakType] ?? [];
  const owned = entries
    .map((e) => ({ ...e, grade: member.pairGrades[e.pairId] ?? 0 }))
    .filter((e) => e.grade > 0)
    .sort((a, b) => b.grade - a.grade);
  if (owned.length === 0) {
    return { score: 0, reason: `無${typeLabel}道館拍組`, suggestedPairIds: [] };
  }
  const top = owned.slice(0, 3);
  const score = (top.reduce((s, e) => s + e.grade / GRADE_MAX, 0) / 3) * 100;
  return {
    score: Math.round(score * 10) / 10,
    reason: `${typeLabel}道館拍組 ${top
      .map((e) => `${e.label} ${GRADE_LABELS[e.grade]}`)
      .join("、")}`,
    suggestedPairIds: top.map((e) => e.pairId),
  };
}

export function autoAssign(opts: AutoAssignOptions): AssignmentSuggestion[] {
  const { members, gymPairsByType } = opts;
  const perStage = opts.perStage ?? 3;
  const minScore = opts.minScore ?? 5;
  const mainTickets = Math.max(1, opts.mainTickets ?? 2);
  const mode = opts.mode ?? "fit";
  const existing = opts.existing ?? [];
  const ticketsOf = (m: MemberInput) => (m.tickets === null ? Number.POSITIVE_INFINITY : m.tickets);
  /** 排序: fit = 符合度 → 券數; tickets = 券數 → 符合度 (同分穩定用名字) */
  const rankPair = (a: { m: MemberInput; f: Fitness }, b: { m: MemberInput; f: Fitness }) =>
    mode === "tickets"
      ? ticketsOf(b.m) - ticketsOf(a.m) ||
        b.f.score - a.f.score ||
        a.m.name.localeCompare(b.m.name, "zh-Hant")
      : b.f.score - a.f.score ||
        ticketsOf(b.m) - ticketsOf(a.m) ||
        a.m.name.localeCompare(b.m.name, "zh-Hant");

  // 輪次規則: 過濾各關可用隊伍 (物攻無效 → physical 隊不用)
  const stages: StageInput[] = opts.stages.map((s) => ({
    ...s,
    teams: filterTeamsByRule(s.teams, opts.rule),
  }));

  const eligible = members.filter((m) => m.tickets === null || m.tickets > 0);
  if (eligible.length === 0 || stages.length === 0) return [];

  const maxPerMember =
    opts.maxPerMember ?? Math.max(1, Math.ceil((stages.length * perStage) / eligible.length));

  // 券數帳 (null = 無上限); 依實際成本扣
  const ticketsLeft = new Map<string, number>(
    eligible.map((m) => [m.memberId, m.tickets === null ? Number.POSITIVE_INFINITY : m.tickets])
  );
  const taken = new Set(existing.map((e) => `${e.stageId}:${e.memberId}`));
  const load = new Map<string, number>();
  // 已經有人被排在這一關 (不分角色 — 舊資料可能有 role=debuff 的列)
  const existingPerStage = new Map<string, number>();
  for (const e of existing) {
    load.set(e.memberId, (load.get(e.memberId) ?? 0) + 1);
    existingPerStage.set(e.stageId, (existingPerStage.get(e.stageId) ?? 0) + 1);
  }

  const fit = new Map<string, Fitness>();
  for (const stage of stages) {
    for (const m of eligible) {
      fit.set(`${stage.stageId}:${m.memberId}`, fitness(m, stage, gymPairsByType));
    }
  }

  // 稀缺關卡優先 (高適配 >=60 人數少的先分)
  const scarcity = (stage: StageInput) =>
    eligible.filter((m) => (fit.get(`${stage.stageId}:${m.memberId}`)?.score ?? 0) >= 60).length;
  const ordered = [...stages].sort((a, b) => scarcity(a) - scarcity(b) || a.seq - b.seq);

  const out: AssignmentSuggestion[] = [];
  const canTake = (memberId: string, cost: number) =>
    (load.get(memberId) ?? 0) < maxPerMember && (ticketsLeft.get(memberId) ?? 0) >= cost;
  const book = (stageId: string, memberId: string, cost: number) => {
    load.set(memberId, (load.get(memberId) ?? 0) + 1);
    ticketsLeft.set(memberId, (ticketsLeft.get(memberId) ?? 0) - cost);
    taken.add(`${stageId}:${memberId}`);
  };
  const seqOf = new Map(stages.map((s) => [s.stageId, s.seq]));

  // ── R1-3: 固定 3 券, 每關 1 人打過 ──
  if ((opts.round ?? 4) <= 3) {
    for (const stage of ordered) {
      if ((existingPerStage.get(stage.stageId) ?? 0) > 0) continue; // 已有人接
      const ranked = eligible
        .map((m) => ({ m, f: fit.get(`${stage.stageId}:${m.memberId}`)! }))
        .sort(rankPair);
      for (const { m, f } of ranked) {
        if (f.score < minScore) continue;
        if (taken.has(`${stage.stageId}:${m.memberId}`)) continue;
        if (!canTake(m.memberId, 3)) continue;
        out.push({
          stageId: stage.stageId,
          memberId: m.memberId,
          score: f.score,
          reason: f.reason,
          suggestedPairIds: f.suggestedPairIds,
          plannedTickets: 3,
        });
        book(stage.stageId, m.memberId, 3);
        break;
      }
    }
    return out.sort((a, b) => (seqOf.get(a.stageId) ?? 0) - (seqOf.get(b.stageId) ?? 0));
  }

  // ── Ex 輪: 依隊伍/道館拍組適配排人, 每人 mainTickets 券 ──
  for (const stage of ordered) {
    const ranked = eligible
      .map((m) => ({ m, f: fit.get(`${stage.stageId}:${m.memberId}`)! }))
      .sort(rankPair);

    let picked = existingPerStage.get(stage.stageId) ?? 0;
    for (const { m, f } of ranked) {
      if (picked >= perStage) break;
      if (f.score < minScore) break;
      if (taken.has(`${stage.stageId}:${m.memberId}`)) continue;
      if (!canTake(m.memberId, mainTickets)) continue;
      out.push({
        stageId: stage.stageId,
        memberId: m.memberId,
        score: f.score,
        reason: f.reason,
        suggestedPairIds: f.suggestedPairIds,
        plannedTickets: mainTickets,
      });
      book(stage.stageId, m.memberId, mainTickets);
      picked++;
    }
  }

  return out.sort(
    (a, b) => (seqOf.get(a.stageId) ?? 0) - (seqOf.get(b.stageId) ?? 0) || b.score - a.score
  );
}
