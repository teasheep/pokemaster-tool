import type { Metadata } from "next";

import { NOINDEX } from "@/lib/site";
import { redirect } from "next/navigation";

import { PageHeading, PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getMyGyms } from "@/lib/gym/queries";
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

  const gyms = await getMyGyms();
  const { list } = await searchParams;

  // 只屬於一個道館 → 直接進去 (不用多點一層); 多館者留在清單自己選,
  // 道館頁的切換器也能換館。/gyms?list=1 一律停在清單 (加入/建立入口)
  if (gyms.length === 1 && list !== "1") {
    redirect(`/gyms/${gyms[0].id}`);
  }

  const { data: memberRows } = await supabase.from("gym_members").select("gym_id, user_id, role");
  const counts = new Map<string, number>();
  const adminGymIds = new Set<string>();
  for (const r of memberRows ?? []) {
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
          />
        </PageShell>
      </main>
    </>
  );
}
