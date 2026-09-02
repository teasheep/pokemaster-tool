// 2026-08-18 稽核後的一次性資料修正 (預設 dry-run, --apply 才寫入)。
// 依據: 稽核 workflow wf_0a10bc22 的 confirmed findings。動手前整批備份到 ref/。
//
//  1. gym_pairs.pair_label: 64 列匯入殘留格式 → 依 pair_id 用 catalog pairLabel() 重算
//  2. user_collection ↔ member_pairs drift 8 列: member_pairs 為準對齊 user_collection
//     (mp 是事故後手動還原過的一側; 全部列入報告供成員覆核)
//  3. gym_activity: 0038 換軸 backfill 噪音 (08-17 01:00-03:00 UTC, actor null, kind=pair)
//     + 08-14 測試殘渣 (actor null, kind=pair) → 刪除
//  4. member_tickets: 已結束賽事上「刪 log 退款」憑空生出的 remaining>0 → 歸零
//  5. gym_battles 第一/二次賽期 off-by-one → +1 天
//  6. battle_stages.leader_name 第三次的「X館」佔位字 → null (真館主名保留, 0047 drop 前備份)
//  7. stage_assignments 殘餘 4 列 (已結束賽事的未出戰排刀籤) → 刪除
//  8. gym_activity 2 筆 battle_log 的 target 「關1 R1」→ 統一用詞 (R1)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

