import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { getGymContext } from "@/lib/gym/queries";
import { loadPairsForClient } from "@/lib/pairs/loader";
import { ActivityClient } from "./activity-client";

export const dynamic = "force-dynamic";

/** 變化紀錄 — 管理員看全館所有成員, 一般成員只看自己的 (RLS 把關) */
export default async function GymActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/activity`);
  }

  const [{ gym, viewer, members }, catalog] = await Promise.all([
    getGymContext(id),
    loadPairsForClient().catch(() => []),
  ]);
  if (!gym || !viewer) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold">找不到道館或你不是成員</h1>
        <Button asChild className="mt-4">
          <Link href="/gyms">回道館列表</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeading title="紀錄" />
      <ActivityClient
        gymId={id}
        isAdmin={viewer.isAdmin}
        myMemberId={viewer.memberId}
        members={members.map((m) => ({
          id: m.id,
          displayName: m.display_name,
          lineName: m.line_name,
          avatarUrl: m.avatar_url,
          badgeText: m.badge_text,
        }))}
        catalog={catalog}
      />
    </>
  );
}
