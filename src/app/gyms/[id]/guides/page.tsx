import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getGymContext } from "@/lib/gym/queries";
import { GuidesClient } from "./guides-client";

export const dynamic = "force-dynamic";

/** 攻略庫 — 打法筆記 / 手順 / 影片連結的共筆分頁 */
export default async function GymGuidesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/guides`);
  }

  const { gym, viewer, members } = await getGymContext(id);
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

  const { data: guides } = await supabase
    .from("gym_guides")
    .select("*")
    .eq("gym_id", id)
    .order("updated_at", { ascending: false });

  return (
    <>
      <PageHeading title="道館攻略" />
      <GuidesClient
        gymId={id}
        userId={user.id}
        isAdmin={viewer.isAdmin}
        authorName={members.find((m) => m.id === viewer.memberId)?.display_name ?? null}
        initialGuides={guides ?? []}
      />
    </>
  );
}
