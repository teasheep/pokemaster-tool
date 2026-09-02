import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { ProfileClient } from "./profile-client";

export const dynamic = "force-dynamic";

/** 個人設定 (頭像選單進入): 頭貼 + 遊戲名/社群名 — 寫 profiles, 同步道館成員名單 */
export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?redirect=/profile");
  }

  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("display_name, line_name, avatar_url").eq("id", user.id).maybeSingle(),
    // 出沒時段存在道館成員列 (跨館共用同一個值)
    supabase.from("gym_members").select("availability").eq("user_id", user.id).limit(1).maybeSingle(),
  ]);

  return (
    <>
      <main className="flex-1">
        <PageShell width="form">
          <h1 className="text-2xl font-bold tracking-tight">個人設定</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            頭貼與名稱會顯示在道館的所有名單與道館戰看板
          </p>
          <div className="mt-6">
            <ProfileClient
              userId={user.id}
              profile={{
                displayName: profile?.display_name ?? "",
                lineName: profile?.line_name ?? null,
                avatarUrl: profile?.avatar_url ?? null,
                availability: member?.availability ?? null,
              }}
            />
          </div>
        </PageShell>
      </main>
    </>
  );
}
