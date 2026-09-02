import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getGymContext } from "@/lib/gym/queries";
import { CATALOG_VERSION, loadPairsForClient } from "@/lib/pairs/loader";
import { TeamsClient } from "./teams-client";

export const dynamic = "force-dynamic";

/** 隊伍庫 — 道館層級的隊伍管理 (不綁定任何一關; 關卡要用哪套在看板的側板選) */
export default async function GymTeamsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/teams`);
  }

  // 道館脈絡與隊伍資料同時抓 (別排成一輪一輪的往返)
  // select 一律明列欄位 — '*' 會多送 gym_id 與兩個時間戳, 沒有人讀 (型別見 team-sheet.tsx)
  const [{ gym, viewer }, { data: teams }, { data: teamPairs }, { data: gymPairs }] =
    await Promise.all([
      getGymContext(id),
      supabase.from("gym_teams").select("id, type, name, tag, note, sort_order").eq("gym_id", id),
      supabase
        .from("gym_team_pairs")
        .select("id, team_id, slot, pair_id, min_grade")
        .eq("gym_id", id),
      // 隊伍編輯候選池 = 道館拍組名單
      supabase
        .from("gym_pairs")
        .select("pair_id, type")
        .eq("gym_id", id)
        .not("pair_id", "is", null),
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

  /**
   * 這頁只需要「道館名單 ∪ 已經在隊伍裡」的拍組 (144 筆左右), 不是整本 645 筆 —
   * 兩邊的聯集缺一不可: 少了名單, 候選池是空的; 少了隊伍裡的, 隊伍卡會變成灰字 pair_id。
   * 圖鑑其餘的部分等使用者在面板勾「全圖鑑」再由 /api/catalog 現抓。
   * (loadPairsForClient 是純記憶體投影, 不是一趟往返, 排在 Promise.all 後面不多花時間)
   */
  const needed = new Set<string>();
  for (const g of gymPairs ?? []) if (g.pair_id) needed.add(g.pair_id);
  for (const tp of teamPairs ?? []) needed.add(tp.pair_id);
  const catalog = (await loadPairsForClient().catch(() => [])).filter((p) =>
    needed.has(p.pairId)
  );

  return (
    <>
      <PageHeading title="隊伍庫" />
      <TeamsClient
        gymId={id}
        isAdmin={viewer.isAdmin}
        initialTeams={teams ?? []}
        initialTeamPairs={teamPairs ?? []}
        gymPairs={(gymPairs ?? []).map((g) => ({ pairId: g.pair_id!, type: g.type }))}
        catalog={catalog}
        fullCatalogUrl={`/api/catalog?v=${CATALOG_VERSION}`}
      />
    </>
  );
}
