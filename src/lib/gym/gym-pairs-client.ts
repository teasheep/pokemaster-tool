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
    const { error } = await supabase.from("gym_pairs").insert({
      gym_id: gymId,
      pair_label: pairLabel(pair),
      pair_id: pair.pairId,
      type: pair.type as SyncPairType,
    });
    if (error) {
      toast.error("設為道館拍組失敗", { description: error.message });
      return false;
    }
    toast.success(`已設為道館拍組: ${name}`);
    return true;
  }
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
