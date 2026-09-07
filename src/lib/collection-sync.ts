"use client";

// 個人收藏 (user_collection) ↔ 道館持有 (member_pairs) 同步。
//
// 兩份資料的由來: user_collection 是個人的練度紀錄 (我的拍組在編的),
// member_pairs 是道館端的持有表 (排刀媒合/道館拍組頁在讀的, 最初從表單匯入)。
// 成員在網站上點亮/調寶數時必須同步寫回 member_pairs, 否則排刀看到的是舊資料。

import type { SupabaseClient } from "@supabase/supabase-js";
import { pairLabel } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";

export type GymSyncInfo = {
  gymId: string;
  /** 自己的 gym_members.id (未綁定道館時為 null → 不同步) */
  memberId: string | null;
};

/** user_collection 練度 → 道館 grade (0-10): 超覺醒N = 5+N, 其餘=寶數 (0038 起同一條軸) */
export function gradeOf(potential: number, superAwakening: number): number {
  if (superAwakening > 0) return 5 + Math.min(5, superAwakening);
  return Math.max(0, Math.min(5, potential));
}

/**
 * 背景同步一筆到 member_pairs (失敗不打擾使用者, 只留 console)。
 * 注意: unique key 是 (member_id, pair_label), 但表單匯入的 label 可能與
 * pairName 產出略有出入 (別名/全形) — 一律先用 pair_id 找既有列 update,
 * 找不到才 insert, 避免同一拍組長出兩列。
 */
export async function syncMemberPair(
  supabase: SupabaseClient,
  gym: GymSyncInfo | null | undefined,
  pair: ClientPairRecord,
  potential: number,
  superAwakening: number,
  exStyleWorn = false,
  /**
   * 個人的等級與星數 —— member_pairs 存的是鏡像 (0057 / 0059), 道館的側板讀它。
   * 兩條寫入路徑都要維持: 本人自己改走這裡, 管理員代改走 set_member_pair。
   */
  level = 1,
  promotion?: number
): Promise<void> {
  if (!gym?.memberId) return;
  const grade = gradeOf(potential, superAwakening);
  const { data: existing, error: qErr } = await supabase
    .from("member_pairs")
    .select("id")
    .eq("member_id", gym.memberId)
    .eq("pair_id", pair.pairId)
    .limit(1);
  if (qErr) {
    console.warn("member_pairs 查詢失敗:", qErr.message);
    return;
  }
  const sa = Math.max(0, Math.min(5, superAwakening));
  // 寶0 = 不持有 → 直接刪列, 不要留 grade=0 的幽靈列
  // (成員管理頁的「持有 N」與道館持有率都是數列數, 留著會算進去)
  if (grade === 0) {
    if (existing && existing.length > 0) {
      const { error: delErr } = await supabase
        .from("member_pairs")
        .delete()
        .eq("id", existing[0].id);
      if (delErr) console.warn("member_pairs 歸零失敗:", delErr.message);
    }
    return;
  }
  const { error } = existing && existing.length > 0
    ? await supabase
        .from("member_pairs")
        .update({ grade, super_awakening: sa, ex_style_worn: exStyleWorn, level, promotion: promotion ?? null })
        .eq("id", existing[0].id)
    : await supabase.from("member_pairs").insert({
        gym_id: gym.gymId,
        member_id: gym.memberId,
        pair_label: pairLabel(pair),
        pair_id: pair.pairId,
        grade,
        super_awakening: sa,
        ex_style_worn: exStyleWorn,
        level,
        promotion: promotion ?? null,
      });
  if (error) console.warn("member_pairs 同步失敗:", error.message);
}
