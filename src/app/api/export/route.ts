import { NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@supabase/supabase-js";

import { roleAssetToRole } from "@/data/sync-pairs";
import { battleStatusFromDates } from "@/lib/gym/types";
import { loadPairsById } from "@/lib/pairs/loader";
import type { Database } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/** 匯出用的對戰紀錄投影 (= 下面那支 select 的欄位清單, 兩邊一起改) */
type BattleLogRow = Pick<
  Database["public"]["Tables"]["battle_logs"]["Row"],
  "stage_id" | "member_id" | "round" | "role" | "tickets_used"
>;

/**
 * 個人資料匯出 (唯讀) — 給外部 AI 算排刀與資源分配。
 *
 *   GET /api/export        Authorization: Bearer <個人金鑰>   ← 建議
 *   GET /api/export?key=<個人金鑰>                            ← 相容, 不會拔掉
 *
 * 範圍 = 這把金鑰的主人看得到的東西: 他加入的每一個道館 (成員或顧問都算) 的
 * 成員練度/糖果/剩餘券/道館拍組/隊伍/進行中賽事, 加上他自己的收藏。
 * 不含 email、auth uid、邀請碼。
 */

/**
 * 取金鑰: 標頭優先, 網址參數次之。
 * 為什麼要有標頭這條 — 網址裡的 query 會進 Cloudflare 存取記錄、瀏覽器歷史,
 * 以及使用者把網址貼給 AI 工具的那段對話; 標頭這三個地方都不會留。
 * 為什麼 ?key= 不能拔 — 這是既有對外功能, 使用者可能早就把網址存在別的工具裡了。
 */
/**
 * 金鑰候選, 依偏好排序。**回傳陣列而不是單一值**是刻意的:
 * 標頭若無條件優先, 一個「本來會成功」的舊 ?key= 網址, 只要客戶端自己帶了不相干的
 * Authorization (代理伺服器、瀏覽器擴充、公司網路都可能加) 就會從 200 變 403,
 * 而且錯誤訊息還會指向使用者的金鑰。改成兩個都試, 標頭先。
 */
function readKeys(req: Request): string[] {
  const out: string[] = [];
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) out.push(bearer);
  const url = new URL(req.url);
  const fromQuery = (url.searchParams.get("key") ?? url.searchParams.get("token"))?.trim();
  if (fromQuery && fromQuery !== bearer) out.push(fromQuery);
  return out;
}

