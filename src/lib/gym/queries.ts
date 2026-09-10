// 道館頁面共用的 server 端查詢。
// 全部用「使用者身份」的 client (RLS 生效) — 不是 service role;
// 因此查不到 = 不是成員, 頁面以此判斷權限。

import { createClient, getSessionUser } from "@/lib/supabase/server";
// 判斷放在中立模組 (見那個檔的檔頭): /api/export 與測試都要用, 但它們不該被
// next/headers 拖進來。這裡照舊 re-export, 呼叫端不必知道搬過家。
import { isActiveMember, type PendingGym } from "@/lib/gym/membership";

export { isActiveMember };
export type { PendingGym };
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Database } from "@/lib/supabase/types";

export type GymRow = Database["public"]["Tables"]["gyms"]["Row"];
export type GymMemberRow = Database["public"]["Tables"]["gym_members"]["Row"];
export type GymBattleRow = Database["public"]["Tables"]["gym_battles"]["Row"];
export type BattleStageRow = Database["public"]["Tables"]["battle_stages"]["Row"];
export type MemberTicketRow = Database["public"]["Tables"]["member_tickets"]["Row"];

/** 目前使用者在某道館的身分 (null = 不是成員也不是館主) */
export type GymViewer = {
  userId: string;
  memberId: string | null; // 綁定的成員 row (館主可能沒有成員 row)
  isAdmin: boolean;
  /** 顧問 = 唯讀觀察者 (看得到全館, 不能編輯, 不佔 20 人名額) */
  isAdvisor: boolean;
  /** 可編輯道館共享資料 (出戰回報/攻略/標籤…) — 顧問為 false */
  canEdit: boolean;
};

/**
 * 讀道館 + 目前使用者的身分。gym 為 null = 不存在或無權限 (RLS 擋掉)。
 * members 只含「實際成員」(admin/member) — 排刀、券數、統計都以這份為準;
 * advisors 另外回傳 (顧問不佔名額)。
 *
 * **pending 另外一袋** (0071): 還在等確認的人不算成員 —— 名冊、持有率、排刀、
 * 匯出一律不含他們, 只有管理員的「待確認」區塊拿得到那一份。
 */
export async function getGymContext(gymId: string): Promise<{
  gym: GymRow | null;
  viewer: GymViewer | null;
  members: GymMemberRow[];
  advisors: GymMemberRow[];
  pending: GymMemberRow[];
}> {
  const empty = { gym: null, viewer: null, members: [], advisors: [], pending: [] };
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return empty;

  // 兩支沒有資料依賴 → 平行打 (每趟 Worker→Supabase 20-50ms, 序列跑等於白等一趟)。
  // 權限語意不變: 兩支都是使用者身份的 client, RLS 已擋非成員 —
  // 不是成員時 gym 為 null 直接回 empty, gym_members 那支也只會拿到空陣列。
  const [{ data: gym }, { data: all }] = await Promise.all([
    supabase.from("gyms").select("*").eq("id", gymId).maybeSingle(),
    supabase.from("gym_members").select("*").eq("gym_id", gymId).order("display_name"),
  ]);
  if (!gym) return empty;

  const rows = all ?? [];
  const active = rows.filter(isActiveMember);
  // 自己那一列也要是 active 才算數 —— 不然待確認的人在這裡會拿到 viewer 而看到半個道館。
  // (實務上走不到: 他的 gyms select 早就被 RLS 擋成 null, 上面已經 return empty 了。)
  const mine = active.find((m) => m.user_id === user.id) ?? null;
  const isAdmin = mine?.role === "admin";
  const isAdvisor = mine?.role === "advisor";

  return {
    gym,
    viewer: {
      userId: user.id,
      memberId: mine?.id ?? null,
      isAdmin,
      isAdvisor,
      canEdit: !isAdvisor,
    },
    members: active.filter((m) => m.role !== "advisor"),
    advisors: active.filter((m) => m.role === "advisor"),
    pending: rows.filter((m) => !isActiveMember(m)),
  };
}

/**
 * 我還在等哪幾館確認。
 *
 * 走 RPC 而不是查表: 待確認的人**讀不到 gyms 也讀不到自己那一列** (RLS 兩邊都收了),
 * 所以連館名都問不到 —— `my_pending_gyms()` 是 security definer, 只回呼叫者自己的申請。
 * 查不到就回空陣列 (migration 還沒套時是 PGRST202): 這只是清單上的一塊提示,
 * 不該讓整個「我的道館」頁掛掉。
 */
export async function getMyPendingGyms(): Promise<PendingGym[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_gyms");
  if (error || !data) return [];
  return data.map((r) => ({
    gymId: r.gym_id,
    gymName: r.gym_name,
    role: r.role,
    requestedAt: r.requested_at,
  }));
}

/** 全館持有的一列 (member_pairs 的最小投影) */
export type GymGradeRow = { member_id: string; pair_id: string | null; grade: number };

/**
 * 全館持有 (member_pairs, grade>=1) — 「成員與拍組」的持有率與「道館戰看板」的隊伍媒合
 * 讀的是同一份資料, 查詢只留這一支 (兩頁各自再壓成自己要的形狀送給 client)。
 *
 * **一定要分頁全量**: PostgREST 一次最多回 1000 列, 這張表早就破 2000 —
 * 忘了 range 分頁會拿到「剛好 1000 列」的假象, 持有率與媒合默默少算 (前科)。
 *
 * 只取三個欄位: pair_label 是 2000+ 列都要背一次的字串, 而它只在 pair_id 為 null 時
 * 當 fallback → 那種列在這裡就濾掉 (線上實測 0 列, 兩頁的消費者本來也都跳過它們)。
 *
 * `.order("id")` 是 offset 分頁的穩定排序, 不是裝飾: 沒有 ORDER BY 時 Postgres 不保證
 * 兩次查詢的列順序一致, 讀第 2 頁的空檔有人改練度 (syncMemberPair 在 grade=0 時會刪列)
 * 就會讓後面的列整批位移 —— 邊界的列可能重複或漏掉, 重複的那筆會讓「持有 N / 20 人」
 * 多算一個人。id 是 uuid 主鍵 = 唯一全序, 每一頁的切點因此固定。
 * 兩個消費端 (members/page.tsx 的 byPair、battles/[battleId]/page.tsx 的 packedGrades)
 * 都是把列灌進 Map/索引表, 呈現順序在 client 端另外排 (持有者名單依練度降冪),
 * 所以換排序不影響畫面。
 */
export async function fetchGymGrades(gymId: string): Promise<GymGradeRow[]> {
  const supabase = await createClient();
  return fetchAllRows<GymGradeRow>((a, b) =>
    supabase
      .from("member_pairs")
      .select("member_id, pair_id, grade")
      .eq("gym_id", gymId)
      .gte("grade", 1)
      .not("pair_id", "is", null)
      .order("id")
      .range(a, b)
  );
}

/** 我加入的道館列表 — RLS 已限縮, 直接全撈 */
export async function getMyGyms(): Promise<GymRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("gyms").select("*").order("created_at");
  return data ?? [];
}
