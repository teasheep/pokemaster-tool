import { redirect } from "next/navigation";

import { PageHeading, PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getMyMemberships } from "@/lib/gym/active-gym";
import { ConnectClient } from "./connect-client";

export const dynamic = "force-dynamic";

/** 資料連線 — 個人金鑰, 讓外部 AI 讀「這個人看得到的資料」 */
export default async function ConnectPage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/connect");

  const [{ data: token }, { all }] = await Promise.all([
    supabase.rpc("get_my_export_token"),
    getMyMemberships(user.id),
  ]);

  return (
    <main className="flex-1">
      <PageShell width="prose">
        <PageHeading title="資料連線" />
        <ConnectClient
          token={token ?? null}
          gyms={all.map((m) => ({ name: m.gymName, role: m.role }))}
        />
      </PageShell>
    </main>
  );
}
