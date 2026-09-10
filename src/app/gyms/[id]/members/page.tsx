import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { fetchGymGrades, getGymContext, getMyPendingGyms } from "@/lib/gym/queries";
import { CATALOG_VERSION, loadPairsForClient } from "@/lib/pairs/loader";
import { pickParam } from "@/lib/url-params";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

export default async function GymMembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // 重新整理要留在原本的畫面 → 這幾個決定畫面長相的狀態走網址 (見 lib/use-url-state.ts)
  searchParams: Promise<{ member?: string; view?: string; scope?: string; owned?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/members`);
  }

  const { gym, viewer, members, advisors, pending } = await getGymContext(id);
  if (!gym || !viewer) {
    // 「不是成員」有兩種: 真的不相干, 以及**貼了碼在等管理員確認** (0071)。
    // 對後者講「找不到道館」是錯的訊息 —— 他什麼都沒做錯, 只是還沒被放行。
    // 這一趟只在失敗路徑上多花 (正常成員永遠走不到這裡)。
    const waiting = (await getMyPendingGyms()).find((p) => p.gymId === id);
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold">
          {waiting ? "等管理員確認中" : "找不到道館或你不是成員"}
        </h1>
        {waiting ? (
          <p className="mt-2 text-sm text-muted-foreground">
            你已經送出加入「{waiting.gymName}」的申請，管理員按確認後才看得到館內的資料。
          </p>
        ) : null}
        <Button asChild className="mt-4">
          <Link href="/gyms?list=1">回道館列表</Link>
        </Button>
      </div>
    );
  }

  const [{ data: gymPairs }, grades, { data: invite }] = await Promise.all([
    supabase.from("gym_pairs").select("id, pair_label, pair_id, type").eq("gym_id", id),
    // 全館持有 (分頁全量 — 這張表早就破 2000 列, 忘了分頁持有率會默默少算)
    fetchGymGrades(id),
    viewer.isAdmin
      ? supabase.from("gym_invites").select("code, advisor_code").eq("gym_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const memberList = [...members, ...advisors];

  /**
   * 圖鑑只送這頁畫得出來的那些 —— 「全館拍組」視角要的是道館名單 (★, 144 筆),
   * 「選成員」視角要的是**那個人持有的** (可能不在名單裡) → 兩者的聯集缺一不可:
   * 少送一邊, 卡片就會掉成灰字 (前科)。實測聯集 146 筆 = 71.5KB, 整本 645 筆是 309KB。
   * (成員側板讀的 member_pairs 沒有 grade 條件, 但 grade=0 一律刪列不留幽靈列
   *  (syncMemberPair / set_member_pair), 所以「有人持有 grade>=1」就是完整的那一組。)
   * 「所有遊戲拍組」範圍的其餘 500 筆等使用者真的切過去才由 fullCatalogUrl 抓
   * (與隊伍庫/看板的「全圖鑑」同一份, 瀏覽器 immutable 快取)。
   * (loadPairsForClient 是純記憶體投影, 不是一趟往返, 排在 Promise.all 後面不多花時間)
   */
  const needed = new Set<string>();
  for (const g of gymPairs ?? []) if (g.pair_id) needed.add(g.pair_id);
  for (const g of grades) if (g.pair_id) needed.add(g.pair_id);
  const catalog = (await loadPairsForClient().catch(() => [])).filter((p) =>
    needed.has(p.pairId)
  );

  /**
   * 全館持有壓成索引式 (見 pairs-client.tsx 的 PackedGrades — **兩邊一起改**):
   * 2047 列 × {36 字元 member uuid, pair_id, grade} 原樣送是 174KB, 壓完 12.1KB,
   * 解回來的 gradeMap 逐項相同 (持有人數 / 持有者名單 / 全館最高寶數都不變)。
   * 索引 = 下面 members 那份陣列的位置, 所以兩者一定要用同一個 memberList。
   */
  // ⚠ 索引只收**正式成員** (getGymContext 的 members 已經排除顧問與待確認的),
  // 不是 memberList —— 顧問不佔 20 人名額, 他的練度不該進持有率 (0072)。
  // 前科: 索引用 memberList 而分母用 gymViewMembers (不含顧問), 於是一位顧問持有的卡
  // 會算進**分子**卻不算分母 → 有機會出現「持有 20 / 19 人」, 而且側板的持有者清單
  // 會冒出一顆沒有頭像、名字是「?」的晶片 (memberById 查不到他)。
  // 這條今天就按得到: 管理員把一位成員降級成顧問, 他的 member_pairs 還留著 (刻意不刪,
  // 改回成員時要回得來)。
  const memberIndex = new Map(members.map((m, i) => [m.id, i]));
  const byPair: Record<string, number[]> = {};
  for (const g of grades) {
    if (!g.pair_id) continue;
    const i = memberIndex.get(g.member_id);
    if (i === undefined) continue; // 顧問 / 待確認 / 已不在名冊上的人
    (byPair[g.pair_id] ??= []).push(i, g.grade);
  }

  return (
    <MembersClient
      initialView={{
        member: sp.member ?? null,
        view: pickParam(sp.view, ["pairs", "resources"] as const, "pairs"),
        scope: pickParam(sp.scope, ["gym", "all"] as const, "gym"),
        ownedOnly: sp.owned === "1",
      }}
      gymId={id}
      viewer={viewer}
      gymPairs={gymPairs ?? []}
      // memberIds 與上面的 memberIndex 是同一份 (正式成員), 不是 memberList
      grades={{ memberIds: members.map((m) => m.id), byPair }}
      invite={invite ? { code: invite.code, advisorCode: invite.advisor_code } : undefined}
      // 待確認的申請 (0071) **只送給管理員** —— 只有他按得動那個勾勾/叉叉,
      // 而且沒必要讓全館看到誰在門外等。
      pending={
        viewer.isAdmin
          ? pending.map((m) => ({
              id: m.id,
              displayName: m.display_name,
              lineName: m.line_name,
              avatarUrl: m.avatar_url,
              badgeText: m.badge_text,
              role: m.role,
              requestedAt: m.created_at,
            }))
          : []
      }
      members={memberList.map((m) => ({
        id: m.id,
        displayName: m.display_name,
        role: m.role,
        bound: m.user_id !== null,
        lineName: m.line_name,
        availability: m.availability,
        avatarUrl: m.avatar_url,
        badgeText: m.badge_text,
      }))}
      catalog={catalog}
      fullCatalogUrl={`/api/catalog?v=${CATALOG_VERSION}`}
    />
  );
}