const env = {};
for (const l of readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// pairLabel 與 src/lib/pairs/name.ts 同規則: 「人名&寶可夢名」(繁中優先)
const catalog = JSON.parse(readFileSync(path.join(root, "src/data/pomatools-pairs.json"), "utf8")).records;
const byId = new Map(catalog.map((p) => [p.pairId, p]));
const pairLabelOf = (p) =>
  `${p.trainerNameZh || p.trainerName || "???"}&${p.pokemonNameZh || p.pokemonName || "???"}`;

const backup = {};
const report = [];
const log = (s) => { console.log(s); report.push(s); };

// PostgREST 一次最多 1000 列 — 一律 range 分頁 (AGENTS 地雷)
async function all(table, sel, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(sel).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ── 1. gym_pairs.pair_label 正規化 ──
{
  const rows = await all("gym_pairs", "id, pair_id, pair_label", (q) => q.not("pair_id", "is", null));
  const fixes = [];
  for (const r of rows) {
    const c = byId.get(r.pair_id);
    if (!c) { log(`⚠ gym_pairs ${r.id}: pair_id ${r.pair_id} 不在 catalog, 跳過`); continue; }
    const want = pairLabelOf(c);
    if (r.pair_label !== want) fixes.push({ ...r, want });
  }
  log(`\n[1] gym_pairs.pair_label 需正規化: ${fixes.length} 列`);
  for (const f of fixes) log(`    ${f.pair_label}  →  ${f.want}`);
  backup.gym_pairs = fixes;
  if (APPLY) {
    for (const f of fixes) {
      const { error } = await db.from("gym_pairs").update({ pair_label: f.want }).eq("id", f.id);
      if (error) throw new Error(`gym_pairs ${f.id}: ${error.message}`);
    }
  }
}

// ── 2. user_collection ↔ member_pairs 對齊 (mp 為準) ──
{
  const members = await all("gym_members", "id, user_id, display_name", (q) => q.not("user_id", "is", null));
  const gradeOf = (pot, sa) => (sa > 0 ? 5 + sa : pot);
  const fixes = [];
  for (const m of members) {
    const [uc, mp] = await Promise.all([
      all("user_collection", "id, pair_id, potential, super_awakening", (q) => q.eq("user_id", m.user_id)),
      all("member_pairs", "id, pair_id, grade", (q) => q.eq("member_id", m.id)),
    ]);
    const mpBy = new Map(mp.filter((r) => r.pair_id).map((r) => [r.pair_id, r]));
    for (const u of uc) {
      if (!u.pair_id) continue;
      const p = mpBy.get(u.pair_id);
      const ucGrade = gradeOf(u.potential, u.super_awakening);
      const c = byId.get(u.pair_id);
      const name = c ? pairLabelOf(c) : u.pair_id;
      if (!p) {
        // uc=0 且 mp 無列 = 一致 (寶0 時 mp 刪列 by design), 不動;
        // uc>0 但 mp 無列 = drift (mp 被刪但 uc 沒歸零) → uc 歸零
        if (ucGrade > 0) {
          fixes.push({ kind: "zero-uc", member: m.display_name, name, ucId: u.id, ucGrade });
        }
      } else if (p.grade !== ucGrade) {
        const pot = p.grade >= 6 ? 5 : p.grade;
        const sa = p.grade >= 6 ? p.grade - 5 : 0;
        fixes.push({ kind: "set-uc", member: m.display_name, name, ucId: u.id, ucGrade, mpGrade: p.grade, pot, sa });
      }
    }
  }
  log(`\n[2] user_collection 對齊 member_pairs: ${fixes.length} 列 (mp 為準, 請成員覆核)`);
  for (const f of fixes)
    log(
      f.kind === "zero-uc"
        ? `    ${f.member}｜${f.name}: uc grade ${f.ucGrade} → 0 (mp 無此拍組)`
        : `    ${f.member}｜${f.name}: uc grade ${f.ucGrade} → ${f.mpGrade}`
    );
  backup.user_collection_fixes = fixes;
  if (APPLY) {
    for (const f of fixes) {
      const patch =
        f.kind === "zero-uc"
          ? { potential: 0, super_awakening: 0 }
          : { potential: f.pot, super_awakening: f.sa };
      const { error } = await db.from("user_collection").update(patch).eq("id", f.ucId);
      if (error) throw new Error(`uc ${f.ucId}: ${error.message}`);
    }
  }
}

// ── 3. gym_activity 遷移/測試噪音 ──
{
  const noise = await all("gym_activity", "id, kind, actor_id, created_at, target, new_value", (q) =>
    q.eq("kind", "pair").is("actor_id", null)
  );
  const inWindow = (t) =>
    (t >= "2026-08-17T01:00" && t < "2026-08-17T03:00") || t.startsWith("2026-08-14");
  const del = noise.filter((r) => inWindow(r.created_at));
  const keep = noise.length - del.length;
  log(`\n[3] gym_activity 噪音刪除: ${del.length} 列 (actor null + kind=pair, 08-17 01-03 UTC 與 08-14; 其餘 actor-null pair 列 ${keep} 列保留)`);
  backup.gym_activity_deleted = del;
  if (APPLY && del.length) {
    for (let i = 0; i < del.length; i += 100) {
      const ids = del.slice(i, i + 100).map((r) => r.id);
      const { error } = await db.from("gym_activity").delete().in("id", ids);
      if (error) throw new Error(`activity del: ${error.message}`);
    }
  }
}

// ── 4. member_tickets 幽靈券歸零 (已結束賽事, 由券帳與 log 對不上) ──
{
  const battles = await all("gym_battles", "id, name, ends_on");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const finished = battles.filter((b) => b.ends_on && b.ends_on < today);
  const fixes = [];
  for (const b of finished) {
    const t = await all("member_tickets", "id, member_id, remaining", (q) =>
      q.eq("battle_id", b.id).gt("remaining", 0)
    );
    // 已結束賽事理論剩券 = 帳面自然值; 稽核確認 >0 的列是刪 log 退款憑空生出 (或賽末沒歸零)
    for (const r of t) fixes.push({ battle: b.name, id: r.id, remaining: r.remaining });
  }
  log(`\n[4] 已結束賽事的殘餘券歸零: ${fixes.length} 列`);
  for (const f of fixes) log(`    ${f.battle}: remaining ${f.remaining} → 0`);
  backup.member_tickets = fixes;
  if (APPLY) {
    for (const f of fixes) {
      const { error } = await db.from("member_tickets").update({ remaining: 0 }).eq("id", f.id);
      if (error) throw new Error(`tickets ${f.id}: ${error.message}`);
    }
  }
}

// ── 5. 第一/二次賽期 off-by-one (+1 天) ──
{
  const want = [
    { match: "2026-02-19", starts_on: "2026-02-20", ends_on: "2026-02-27" },
    { match: "2026-04-02", starts_on: "2026-04-03", ends_on: "2026-04-10" },
  ];
  const battles = await all("gym_battles", "id, name, starts_on, ends_on");
  const fixes = [];
  for (const w of want) {
    const b = battles.find((x) => x.starts_on === w.match);
    if (b) fixes.push({ id: b.id, name: b.name, from: `${b.starts_on}~${b.ends_on}`, to: `${w.starts_on}~${w.ends_on}`, w });
  }
  log(`\n[5] 賽期 off-by-one 修正: ${fixes.length} 場`);
  for (const f of fixes) log(`    ${f.name}: ${f.from} → ${f.to}`);
  backup.gym_battles_dates = fixes;
  if (APPLY) {
    for (const f of fixes) {
      const { error } = await db
        .from("gym_battles")
        .update({ starts_on: f.w.starts_on, ends_on: f.w.ends_on })
        .eq("id", f.id);
      if (error) throw new Error(`battle dates ${f.id}: ${error.message}`);
    }
  }
}

// ── 6+7. leader_name 全量備份 + 排刀殘籤 — 0047 已 drop 欄位/表, 套用後自動略過
//        (備份已在 0047 之前的 dry-run 寫進 ref/archive-legacy-fix-2026-08-18.json)
{
  try {
    const stages = await all("battle_stages", "id, battle_id, seq, weak_type, leader_name");
    backup.battle_stages_leader = stages;
    const placeholder = stages.filter((s) => /^[^ ]{1,3}館$/.test(s.leader_name ?? ""));
    log(`\n[6] leader_name: 全 ${stages.filter((s) => s.leader_name).length} 筆已備份; 其中佔位「X館」${placeholder.length} 筆`);
  } catch {
    log("\n[6] leader_name 欄位已 drop (0047) — 略過 (備份已在先前 dry-run 寫入)");
  }
  try {
    const assigns = await all("stage_assignments", "*");
    backup.stage_assignments = assigns;
    log(`[7] stage_assignments 殘籤刪除: ${assigns.length} 列`);
    if (APPLY && assigns.length) {
      const { error } = await db.from("stage_assignments").delete().in("id", assigns.map((a) => a.id));
      if (error) throw new Error(`assignments del: ${error.message}`);
    }
  } catch {
    log("[7] stage_assignments 表已 drop (0047) — 略過");
  }
}

// ── 8. gym_activity battle_log target 用詞統一 ──
{
  const rows = await all("gym_activity", "id, target", (q) => q.eq("kind", "battle_log"));
  const fixes = rows
    .map((r) => {
      const m = (r.target ?? "").match(/^關\d+ R(\d+)$/);
      if (!m) return null;
      const n = Number(m[1]);
      return { id: r.id, from: r.target, to: n <= 3 ? `R${n}` : `Ex${n - 3}` };
    })
    .filter(Boolean);
  log(`\n[8] gym_activity battle_log target 統一: ${fixes.length} 列`);
  for (const f of fixes) log(`    「${f.from}」→「${f.to}」`);
  backup.gym_activity_battle_log = fixes;
  if (APPLY) {
    for (const f of fixes) {
      const { error } = await db.from("gym_activity").update({ target: f.to }).eq("id", f.id);
      if (error) throw new Error(`activity target ${f.id}: ${error.message}`);
    }
  }
}

const stamp = "2026-08-18";
const backupPath = path.join(root, "ref", `archive-legacy-fix-${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
log(`\n備份寫入 ${backupPath}`);
log(APPLY ? "== 已套用 ==" : "== dry-run (加 --apply 寫入) ==");
