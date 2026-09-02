#!/usr/bin/env node
/**
 * 對 .env.local 的 DATABASE_URL 依序套用 supabase/migrations/*.sql。
 *   - 用 public._migrations 表記錄已套用的檔名, 重跑只會補新的 (冪等)。
 *   - 本地 stack (npx supabase start) 會自己套 migrations, 此腳本主要給
 *     「換新雲端專案」時一鍵重建 schema 用。
 * 用法: node scripts/setup-supabase.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const envText = readFileSync(join(repoRoot, ".env.local"), "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DB = env.DATABASE_URL;
if (!DB) {
  console.error("缺 env: DATABASE_URL (.env.local)");
  process.exit(1);
}

const isLocal = /127\.0\.0\.1|localhost/.test(DB);
const client = new pg.Client({
  connectionString: DB,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await client.connect();
console.log(`connected (${isLocal ? "local" : "remote"})`);

// 已套用紀錄表 (本地 stack 用 supabase CLI 自己的紀錄, 這表只給此腳本用)
await client.query(`
  create table if not exists public._migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);
const { rows: appliedRows } = await client.query(`select name from public._migrations`);
const applied = new Set(appliedRows.map((r) => r.name));

// _migrations 是空的 (本地 CLI 套過 / 復原的舊雲端專案) → 用「代表性表是否存在」推斷基準線,
// 避免對已有 schema 的 DB 重跑舊 migration (0001 的 create table 會直接爆)
if (applied.size === 0) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables where table_schema='public'`
  );
  const has = new Set(rows.map((r) => r.table_name));
  const { rows: saCol } = await client.query(
    `select 1 from information_schema.columns
     where table_schema='public' and table_name='user_pairs' and column_name='super_awakening'`
  );
  // 每份 migration 的「套用過就會存在」代表物
  const baseline = [];
  if (has.has("profiles")) baseline.push("0001");
  if (has.has("user_collection")) baseline.push("0002");
  // 0003 = user_pairs 加 super_awakening; user_pairs 已退役 (0004 跑過) 則視為不需要
  if (!has.has("user_pairs") || saCol.length > 0) baseline.push("0003");
  if (!has.has("user_pairs") && has.has("user_collection")) baseline.push("0004"); // 舊表已退役
  if (has.has("gyms")) baseline.push("0005");
  if (has.has("battle_logs")) baseline.push("0006");
  const { rows: lnCol } = await client.query(
    `select 1 from information_schema.columns
     where table_schema='public' and table_name='gym_members' and column_name='line_name'`
  );
  if (lnCol.length > 0) baseline.push("0007");
  if (has.has("gym_pairs")) baseline.push("0008");
  for (const f of listMigrations()) {
    if (baseline.some((p) => f.startsWith(p))) {
      await client.query(`insert into public._migrations (name) values ($1) on conflict do nothing`, [f]);
      applied.add(f);
      console.log(`基準線: ${f} 視為已套用 (schema 已存在)`);
    }
  }
}

function listMigrations() {
  return readdirSync(join(repoRoot, "supabase", "migrations"))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
}

let ran = 0;
for (const f of listMigrations()) {
  if (applied.has(f)) {
    console.log(`skip  ${f} (已套用)`);
    continue;
  }
  const sql = readFileSync(join(repoRoot, "supabase", "migrations", f), "utf-8");
  console.log(`apply ${f} (${sql.length} chars)...`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`insert into public._migrations (name) values ($1)`, [f]);
    await client.query("COMMIT");
    ran++;
    console.log(`  ✓ committed`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`  ✗ failed: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

// 驗證關鍵表
const CHECK = ["profiles", "user_collection", "shares", "gyms", "gym_members", "member_tickets"];
const { rows: tables } = await client.query(
  `select table_name from information_schema.tables where table_schema='public'`
);
const names = new Set(tables.map((r) => r.table_name));
console.log("\n驗證:");
for (const t of CHECK) console.log(`  ${names.has(t) ? "✓" : "✗"} ${t}`);

await client.end();
console.log(`\n完成 (${ran} 個新 migration)`);
