import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading, PageShell } from "@/components/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { getMyMemberships } from "@/lib/gym/active-gym";
import { ResourcesClient } from "./resources-client";

export const dynamic = "force-dynamic";

/**
 * 我的資源 — 糖果庫存 (排刀媒合會把「吃糖可達的寶數」算進去)。
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
          <PageHeading title="我的資源" />
          <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
            <p className="text-sm text-muted-foreground">加入道館後才會有糖果庫存。</p>
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
        <PageHeading title="我的資源" />
        <ResourcesClient gymId={active.gymId} memberId={active.memberId} />
      </PageShell>
    </main>
  );
}
