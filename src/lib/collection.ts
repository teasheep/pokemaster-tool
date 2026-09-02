import { createClient } from "@/lib/supabase/server";

/** 使用者收藏中單一拍組的練度狀態 (對應 user_collection 表) */
export type CollectionEntry = {
  pairId: string;
  owned: boolean;
  level: number;
  promotion: number;      // 當前星數 (升級後)
  potential: number;      // 寶 0-5
  superAwakening: number; // 超覺醒 0-5
  exUnlocked: boolean;
  exStyleWorn: boolean;   // EX 裝 (換裝立繪) 是否穿戴中
  notes: string | null;
};

export type CollectionMap = Record<string, CollectionEntry>;

/** 載入登入使用者的收藏, 回傳以 pairId 為 key 的 map */
export async function getUserCollection(userId: string): Promise<CollectionMap> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_collection")
    .select(
      "pair_id, owned, level, promotion, potential, super_awakening, ex_unlocked, ex_style_worn, notes"
    )
    .eq("user_id", userId);
  if (error || !data) return {};
  const map: CollectionMap = {};
  for (const r of data) {
    map[r.pair_id] = {
      pairId: r.pair_id,
      owned: r.owned,
      level: r.level,
      promotion: r.promotion,
      potential: r.potential,
      superAwakening: r.super_awakening,
      exUnlocked: r.ex_unlocked,
      exStyleWorn: r.ex_style_worn ?? false,
      notes: r.notes,
    };
  }
  return map;
}
