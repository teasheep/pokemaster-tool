import type { Metadata } from "next";

import { NOINDEX } from "@/lib/site";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading, PageShell } from "@/components/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { getMyMemberships } from "@/lib/gym/active-gym";
import { ResourcesClient } from "./resources-client";

export const metadata: Metadata = { title: "我的背包", ...NOINDEX };

export const dynamic = "force-dynamic";

/**
 * 我的背包 — 三塊: 背包 (糖果 + 體系蛋糕捲 + 成長潛力券, 各有幾個) +
 * 想投入資源的屬性 + 已投入較多資源的屬性 (後兩塊是 0056, 給安排道館戰的人看)。
 * 原本擠在拍組頁上方, 卡片牆被壓得很難看 → 獨立一頁。
 */
export default async function ResourcesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/resources");

  const { active } = await getMyMemberships(user.id);
  if (!active?.memberId) {
    return (
      <main className="flex-1">
        <PageShell width="prose">
          <PageHeading title="我的背包" />
          <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
            <p className="text-sm text-muted-foreground">加入道館後才會有資源可以記。</p>
            <Button asChild className="mt-4">
              <Link href="/gyms">去道館</Link>
            </Button>
          </div>
        </PageShell>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <PageShell width="prose">
        <PageHeading title="我的背包" />
        <ResourcesClient gymId={active.gymId} memberId={active.memberId} />
      </PageShell>
    </main>
  );
}
