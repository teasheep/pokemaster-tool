// 目前道館 (一人可加入多館 — 顧問尤其會同時看好幾個)。
// 用 cookie 記住最後進入的道館, server 端據此決定「我的拍組」要同步到哪一館、
// 道館拍組 ★ 以哪一館為準。cookie 只是偏好, 一律要用實際成員資格驗證。

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export const ACTIVE_GYM_COOKIE = "pm_active_gym";

export type MyGymMembership = {
  gymId: string;
  gymName: string;
  memberId: string;
  role: string;
  isAdmin: boolean;
};

/**
 * 我加入的所有道館 (含角色) + 目前道館。
 * active = cookie 指定且仍是成員的那一館; 否則第一個 (管理的優先)。
 */
export async function getMyMemberships(userId: string): Promise<{
  all: MyGymMembership[];
  active: MyGymMembership | null;
}> {
  const supabase = await createClient();
  const [{ data: rows }, { data: gyms }] = await Promise.all([
    supabase.from("gym_members").select("id, gym_id, role").eq("user_id", userId),
    supabase.from("gyms").select("id, name"),
  ]);
  const gymById = new Map((gyms ?? []).map((g) => [g.id, g]));
  const all: MyGymMembership[] = [];
  for (const r of rows ?? []) {
    const g = gymById.get(r.gym_id);
    if (!g) continue;
    all.push({
      gymId: r.gym_id,
      gymName: g.name,
      memberId: r.id,
      role: r.role,
      isAdmin: r.role === "admin",
    });
  }
  all.sort(
    (a, b) =>
      Number(b.isAdmin) - Number(a.isAdmin) || a.gymName.localeCompare(b.gymName, "zh-Hant")
  );

  const cookieGym = (await cookies()).get(ACTIVE_GYM_COOKIE)?.value;
  const active = all.find((m) => m.gymId === cookieGym) ?? all[0] ?? null;
  return { all, active };
}
