import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { WelcomeClient } from "./welcome-client";

export const dynamic = "force-dynamic";

/** 首次登入設定 — Google 登入後填遊戲名/社群名/頭貼 (已完成過就直接進站) */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  // getSessionUser 是 request 級快取 — 跟 SiteHeader 共用同一次 auth 往返
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/gyms";

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, line_name, avatar_url, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.onboarded_at) {
    redirect(dest);
  }

  // 已在道館名單 (管理員匯入的成員) → 沿用名單上的名字當預設值
  const { data: member } = await supabase
    .from("gym_members")
    .select("display_name, line_name")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return (
    <>
      <main className="flex-1">
        <PageShell width="form">
          <h1 className="text-2xl font-bold tracking-tight">歡迎加入 🎉</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            設定你的名稱與頭貼 — 道館的名單、道館戰看板都會顯示這些資訊
          </p>
          <div className="mt-6">
            <WelcomeClient
              userId={user.id}
              next={dest}
              initial={{
                displayName: member?.display_name ?? profile?.display_name ?? "",
                lineName: member?.line_name ?? profile?.line_name ?? null,
                avatarUrl: profile?.avatar_url ?? null,
              }}
              hasGym={!!member}
            />
          </div>
        </PageShell>
      </main>
    </>
  );
}
