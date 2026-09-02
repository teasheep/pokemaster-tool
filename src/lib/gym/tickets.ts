// 挑戰券的純統計 — member_tickets 是看板的即時來源 (回報自動扣、刪除退回)。
// (「帳面應剩」ticketEntitlement 與分數統計 scoreSummary 已移除:
//  券制改為 30/30 從上限往下扣 (0043); 分數 2026-08-18 起不再記錄 (0048)。)

export type BattleLogLite = {
  member_id: string;
  tickets_used: number;
};

/** 每位成員已花張數 */
export function spentByMember(logs: BattleLogLite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of logs) out[l.member_id] = (out[l.member_id] ?? 0) + l.tickets_used;
  return out;
}