export async function GET(req: Request) {
  const keys = readKeys(req);
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "缺少金鑰: 用標頭 Authorization: Bearer <金鑰>, 或網址 ?key=<金鑰>" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "伺服器未設定" }, { status: 500 });
  }
  // service role: 金鑰本身就是授權憑證, 查到誰就只輸出「那個人看得到的」
  const db = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 依序試候選 (通常只有一個; 兩個都給時標頭先)。第一個查得到人的就是它。
  let owner: { id: string; display_name: string | null } | null = null;
  for (const candidate of keys) {
    const { data } = await db
      .from("profiles")
      .select("id, display_name")
      .eq("export_token", candidate)
      .maybeSingle();
    if (data) { owner = data; break; }
  }
  if (!owner) return NextResponse.json({ error: "key 無效" }, { status: 403 });

  const [{ data: myMemberships }, { data: myCollection }, catalog] = await Promise.all([
    db.from("gym_members").select("id, gym_id, role").eq("user_id", owner.id),
    db
      .from("user_collection")
      .select("pair_id, promotion, potential, super_awakening, ex_unlocked, level")
      .eq("user_id", owner.id)
      .eq("owned", true),
    loadPairsById(),
  ]);

  /** pair_id → 圖鑑資料 (屬性/角色/星級) — AI 不用再自己查一份 catalog */
  const pairInfo = (pairId: string | null, label: string) => {
    const rec = pairId ? catalog.get(pairId) : undefined;
    if (!rec) return { pairId, name: label };
    return {
      pairId,
      name: `${rec.trainerNameZh ?? rec.trainerName} & ${rec.pokemonNameZh ?? rec.pokemonName}`,
      type: rec.type,
      role: roleAssetToRole(rec.roleAsset) ?? null,
      baseStar: rec.basePotential,
      canSixEx: rec.hasSixEx ?? false,
      canSuperAwaken: rec.hasAwakening ?? false,
    };
  };

  const gymIds = [...new Set((myMemberships ?? []).map((m) => m.gym_id))];
  const roleIn = new Map((myMemberships ?? []).map((m) => [m.gym_id, m.role]));

  const gyms = [];
  for (const gymId of gymIds) {
    const [
      { data: gym },
      { data: members },
      memberPairs,
      { data: candies },
      typeFocus,
      { data: gymPairs },
      { data: teams },
      { data: teamPairs },
      { data: battles },
    ] = await Promise.all([
      db.from("gyms").select("name").eq("id", gymId).maybeSingle(),
      db.from("gym_members").select("id, display_name, role, availability").eq("gym_id", gymId).order("display_name"),
      // 全館持有 — 超過 1000 列 (線上實測 2055), 分頁全量。
      // order("id") 是 offset 分頁的穩定排序: 沒有它, 讀取期間有人改練度就會讓
      // 列位移, 頁與頁的邊界可能重複或漏 (重複 = 同一個人的同一張卡輸出兩次)。
      // id 是 uuid 主鍵 = 唯一全序; 輸出順序本來就由消費端自己分組, 排序改變不影響語意。
      fetchAllRows((a, b) =>
        db
          .from("member_pairs")
          .select("member_id, pair_id, pair_label, grade, super_awakening")
          .eq("gym_id", gymId)
          .gte("grade", 1)
          .order("id")
          .range(a, b)
      ),
      db.from("member_candies").select("member_id, candy_type, count").eq("gym_id", gymId),
      // 屬性資源方向 (0056) — 每人最多 2×18 列, 28 人就會頂到 PostgREST 的 1000 列上限,
      // 而截斷是靜默的 (少的人看起來就像「沒選」) → 一律分頁。
      fetchAllRows((a, b) =>
        db
          .from("member_type_focus")
          .select("member_id, kind, type")
          .eq("gym_id", gymId)
          .order("id")
          .range(a, b)
      ),
      db.from("gym_pairs").select("pair_id, pair_label").eq("gym_id", gymId),
      db.from("gym_teams").select("id, name, type, tag, note").eq("gym_id", gymId),
      db.from("gym_team_pairs").select("team_id, pair_id, min_grade, slot").eq("gym_id", gymId),
      db
        .from("gym_battles")
        .select("id, name, starts_on, ends_on")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (!gym) continue;

    // 狀態由賽期日期推導 (與站內一致); 排刀 (stage_assignments) 已移除, 不再輸出。
    // 沒有進行中的就給「最近開賽」的一場 (created_at 會被後補匯入的舊賽事干擾)
    const byStart = [...(battles ?? [])].sort((a, b) =>
      (b.starts_on ?? "").localeCompare(a.starts_on ?? "")
    );
    const active =
      byStart.find((b) => battleStatusFromDates(b.starts_on, b.ends_on) === "active") ?? byStart[0];
    // battle_stages (一場 8 關) 與 member_tickets (一場一人一列, 20 列) 都遠低於
    // PostgREST 的 1000 列上限 → 單發即可。battle_logs 不是: 一列 = 一次回報,
    // 而回報次數沒有硬上限 (券上限 cap 可調到 99, 且 tickets_used=0 的紀錄也會插列),
    // 線上實測一場打滿是 290 列, 但 20 人 × 99 券就破 1000 —— 截斷是靜默的, 匯出給 AI
    // 的資料會少掉一截而看不出來, 所以這支分頁全量 (order("id") = offset 分頁的穩定排序)。
    const [{ data: stages }, logs, { data: tickets }] = active
      ? await Promise.all([
          db.from("battle_stages").select("id, seq, weak_type").eq("battle_id", active.id).order("seq"),
          fetchAllRows<BattleLogRow>((a, b) =>
            db
              .from("battle_logs")
              .select("stage_id, member_id, round, role, tickets_used")
              .eq("battle_id", active.id)
              .order("id")
              .range(a, b)
          ),
          db.from("member_tickets").select("member_id, remaining, cap").eq("battle_id", active.id),
        ])
      : [{ data: [] }, [] as BattleLogRow[], { data: [] }];

    const candyByMember = new Map<string, Record<string, number>>();
    for (const c of candies ?? []) {
      const m = candyByMember.get(c.member_id) ?? {};
      m[c.candy_type] = c.count;
      candyByMember.set(c.member_id, m);
    }
    const focusByMember = new Map<string, { want: string[]; invested: string[] }>();
    for (const f of typeFocus) {
      const m = focusByMember.get(f.member_id) ?? { want: [], invested: [] };
      if (f.kind === "want" || f.kind === "invested") m[f.kind].push(f.type);
      focusByMember.set(f.member_id, m);
    }
    const ticketByMember = new Map(
      (tickets ?? []).map((t) => [t.member_id, { remaining: t.remaining, cap: t.cap }])
    );

    gyms.push({
      name: gym.name,
      myRole: roleIn.get(gymId) ?? null,
      members: (members ?? []).map((m) => ({
        id: m.id,
        name: m.display_name,
        role: m.role,
        availability: m.availability,
        /** 挑戰券「剩餘 / 上限」(0043) — 未發券為 null */
        tickets: ticketByMember.get(m.id) ?? null,
        candies: candyByMember.get(m.id) ?? {},
        /** 屬性資源方向 (0056): want = 想投入, invested = 已投入較多 */
        typeFocus: focusByMember.get(m.id) ?? { want: [], invested: [] },
        pairs: memberPairs
          .filter((p) => p.member_id === m.id)
          .map((p) => ({
            ...pairInfo(p.pair_id, p.pair_label),
            grade: p.grade,
            superAwakening: p.super_awakening,
          })),
      })),
      gymPairs: (gymPairs ?? []).map((g) => pairInfo(g.pair_id, g.pair_label)),
      teams: (teams ?? []).map((t) => ({
        name: t.name,
        type: t.type,
        tag: t.tag,
        note: t.note,
        pairs: (teamPairs ?? [])
          .filter((tp) => tp.team_id === t.id)
          .sort((a, b) => a.slot - b.slot)
          .map((tp) => ({ ...pairInfo(tp.pair_id, tp.pair_id), minGrade: tp.min_grade })),
      })),
      battle: active
        ? {
            name: active.name,
            status: battleStatusFromDates(active.starts_on, active.ends_on),
            // 目前輪由出戰紀錄推導 (最大已回報輪), 與看板同一套邏輯
            currentRound: Math.max(1, ...logs.map((l) => l.round ?? 0)),
            startsOn: active.starts_on,
            endsOn: active.ends_on,
            stages: (stages ?? []).map((s) => ({
              seq: s.seq,
              weakType: s.weak_type,
              logs: logs
                .filter((l) => l.stage_id === s.id)
                .map((l) => ({
                  memberId: l.member_id,
                  round: l.round,
                  role: l.role,
                  ticketsUsed: l.tickets_used,
                })),
            })),
          }
        : null,
    });
  }

  return NextResponse.json(
    {
      // grade 0-10 (0038): 0 = 未持有, 1-5 = 寶1-寶5, 6-10 = 超覺醒1-5
      owner: { name: owner.display_name },
      generatedAt: new Date().toISOString(),
      me: {
        pairs: (myCollection ?? []).map((c) => ({
          ...pairInfo(c.pair_id, c.pair_id),
          star: c.promotion,
          level: c.level,
          potential: c.potential,
          superAwakening: c.super_awakening,
          sixEx: c.ex_unlocked,
        })),
      },
      gyms,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
