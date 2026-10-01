// 拍組跟著帳號走 (0080, 2026-10-01 使用者:「拍組應該是跟著 google 帳號, 不會因為道館離開加入而被影響」)。
//
// 這幾個壞法全都沒有徵兆: 轉館的人在新道館裡一張卡都沒有 (軒: 帳號 439 張, 新道館 0 張);
// 道館裡的等級 / 星數跟本人的拍組頁對不上 (他手動重點的 87 張全是 Lv1 / 星數空白);
// 移出成員時紀錄冒出「管理員把他的練度全部歸 0」(哲爸: 一次 138 筆), 而他帳號裡一張都沒少。
//
// SQL 一律看「全部 migration 裡最後一次的定義」—— 這三支 trigger 函式改過很多次
// (log_member_pair_change: 0019/0026/0027/0080), 下一次有人從舊版改起, 測試要能抓到。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mirrorLabels } from "@/lib/pairs/mirror-labels";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const MIGRATIONS = "supabase/migrations";
const migrationFiles = fs.readdirSync(path.join(process.cwd(), MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();

/** 全部 migration 裡最後一次 `create or replace function public.<name>(` 的本體 (到收尾的 `$$;`) */
function latestFunction(name: string): string {
  let found: string | null = null;
  for (const file of migrationFiles) {
    const text = read(path.join(MIGRATIONS, file));
    const needle = `create or replace function public.${name}(`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      const end = text.indexOf("$$;", text.indexOf("$$", at + needle.length) + 2);
      found = text.slice(at, end < 0 ? text.length : end + 3);
      from = at + needle.length;
    }
  }
  if (!found) throw new Error(`migrations 裡找不到 ${name}`);
  return found;
}

/** member_pairs 的所有欄位 (建表 + 之後每一次 add column) —— 與 member-pair-axis.test.ts 同一個掃法 */
function memberPairsColumns(): Set<string> {
  const cols = new Set<string>();
  const create = read(`${MIGRATIONS}/0005_gyms.sql`);
  const start = create.indexOf("create table public.member_pairs");
  for (const line of create.slice(start, create.indexOf(");", start)).split("\n").slice(1)) {
    const m = /^\s{2}([a-z_]+)\s/.exec(line);
    if (m) cols.add(m[1]!);
  }
  for (const f of migrationFiles) {
    for (const m of read(path.join(MIGRATIONS, f)).matchAll(/add column\s+(?:if not exists\s+)?([a-z_]+)/gi)) {
      // 只收 member_pairs 的: 往回找最近的 alter table
      const sql = read(path.join(MIGRATIONS, f));
      const before = sql.slice(0, m.index);
      const table = /alter table (?:if exists )?public\.([a-z_]+)[^;]*$/i.exec(before)?.[1];
      if (table === "member_pairs") cols.add(m[1]!);
    }
  }
  return cols;
}

describe("送進 RPC 的 pair_label", () => {
  const byId = new Map([
    ["a", { trainerName: "Red", pokemonName: "Pikachu", trainerNameZh: "赤紅", pokemonNameZh: "皮卡丘" }],
    ["b", { trainerName: "Blue", pokemonName: "Pidgeot", trainerNameZh: undefined, pokemonNameZh: undefined }],
  ]);
  it("與 pairLabel() 同一個寫法 (緊湊「人名&寶可夢名」, 唯一鍵靠它)", () => {
    expect(mirrorLabels(["a", "b"], byId)).toEqual([
      { pair_id: "a", label: "赤紅&皮卡丘" },
      { pair_id: "b", label: "Blue&Pidgeot" },
    ]);
  });
  it("圖鑑查不到的跳過、重複的只留一個", () => {
    expect(mirrorLabels(["a", "zzz", "a"], byId)).toEqual([{ pair_id: "a", label: "赤紅&皮卡丘" }]);
  });
});

describe("backfill_my_member_pairs (最新定義)", () => {
  const rpc = latestFunction("backfill_my_member_pairs");

  it("只能同步自己、而且要算道館的一員 (顧問 / 待確認不算)", () => {
    expect(rpc).toMatch(/where id = p_member and user_id = auth\.uid\(\)/);
    expect(rpc).toMatch(/not public\.member_counts_in_gym\(p_member\)/);
  });
  it("練度讀帳號 (user_collection), 不信呼叫端傳的值; 寶0 不留鏡像列", () => {
    expect(rpc).toMatch(/from public\.user_collection c/);
    expect(rpc).toMatch(/c\.user_id = auth\.uid\(\)/);
    // update 與 insert 兩段都要有「持有而且寶數 > 0」
    expect(rpc.match(/c\.owned\s+and \(c\.potential > 0 or c\.super_awakening > 0\)/g)?.length).toBe(2);
  });
  it("既有的列對齊帳號, 缺的才補 (以 pair_id 判斷), 不刪", () => {
    expect(rpc).toMatch(/update public\.member_pairs mp/);
    expect(rpc).toMatch(/is distinct from/);
    expect(rpc).toMatch(/not exists \(\s*select 1 from public\.member_pairs mp where mp\.member_id = p_member and mp\.pair_id = c\.pair_id/);
    expect(rpc).toMatch(/on conflict \(member_id, pair_label\) do nothing/);
    expect(rpc).not.toMatch(/delete from public\.member_pairs/);
  });
  it("label 在 SQL 端以 pair_id 去重, 非陣列的 p_labels 不會丟例外", () => {
    expect(rpc).toMatch(/select distinct on \(x\.pair_id\)/);
    expect(rpc).toMatch(/jsonb_typeof\(p_labels\) = 'array'/);
  });
  it("同步不寫進道館紀錄: 開關在寫入之前打開、之後才關", () => {
    const on = rpc.indexOf("set_config('pm.mirror_backfill', 'on', true)");
    const upd = rpc.indexOf("update public.member_pairs");
    const ins = rpc.indexOf("insert into public.member_pairs");
    const off = rpc.indexOf("set_config('pm.mirror_backfill', '', true)");
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(upd);
    expect(upd).toBeLessThan(ins);
    expect(ins).toBeLessThan(off);
  });
  it("member_pairs 的每一條練度軸都有同步到 (新增一條軸忘了這裡 = 轉館的人那一欄永遠是預設值)", () => {
    const skip = new Set(["id", "gym_id", "member_id", "pair_label", "pair_id", "created_at", "updated_at", "unique"]);
    const axes = [...memberPairsColumns(), "notes"].filter((c) => !skip.has(c));
    const insAt = rpc.indexOf("insert into public.member_pairs (");
    const insertCols = rpc.slice(insAt, rpc.indexOf(")", insAt));
    const updateSet = rpc.slice(rpc.indexOf("update public.member_pairs"), rpc.indexOf("from acct a"));
    for (const col of axes) {
      expect(insertCols, `insert 少了 ${col}`).toContain(col);
      expect(updateSet, `update 少了 ${col}`).toMatch(new RegExp(`\\b${col} = a\\.${col}\\b`));
    }
  });
  it("anon 拿不到執行權", () => {
    expect(read(`${MIGRATIONS}/0080_pairs_follow_account.sql`)).toMatch(
      /revoke all on function public\.backfill_my_member_pairs\(uuid, jsonb\) from public, anon/
    );
  });
});

describe("紀錄 trigger (最新定義)", () => {
  const GUC = /if coalesce\(current_setting\('pm\.mirror_backfill', true\), ''\) = 'on' then\s+return new;/;
  const GONE = /if not exists \(select 1 from public\.gym_members where id = old\.member_id\) then\s+return old;/;

  it("拍組: 從帳號同步的 insert / update 不記", () => {
    const fn = latestFunction("log_member_pair_change");
    const ins = fn.slice(fn.indexOf("if tg_op = 'INSERT'"), fn.indexOf("elsif tg_op = 'UPDATE'"));
    const upd = fn.slice(fn.indexOf("elsif tg_op = 'UPDATE'"), fn.indexOf("\n  else"));
    expect(ins).toMatch(GUC);
    expect(upd).toMatch(GUC);
  });
  it("拍組 / 糖果 / 出戰: 成員已經被移出 (cascade) 時不記刪除 —— 守門在刪除那一段", () => {
    const pair = latestFunction("log_member_pair_change");
    expect(pair.slice(pair.indexOf("\n  else"))).toMatch(GONE);
    const candy = latestFunction("log_candy_change");
    expect(candy.slice(candy.indexOf("if tg_op = 'DELETE'"), candy.indexOf("if tg_op = 'INSERT' or"))).toMatch(GONE);
    const battle = latestFunction("log_battle_log_change");
    expect(battle.slice(battle.indexOf("\n  else"))).toMatch(GONE);
  });
  it("守門之外的行為沒有被拿掉 (成員還在時照樣記)", () => {
    const pair = latestFunction("log_member_pair_change");
    expect(pair).toMatch(/old\.grade::text, null\);\s+return old;/);
    expect(latestFunction("log_candy_change")).toMatch(/perform public\.log_activity\(old\.gym_id, old\.member_id, 'candy'/);
    expect(latestFunction("log_battle_log_change")).toMatch(/v_round, old\.tickets_used::text, null\);/);
  });
});

describe("什麼時候同步", () => {
  const nav = read("src/app/gyms/[id]/gym-nav.tsx");
  const pairsPage = read("src/app/pairs/page.tsx");
  const members = read("src/app/gyms/[id]/members/page.tsx");
  const lib = read("src/lib/gym/backfill-pairs.ts");

  it("進任何一個道館分頁 (含看板深連結) 與 /pairs 都會排程", () => {
    expect(nav).toMatch(/await scheduleMyPairsBackfill\(/);
    expect(pairsPage).toMatch(/await scheduleMyPairsBackfill\(/);
  });
  it("/pairs 的排程在 gymSync 算完之後 (萬一丟例外也不能讓 gymSync 落空)", () => {
    expect(pairsPage.indexOf("await scheduleMyPairsBackfill(")).toBeGreaterThan(pairsPage.indexOf("isGymAdmin = active.isAdmin"));
  });
  it("成員頁: 自己的卡有缺就先同步完再畫, 不交給 after() (第一次打開不可以是灰卡)", () => {
    expect(members).toMatch(/await syncMyMirror\(supabase, \[mirrorMe\], myOwned\)/);
    expect(members).toMatch(/grades = await fetchGymGrades\(id\)/);
    expect(members).not.toMatch(/scheduleMyPairsBackfill/);
  });
  it("排程與同步都不丟例外; client 在 after() 之前建好 (Server Component 的 after 裡不能讀 cookies)", () => {
    expect(lib).toMatch(/^import "server-only";/);
    const sched = lib.slice(lib.indexOf("export async function scheduleMyPairsBackfill"));
    expect(sched.indexOf("try {")).toBeLessThan(sched.indexOf("await createClient()"));
    expect(sched.indexOf("await createClient()")).toBeLessThan(sched.indexOf("after(async"));
    const sync = lib.slice(lib.indexOf("export async function syncMyMirror"), lib.indexOf("export async function scheduleMyPairsBackfill"));
    expect(sync).toMatch(/try \{[\s\S]*\} catch/);
  });
});
