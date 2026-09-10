import type { Metadata } from "next";

import { NOINDEX } from "@/lib/site";
import { redirect } from "next/navigation";

import { PageHeading, PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getMyGyms, getMyPendingGyms, isActiveMember } from "@/lib/gym/queries";
import { GymsClient } from "./gyms-client";

export const metadata: Metadata = { title: "我的道館", ...NOINDEX };

export const dynamic = "force-dynamic";

export default async function GymsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?redirect=/gyms");
  }

  const [gyms, pending, { list }] = await Promise.all([
    getMyGyms(),
    // 還在等確認的申請 (0071) —— 這一份不是「我的道館」, 是「我按了加入但還沒被放行」
    getMyPendingGyms(),
    searchParams,
  ]);

  // 只屬於一個道館 → 直接進去 (不用多點一層); 多館者留在清單自己選,
  // 道館頁的切換器也能換館。/gyms?list=1 一律停在清單 (加入/建立入口)。
  // **有待確認的申請就不轉導** —— 不然那張「等待管理員確認」的卡片永遠沒有人看得到。
  if (gyms.length === 1 && pending.length === 0 && list !== "1") {
    redirect(`/gyms/${gyms[0].id}`);
  }

  // `select("*")` 不是偷懶: status 是 0071 才加的欄位, 明列欄位名的話, 在
  // 「前端已上線、migration 還沒套」那幾分鐘 PostgREST 會回 400, 整個道館清單就白了。
  const { data: memberRows } = await supabase.from("gym_members").select("*");
  const counts = new Map<string, number>();
  const adminGymIds = new Set<string>();
  for (const r of memberRows ?? []) {
    if (!isActiveMember(r)) continue; // 待確認的人不算在「N 位成員」裡
    counts.set(r.gym_id, (counts.get(r.gym_id) ?? 0) + 1);
    if (r.user_id === user.id && r.role === "admin") adminGymIds.add(r.gym_id);
  }

  return (
    <>
      <main className="flex-1">
        <PageShell>
          {/* 標題 = 導覽列的分頁名 (「道館」), 說明文字不用 — 下面就是道館卡片 */}
          <PageHeading title="道館" />
          <GymsClient
            gyms={gyms.map((g) => ({
              id: g.id,
              name: g.name,
              isAdmin: adminGymIds.has(g.id),
              memberCount: counts.get(g.id) ?? 0,
            }))}
            pending={pending}
          />
        </PageShell>
      </main>
    </>
  );
}
