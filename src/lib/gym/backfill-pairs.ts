import "server-only";

// 拍組跟著帳號走 (0080, 2026-10-01 使用者:「拍組應該是跟著 google 帳號, 不會因為道館離開加入而被影響」)。
//
// 道館端看的是 member_pairs (帳號資料 user_collection 的鏡像), 而鏡像原本只在**改練度的那一下**寫 ——
// 加入道館不會補, 所以轉館的人 (軒: 帳號 439 張, 新道館 0 張) 在新道館裡什麼都沒有。
// RPC backfill_my_member_pairs 把呼叫者自己帳號的拍組同步進他的鏡像: 缺的補上、既有的列對齊帳號、不刪、
// 不記進道館紀錄。規則全在 RPC 裡 (帳號為什麼永遠是最新的那一份, 見 0080 檔頭)。
//
// 兩種用法:
//   - syncMyMirror: **等它做完**。成員頁在「自己的卡有缺」時用 —— 不然第一次打開看到的是灰卡,
//     而在灰卡上點左下角會走 set_member_pair 從寶1 開始寫, 連帳號一起改掉 (軒 10/1 就在道館頁手動重點了 87 張)。
//   - scheduleMyPairsBackfill: 回應送出**之後**才跑 (next/server 的 after, 不擋頁面)。導覽列與 /pairs 用。
//
// ⚠ 兩支都**不可以丟例外**: 這是背景補資料, 壞掉頂多下次開頁再補; 它把頁面弄壞就本末倒置了
//   (/pairs 那一段丟例外會掉進 catch, gymSync 變 null = 之後改的練度都不再同步進道館)。
// ⚠ Server Component 裡的 after 不能再讀 cookies() —— 所以 supabase client 一定要在排程**之前**建好。

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadPairsById } from "@/lib/pairs/loader";
import { mirrorLabels } from "@/lib/pairs/mirror-labels";
import { createClient } from "@/lib/supabase/server";

/**
 * 自己帳號持有、而且寶數 > 0 的 pair_id —— 與 RPC 的條件一致 (寶0 不留鏡像列), 不然成員頁會把
 * 「持有但寶0」的列永遠當成缺的, 每次開頁都白跑一次同步。
 * 一個人最多就是全圖鑑那六百多張, 不會超過 PostgREST 的 1000 列。
 */
export async function fetchMyOwnedPairIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_collection")
    .select("pair_id")
    .eq("user_id", userId)
    .eq("owned", true)
    .or("potential.gt.0,super_awakening.gt.0");
  if (error) return [];
  return (data ?? []).map((r: { pair_id: string }) => r.pair_id);
}

/** 對這幾個成員列各同步一次, 回傳總共動了幾列。失敗只留 console, 不丟例外。 */
export async function syncMyMirror(
  supabase: SupabaseClient,
  memberIds: string[],
  ownedPairIds: string[]
): Promise<number> {
  if (memberIds.length === 0 || ownedPairIds.length === 0) return 0;
  try {
    const labels = mirrorLabels(ownedPairIds, await loadPairsById());
    let n = 0;
    for (const memberId of memberIds) {
      const { data, error } = await supabase.rpc("backfill_my_member_pairs", {
        p_member: memberId,
        p_labels: labels,
      });
      // PGRST202 = migration 還沒套 (部署與套 migration 不會同時落地) —— 安靜跳過
      if (error) {
        if (error.code !== "PGRST202") console.warn("同步道館拍組失敗:", error.message);
      } else {
        n += typeof data === "number" ? data : 0;
      }
    }
    return n;
  } catch (e) {
    console.warn("同步道館拍組失敗:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * 回應送出後, 把自己帳號的拍組同步進自己所在的每一館。
 * memberIds 有傳就直接用 (呼叫端通常已經查過自己的成員列); 沒傳就自己查。
 * 顧問 / 待確認的人就算混進來, RPC 也會回 0 (0072 / 0071)。
 */
export async function scheduleMyPairsBackfill(userId: string, memberIds?: string[]): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  if (memberIds && memberIds.length === 0) return;
  try {
    const supabase = await createClient();
    after(async () => {
      try {
        let ids = memberIds;
        if (!ids) {
          // 讀得到的只有 active 的列 (0071: 待確認的人讀不到自己那一列)
          const { data } = await supabase.from("gym_members").select("id, role").eq("user_id", userId);
          ids = (data ?? []).filter((m) => m.role !== "advisor").map((m) => m.id);
        }
        if (ids.length === 0) return;
        await syncMyMirror(supabase, ids, await fetchMyOwnedPairIds(supabase, userId));
      } catch (e) {
        console.warn("同步道館拍組失敗:", e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    console.warn("排程同步道館拍組失敗:", e instanceof Error ? e.message : e);
  }
}
