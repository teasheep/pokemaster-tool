import type { SupabaseClient } from "@supabase/supabase-js";

import type { BattleLogRole, Database } from "@/lib/supabase/types";

/**
 * 新增對戰紀錄的唯一路徑 — 對戰紀錄側板與看板輪次列的「+ / 出刀」都走這裡:
 * 插 battle_logs + 用券自動扣 (adjust_member_ticket 原子 RPC)。
 * 輪次標籤一律由 round 派生 (roundLabel), 不再落地 (round_label 已 drop, 0047)。
 * 回傳結構化結果, toast 文案由呼叫端決定 (兩邊語境不同)。
 */
export async function reportBattleLog(
  supabase: SupabaseClient<Database>,
  args: {
    gymId: string;
    battleId: string;
    memberId: string;
    stageId?: string | null;
    round?: number | null;
    role: BattleLogRole;
    ticketsUsed: number;
  }
): Promise<{ ok: boolean; error?: string; deductWarning?: string }> {
  const { error } = await supabase.from("battle_logs").insert({
    gym_id: args.gymId,
    battle_id: args.battleId,
    member_id: args.memberId,
    stage_id: args.stageId ?? null,
    round: args.round ?? null,
    role: args.role,
    tickets_used: args.ticketsUsed,
  });
  if (error) return { ok: false, error: error.message };

  if (args.ticketsUsed > 0) {
    const { error: adjErr } = await supabase.rpc("adjust_member_ticket", {
      p_gym: args.gymId,
      p_battle: args.battleId,
      p_member: args.memberId,
      p_delta: -args.ticketsUsed,
    });
    if (adjErr) return { ok: true, deductWarning: adjErr.message };
  }
  return { ok: true };
}
