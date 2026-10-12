import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getGymContext } from "@/lib/gym/queries";
import { loadPairsForClient } from "@/lib/pairs/loader";
import { pickParam } from "@/lib/url-params";
import { ActivityClient } from "./activity-client";
// ⚠ 值域從**沒有標 "use client" 的**那一支拿 —— 從 activity-client 拿會是 client reference
//   (症狀: allowed.includes is not a function, 整頁掛掉), 見 activity-filters.ts 檔頭。
import { ACTIVITY_KINDS, ACTIVITY_RANGES, pickDate } from "./activity-filters";

export const dynamic = "force-dynamic";

/**
 * 道館紀錄 — 管理員看全館所有成員, 一般成員只看自己的 (RLS 把關);
 * 道館層級的列 (道館拍組名單, member_id 為 null) 只有管理員看得到。
 * 2026-08-17 曾經下架 (使用者要重做), 2026-09-10 使用者要求加回來,
 * 並補上日期篩選 (含自訂區間)、操作者、兩層版面。
 */
export default async function GymActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // 重新整理要留在原本的畫面 → 三個篩選都走網址 (見 lib/use-url-state.ts)
  searchParams: Promise<{
    member?: string;
    kind?: string;
    days?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/activity`);
  }

  const supabase = await createClient();
  const [{ gym, viewer, members, advisors }, catalog, { data: departed }] = await Promise.all([
    getGymContext(id),
    loadPairsForClient().catch(() => []),
    // 已經離開的成員 (0081 的名字/頭像快照): 他們留下的紀錄照樣要看得出是誰,
    // 不然改的人會掉成「匯入資料」、被改的人掉成「已退出的成員」(2026-10-12 使用者抓到阿育那幾筆)。
    // 一館就歷年離開的那幾位, 不必分頁; 表不存在時回 null 等於沒有。
    supabase
      .from("departed_members")
      .select("id, user_id, display_name, line_name, avatar_url, badge_text")
      .eq("gym_id", id),
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
      <PageHeading title="道館紀錄" />
      <ActivityClient
        gymId={id}
        isAdmin={viewer.isAdmin}
        myMemberId={viewer.memberId}
        // 初始值一律由 server 讀了往下傳 —— client 自己 useSearchParams 會 hydration mismatch
        initialMember={
          typeof sp.member === "string" && members.some((m) => m.id === sp.member)
            ? sp.member
            : "all"
        }
        initialKind={pickParam(sp.kind, ACTIVITY_KINDS, "pair")}
        initialDays={pickParam(sp.days, ACTIVITY_RANGES, "30")}
        initialFrom={pickDate(sp.from)}
        initialTo={pickDate(sp.to)}
        members={members.map((m) => ({
          id: m.id,
          displayName: m.display_name,
          lineName: m.line_name,
          avatarUrl: m.avatar_url,
          badgeText: m.badge_text,
          // actor_id 記的是 auth.uid —— 要靠它回查「這是誰改的」
          userId: m.user_id,
        }))}
        // 人員異動的對象常常是顧問 (放行顧問 / 改成顧問) —— 只拿來回查頭像與名字
        advisors={advisors.map((m) => ({
          id: m.id,
          displayName: m.display_name,
          lineName: m.line_name,
          avatarUrl: m.avatar_url,
          badgeText: m.badge_text,
          userId: m.user_id,
        }))}
        // 只拿來回查名字與頭像 (標「（已離開）」、頭像變灰), 不進成員篩選
        departed={(departed ?? []).map((d) => ({
          id: d.id,
          displayName: d.display_name,
          lineName: d.line_name,
          avatarUrl: d.avatar_url,
          badgeText: d.badge_text,
          userId: d.user_id,
          departed: true,
        }))}
        catalog={catalog}
      />
    </>
  );
}
