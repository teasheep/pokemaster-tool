import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-shell";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getGymContext } from "@/lib/gym/queries";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { battleStatusFromDates } from "@/lib/gym/types";
import { BattlesIndexClient, type BattleListItem } from "../battles-index-client";
import { CreateBattleButton } from "../create-battle-button";
import type { Database } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * 道館戰一覽 (先看清單, 每場可展開看關卡與戰果, 再點進單場看板)。
 * 路徑是 /gyms/[id]/battles — 道館根路徑預設進「成員與拍組」(使用者指定)。
 *
 * 效能: 這頁原本跑四輪循序查詢 (context → battles → stages/logs → 戰力矩陣),
 * 每輪都要一次往返 ≈ 2 秒。現在只剩兩輪, 屬性戰力矩陣改成展開時才由 client 抓
 * (它要讀 2000+ 列, 不該擋著整頁)。
 */
export default async function BattlesIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?redirect=/gyms/${id}/battles`);
  }

  // 第一輪: 道館脈絡與賽事清單同時抓 (原本 context 抓完才抓 battles)
  const [{ gym, viewer }, { data: battles }] = await Promise.all([
    getGymContext(id),
    supabase
      .from("gym_battles")
      .select("id, name, starts_on, ends_on, summary")
      .eq("gym_id", id),
  ]);
  if (!gym || !viewer) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold">找不到道館或你不是成員</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          向管理員索取邀請碼, 然後從道館列表加入。
        </p>
        <Button asChild className="mt-4">
          <Link href="/gyms">回道館列表</Link>
        </Button>
      </div>
    );
  }

  // 第二輪: 關卡與出戰紀錄 (需要賽事 id)
  //
  // **跨全部賽事的 .in() 一定要分頁全量**: PostgREST 單次最多回 1000 列, 而且不報錯 —
  // 這兩支的列數隨「辦過幾場」線性成長, 少拿的後果是每張賽事卡上的
  // 「X 人參戰・使用 Y 張」默默變小, 畫面看起來完全正常 (前科同款: member_pairs
  // 破 2000 列時拿到「剛好 1000 列」)。實測一場打滿的賽事 = 290 列 battle_logs
  // (596 張券 / 20 人 / 平均一列 2 張), 所以第 4 場開始就會截斷。
  //
  // 兩支都補穩定排序: offset 分頁在讀取期間有人回報新紀錄會讓列位移, 邊界重複的列
  // 會被 tickets 再加一次 (人數走 Set 不受影響, 但券數會多算)。battle_stages 的
  // seq 在跨賽事時不唯一, 所以 seq 之後再接 id 當唯一決勝 —— 每場關卡仍照 seq 升冪,
  // 畫面順序不變。
  const ids = (battles ?? []).map((b) => b.id);
  type StageRow = Pick<
    Database["public"]["Tables"]["battle_stages"]["Row"],
    "id" | "battle_id" | "seq" | "weak_type"
  >;
  type LogRow = Pick<
    Database["public"]["Tables"]["battle_logs"]["Row"],
    "battle_id" | "stage_id" | "member_id" | "tickets_used"
  >;
  const [stages, logs] = ids.length
    ? await Promise.all([
        fetchAllRows<StageRow>((a, b) =>
          supabase
            .from("battle_stages")
            .select("id, battle_id, seq, weak_type")
            .in("battle_id", ids)
            .order("seq")
            .order("id")
            .range(a, b)
        ),
        fetchAllRows<LogRow>((a, b) =>
          supabase
            .from("battle_logs")
            .select("battle_id, stage_id, member_id, tickets_used")
            .in("battle_id", ids)
            .order("id")
            .range(a, b)
        ),
      ])
    : [[] as StageRow[], [] as LogRow[]];

  // 每關的戰果 (出刀券數) — 展開時看得到「這關打成怎樣」, 不是只有屬性
  const perStage = new Map<string, number>();
  const totalsByBattle = new Map<string, { tickets: number; members: Set<string> }>();
  for (const l of logs) {
    if (l.stage_id) {
      perStage.set(l.stage_id, (perStage.get(l.stage_id) ?? 0) + (l.tickets_used ?? 0));
    }
    if (!totalsByBattle.has(l.battle_id))
      totalsByBattle.set(l.battle_id, { tickets: 0, members: new Set() });
    const t = totalsByBattle.get(l.battle_id)!;
    t.tickets += l.tickets_used ?? 0;
    t.members.add(l.member_id);
  }

  const stagesByBattle = new Map<string, BattleListItem["stages"]>();
  for (const s of stages) {
    if (!stagesByBattle.has(s.battle_id)) stagesByBattle.set(s.battle_id, []);
    stagesByBattle.get(s.battle_id)!.push({
      seq: s.seq,
      weakType: s.weak_type,
      tickets: perStage.get(s.id) ?? 0,
    });
  }

  // 進行中最前, 其餘依賽期新→舊 (匯入的第一/二次賽期較早, 要排在後面)
  // 狀態由賽期日期推導 (battleStatusFromDates), 不讀 DB 的 status 欄
  const order = (s: string) => (s === "active" ? 0 : s === "planning" ? 1 : 2);
  const when = (b: { starts_on: string | null }) => b.starts_on ?? "";
  const items: BattleListItem[] = (battles ?? [])
    .map((b) => ({ ...b, status: battleStatusFromDates(b.starts_on, b.ends_on) }))
    .sort((a, b) => order(a.status) - order(b.status) || when(b).localeCompare(when(a)))
    .map((b) => {
      const t = totalsByBattle.get(b.id);
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        startsOn: b.starts_on,
        endsOn: b.ends_on,
        summary: b.summary,
        stages: stagesByBattle.get(b.id) ?? [],
        totals: t ? { tickets: t.tickets, participants: t.members.size } : null,
      };
    });

  return (
    <>
      <PageHeading
        title="道館戰"
        action={viewer.isAdmin ? <CreateBattleButton gymId={id} /> : null}
      />
      <BattlesIndexClient gymId={id} battles={items} isAdmin={viewer.isAdmin} />
    </>
  );
}
