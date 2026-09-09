import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, COARSE_HIT_AREA } from "@/components/ui/button";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { fetchGymGrades, getGymContext } from "@/lib/gym/queries";
import { battleStatusFromDates } from "@/lib/gym/types";
import { CATALOG_VERSION, loadPairsForClient } from "@/lib/pairs/loader";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Database, SyncPairType } from "@/lib/supabase/types";
import { BattleClient } from "./battle-client";

/** 分頁查詢用的投影型別 — 欄位清單與下面的 select 一起改 */
type BattleLogRow = Pick<
  Database["public"]["Tables"]["battle_logs"]["Row"],
  "id" | "member_id" | "stage_id" | "role" | "tickets_used" | "round" | "created_at"
>;

export const dynamic = "force-dynamic";

export default async function BattlePage({
  params,
}: {
  params: Promise<{ id: string; battleId: string }>;
}) {
  const { id, battleId } = await params;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/battles/${battleId}`);
  }

  const { gym, viewer, members } = await getGymContext(id);
  if (!gym || !viewer) {
    return <Notice title="找不到道館或你不是成員" />;
  }

  const { data: battle } = await supabase
    .from("gym_battles")
    .select("*")
    .eq("id", battleId)
    .eq("gym_id", id)
    .maybeSingle();
  if (!battle) {
    return <Notice title="找不到這場賽事" backHref={`/gyms/${id}/battles`} />;
  }

  const [
    { data: stages },
    { data: tickets },
    logs,
    { data: gymPairRows },
    allGrades,
    { data: candyRows },
    { data: teams },
    { data: teamPairs },
    { data: stageTeams },
    { data: roundNotes },
    { data: allBattles },
  ] = await Promise.all([
    // select 一律明列欄位 — '*' 白送 gym_id/battle_id/時間戳, battle_logs 一場 290 列就多 40KB
    // (欄位清單 = stage-board.tsx 的 StageRow / BattleLogRow 投影, 兩邊一起改)
    supabase.from("battle_stages").select("id, weak_type").eq("battle_id", battleId).order("seq"),
    // 券數只讀 剩餘/上限 (row id 沒有人讀 — 寫入一律走 adjust_member_ticket 的 gym/battle/member)
    supabase.from("member_tickets").select("member_id, remaining, cap").eq("battle_id", battleId),
    // 分頁全量: PostgREST 一次最多 1000 列, 而一場的紀錄沒有硬上限
    // (券上限 cap 可調到 99, 且 reportBattleLog 允許 tickets_used=0 也插列) —
    // 單發 .eq() 會靜默截斷成「剛好 1000 列」, 看板的已用券與輪次推導就會少算而不報錯。
    // 這與 /api/export、battles/page.tsx 是同一個形狀, 三處要一起維持分頁。
    // .order("id") 是穩定排序的決勝鍵 (created_at 同秒會並列); 呈現順序在 client 端另排。
    fetchAllRows<BattleLogRow>((from, to) =>
      supabase
        .from("battle_logs")
        .select("id, member_id, stage_id, role, tickets_used, round, created_at")
        .eq("battle_id", battleId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    // 這頁的道館名單只當「候選池的 id 清單」用 (顯示名一律 pairName(圖鑑記錄)) → 不取 pair_label
    supabase.from("gym_pairs").select("pair_id, type").eq("gym_id", id).not("pair_id", "is", null),
    // 全成員持有 (拍組組合媒合用) — 分頁全量, 與「成員與拍組」共用同一支查詢
    fetchGymGrades(id),
    supabase.from("member_candies").select("member_id, candy_type, count").eq("gym_id", id),
    supabase.from("gym_teams").select("id, type, name, tag, note, sort_order").eq("gym_id", id),
    supabase.from("gym_team_pairs").select("id, team_id, slot, pair_id, min_grade").eq("gym_id", id),
    supabase.from("stage_teams").select("stage_id, team_id").eq("battle_id", battleId),
    // 每關每輪的敘述 (0044)
    supabase.from("stage_round_notes").select("stage_id, round, note").eq("battle_id", battleId),
    // 賽事切換器的清單 — 只依賴 gymId, 沒理由排在上面那批後面多等一趟
    // (狀態一律由賽期日期推導 battleStatusFromDates, 不讀 DB 的 status 欄)
    supabase
      .from("gym_battles")
      .select("id, name, starts_on, ends_on")
      .eq("gym_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const memberCandies: Record<string, Record<string, number>> = {};
  for (const c of candyRows ?? []) {
    (memberCandies[c.member_id] ??= {})[c.candy_type] = c.count;
  }

  /**
   * 全館持有壓成索引式 (見 battle-client 的 unpackMemberGrades — **兩邊一起改**):
   * 巢狀 `{memberId: {pairId: grade}}` 原樣送是 32.8KB, 其中每一列都要背一次 11 碼 pairId;
   * 換成「pairId 索引表 + 每人一串 [索引, 練度]」是 13.2KB (實測)。內容一位元都沒少 —
   * 解回來的物件與舊版逐鍵相同, 隊伍媒合/三列燈號/hover 明細吃的是同一份。
   */
  const gradePairIds: string[] = [];
  const gradePairIndex = new Map<string, number>();
  const packedGrades: Record<string, number[]> = {};
  for (const g of allGrades) {
    if (!g.pair_id) continue;
    let pi = gradePairIndex.get(g.pair_id);
    if (pi === undefined) {
      pi = gradePairIds.push(g.pair_id) - 1;
      gradePairIndex.set(g.pair_id, pi);
    }
    (packedGrades[g.member_id] ??= []).push(pi, g.grade);
  }

  /**
   * 對戰紀錄同理 (見 battle-client 的 unpackLogs): 一場 290 列原樣是 67.2KB,
   * 光是重複 290 次的 member/stage uuid 就佔一半; 換成索引 + created_at 用 epoch 毫秒
   * 之後是 21.5KB。索引表由紀錄本身推導 (不是拿 members) —— 名冊上查不到的人
   * (例如已移出道館) 的紀錄照樣要留著, 舊版顯示「?」就是那種列。
   */
  const logMemberIds: string[] = [];
  const logMemberIndex = new Map<string, number>();
  const logStageIds: string[] = [];
  const logStageIndex = new Map<string, number>();
  const packedLogs = logs.map((l) => {
    let mi = logMemberIndex.get(l.member_id);
    if (mi === undefined) {
      mi = logMemberIds.push(l.member_id) - 1;
      logMemberIndex.set(l.member_id, mi);
    }
    let si = -1;
    if (l.stage_id) {
      si = logStageIndex.get(l.stage_id) ?? -1;
      if (si === -1) {
        si = logStageIds.push(l.stage_id) - 1;
        logStageIndex.set(l.stage_id, si);
      }
    }
    return [l.id, mi, si, l.role, l.tickets_used, l.round, Date.parse(l.created_at)] as const;
  });

  /**
   * 看板只 touch 兩批拍組: 隊伍裡的 (gym_team_pairs — 隊伍卡/媒合/tooltip) 與
   * 道館名單 (gym_pairs — 選隊側板的候選池)。整本 645 筆不必跟著每次導覽重送;
   * 兩邊的聯集缺一不可 (少了隊伍那邊, 隊伍卡會掉成灰字 pair_id)。
   * 其餘的等使用者在選隊面板勾「全圖鑑」再由 /api/catalog 現抓。
   */
  const neededPairIds = new Set<string>();
  for (const g of gymPairRows ?? []) if (g.pair_id) neededPairIds.add(g.pair_id);
  for (const tp of teamPairs ?? []) neededPairIds.add(tp.pair_id);
  const catalogForClient = (await loadPairsForClient().catch(() => [])).filter((p) =>
    neededPairIds.has(p.pairId)
  );

  return (
    <>
      <div className="mb-4 text-sm text-muted-foreground">
        <Link
          href={`/gyms/${id}/battles`}
          // 麵包屑本體只有 15px 高 — 用 Button 那套隱形命中區補到 44px, 版面一個像素都不動
          className={`relative hover:text-foreground hover:underline ${COARSE_HIT_AREA}`}
        >
          ← 道館戰一覽
        </Link>
      </div>
      <BattleClient
            gymId={id}
            viewer={viewer}
            battle={{
              id: battle.id,
              name: battle.name,
              startsOn: battle.starts_on,
              endsOn: battle.ends_on,
            }}
            members={members.map((m) => ({
              id: m.id,
              displayName: m.display_name,
              lineName: m.line_name,
              availability: m.availability,
              role: m.role,
              bound: m.user_id !== null,
              avatarUrl: m.avatar_url,
              badgeText: m.badge_text,
            }))}
            initialStages={stages ?? []}
            initialTickets={tickets ?? []}
            initialLogs={{ memberIds: logMemberIds, stageIds: logStageIds, rows: packedLogs }}
            memberGrades={{ pairIds: gradePairIds, byMember: packedGrades }}
            memberCandies={memberCandies}
            catalog={catalogForClient}
            fullCatalogUrl={`/api/catalog?v=${CATALOG_VERSION}`}
            initialTeams={teams ?? []}
            initialTeamPairs={teamPairs ?? []}
            initialStageTeams={stageTeams ?? []}
            allBattles={(allBattles ?? []).map((b) => ({
              id: b.id,
              name: b.name,
              status: battleStatusFromDates(b.starts_on, b.ends_on),
            }))}
            initialRoundNotes={roundNotes ?? []}
            gymPairsList={(gymPairRows ?? [])
              .filter((g) => g.pair_id)
              .map((g) => ({ pairId: g.pair_id!, type: g.type as SyncPairType }))}
      />
    </>
  );
}

function Notice({ title, backHref = "/gyms" }: { title: string; backHref?: string }) {
  return (
    <div className="py-12 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Button asChild className="mt-4">
        <Link href={backHref}>返回</Link>
      </Button>
    </div>
  );
}
