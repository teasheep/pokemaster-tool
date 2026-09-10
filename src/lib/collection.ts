import { createClient } from "@/lib/supabase/server";

/** 使用者收藏中單一拍組的練度狀態 (對應 user_collection 表) */
export type CollectionEntry = {
  pairId: string;
  owned: boolean;
  level: number;
  promotion: number;      // 當前星數 (升級後)
  potential: number;      // 寶 0-5
  superAwakening: number; // 超覺醒 0-5
  exUnlocked: boolean;    // 6★EX (= 星數 6); 與下面的 exRoleUnlocked 是兩件事
  /** 拍檔石盤段數索引 0-5 → 60/62/64/66/68/70 (SYNC_GRID_CAPS)。上限 = 索引 = 寶數 */
  syncGrid: number;
  /** EX 體系有沒有解鎖 (拍組能不能解鎖看 catalog 的 hasExRole) */
  exRoleUnlocked: boolean;
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
      "pair_id, owned, level, promotion, potential, super_awakening, ex_unlocked, sync_grid, ex_role_unlocked, ex_style_worn, notes"
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
      syncGrid: r.sync_grid ?? 0,
      exRoleUnlocked: r.ex_role_unlocked ?? false,
      exStyleWorn: r.ex_style_worn ?? false,
      notes: r.notes,
    };
  }
  return map;
}
