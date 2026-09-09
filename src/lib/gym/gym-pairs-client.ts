"use client";

// 道館拍組 (gym_pairs) 名單增刪 — /pairs、/inventory、/gyms/[id]/pairs 共用的單一寫入路徑。
// 之前兩頁各抄一份 (label 寫法還不一致), 收斂到這裡。

import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

import { pairLabel, pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

/** 設為/移出道館拍組 (含成功/失敗 toast); 回傳是否成功 (失敗時呼叫端應回滾樂觀更新) */
export async function setGymPair(
  supabase: SupabaseClient,
  gymId: string,
  pair: ClientPairRecord,
  add: boolean
): Promise<boolean> {
  const name = pairName(pair);
  if (add) {
    /**
     * **加入名單是冪等的: 已經在名單裡就當成功** (2026-09-09 使用者回報
     * 「duplicate key value violates unique constraint gym_pairs_gym_id_pair_label_key」,
     * 而且自己判斷是「兩個管理員同時進去新增造成的」—— 正是這條)。
     *
     * 兩位管理員同時看著同一張卡 (或同一個人開了兩個分頁) 時, 兩邊的 ★ 都顯示「未設定」:
     * 先按的插入成功, 後按的撞上 `(gym_id, pair_label)` 唯一鍵。但這顆按鈕要的是**結果**
     * 不是**動作** ——「這隻要在名單裡」已經成立了, 對按的人來說就是成功。報失敗只會讓他
     * 再按一次, 而那一次是 delete, 反而真的把名單弄掉。
     *
     * 用 `ignoreDuplicates` (= `on conflict do nothing`) 而不是接住 23505:
     * 兩者結果一樣, 但衝突時前者是 201 後者是 **409**, 而 409 會在使用者的 devtools
     * 留下一行紅字 (`Failed to load resource`) —— 明明是正常情況, 不該看起來像壞掉。
     * 一樣是一趟請求, 判斷交給資料庫做也才沒有 check-then-insert 的競態。
     */
    const { error } = await supabase
      .from("gym_pairs")
      .upsert(
        {
          gym_id: gymId,
          pair_label: pairLabel(pair),
          pair_id: pair.pairId,
          type: pair.type as SyncPairType,
        },
        { onConflict: "gym_id,pair_label", ignoreDuplicates: true }
      );
    if (error) {
      toast.error("設為道館拍組失敗", { description: error.message });
      return false;
    }
    toast.success(`已設為道館拍組: ${name}`);
    return true;
  }
  // 移出本來就是冪等的: 別人先移掉了就是刪到 0 列, 不算錯誤 (目標狀態一樣成立)
  const { error } = await supabase
    .from("gym_pairs")
    .delete()
    .eq("gym_id", gymId)
    .eq("pair_id", pair.pairId);
  if (error) {
    toast.error("移出道館拍組失敗", { description: error.message });
    return false;
  }
  toast.success(`已移出道館拍組: ${name}`);
  return true;
}
