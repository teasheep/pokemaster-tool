#!/usr/bin/env node
// 修正 member_pairs / gym_pairs 中「阿爾套裝卡露妮/也慈」被解析成本體 pair_id 的資料
// (匯入時名稱對照撞名 — 與 catalog 端同一根源)。冪等可重跑。
import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// label → 正確 pairId (阿爾套裝變體)
const FIXES = [
  ["阿爾套裝卡露妮&沙奈朵", "10158900000"],
  ["阿爾套裝也慈&晶光花", "10295900000"],
];

for (const [label, pairId] of FIXES) {
  for (const table of ["member_pairs", "gym_pairs"]) {
    const { rowCount } = await client.query(
      `update public.${table} set pair_id = $1 where pair_label = $2 and pair_id <> $1`,
      [pairId, label]
    );
    console.log(`${table} 「${label}」 → ${pairId}: ${rowCount} 列`);
  }
}

// 驗證: 不應再有同 (member_id, pair_id) 多列
const { rows } = await client.query(`
  select member_id, pair_id, count(*) as n from public.member_pairs
  where pair_id is not null group by member_id, pair_id having count(*) > 1
`);
console.log("殘留重複組數:", rows.length);
await client.end();
