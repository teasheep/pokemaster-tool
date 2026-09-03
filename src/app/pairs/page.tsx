import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getUserCollection, type CollectionMap } from "@/lib/collection";
import { loadPairsForClient } from "@/lib/pairs/loader";
import { getMyMemberships } from "@/lib/gym/active-gym";
import { PairsHub } from "./pairs-hub";

export const dynamic = "force-dynamic";

/**
 * 這是全站**唯一「不登入也有實質內容」**的頁 —— 訪客看得到整本圖鑑 (灰卡),
 * 所以 SEO 上它是除了首頁以外唯一值得被收錄的網址 (見 `app/sitemap.ts`)。
 * 描述寫的是「訪客會看到什麼」, 不是登入後的功能。
 */
export const metadata: Metadata = {
  title: "拍組圖鑑",
  description:
    "Pokémon Masters EX 全拍組圖鑑：依屬性、角色定位、系列、地區、原始星級篩選，不用登入就能查。登入後可以記錄自己的寶數與超覺醒。",
  alternates: { canonical: "/pairs" },
  openGraph: {
    title: "拍組圖鑑",
    description: "Pokémon Masters EX 全拍組圖鑑：依屬性、角色定位、系列、地區、原始星級篩選。",
    url: "/pairs",
  },
};

/**
 * 拍組頁 — 這裡**只有個人的東西**。子分頁 (client 端):
 *   我的道館拍組 / 我的所有拍組 / 所有拍組圖鑑
 * 別人的持有屬於道館, 在 /gyms/[id]/members 看 (不要再把成員切換塞回這頁)。
 */
export default async function PairsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const catalog = await loadPairsForClient().catch(() => []);

  let collection: CollectionMap = {};
  let signedIn = false;
  let gymSync: { gymId: string; memberId: string | null } | null = null;
  let gymPairIds: string[] = [];
  let isGymAdmin = false;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      // 一律走 getSessionUser (request 級快取) — 自己 auth.getUser() 等於跟 SiteHeader
      // 各打一趟 Supabase, 而且是序列的, 白白擋住後面三個查詢
      const user = await getSessionUser();
      if (user) {
        signedIn = true;
        // 一人可多館 → 以「目前道館」(cookie) 為準, 不能隨便抓第一筆成員列
        const [col, { active }] = await Promise.all([
          getUserCollection(user.id),
          getMyMemberships(user.id),
        ]);
        collection = col;
        if (active) {
          gymSync = { gymId: active.gymId, memberId: active.memberId };
          const supabase = await createClient();
          const { data: gp } = await supabase
            .from("gym_pairs")
            .select("pair_id")
            .eq("gym_id", active.gymId)
            .not("pair_id", "is", null);
          gymPairIds = [...new Set((gp ?? []).map((g) => g.pair_id!).filter(Boolean))];
          isGymAdmin = active.isAdmin;
        }
      }
    } catch {
      // 未登入或讀取失敗 → 訪客圖鑑模式
    }
  }

  return (
    <main className="flex-1">
      <PageShell>
        <PairsHub
          catalog={catalog}
          signedIn={signedIn}
          initialCollection={collection}
          gymSync={gymSync}
          gymPairIds={gymPairIds}
          isGymAdmin={isGymAdmin}
          initialTab={tab === "all" || tab === "mine" ? "all" : tab === "gym" ? "gym" : null}
        />
      </PageShell>
    </main>
  );
}
