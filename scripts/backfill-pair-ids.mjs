#!/usr/bin/env node
// member_pairs / gym_pairs 中 pair_id 為 null 的列 (匯入時 catalog 還沒有該拍組),
// 用 pair_label 對回現在的 catalog 補上 pair_id。冪等可重跑 — 新拍組入庫後跑一次。
import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const catalog = JSON.parse(
  readFileSync(new URL("../src/data/pomatools-pairs.json", import.meta.url), "utf8")
).records;

const norm = (s) => (s ?? "").normalize("NFKC").replace(/[\s＆&]+/g, "&").trim();
const byLabel = new Map();
for (const p of catalog) {
  const zh = p.trainerNameZh && p.pokemonNameZh ? `${p.trainerNameZh}&${p.pokemonNameZh}` : null;
  const en = `${p.trainerName}&${p.pokemonName}`;
  if (zh && !byLabel.has(norm(zh))) byLabel.set(norm(zh), p.pairId);
  if (!byLabel.has(norm(en))) byLabel.set(norm(en), p.pairId);
}

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

for (const table of ["member_pairs", "gym_pairs"]) {
  const { rows } = await c.query(
    `select id, pair_label from public.${table} where pair_id is null`
  );
  let fixed = 0;
  const misses = new Set();
  for (const r of rows) {
    const pid = byLabel.get(norm(r.pair_label));
    if (pid) {
      await c.query(`update public.${table} set pair_id = $1 where id = $2`, [String(pid), r.id]);
      fixed++;
    } else {
      misses.add(r.pair_label);
    }
  }
  console.log(`${table}: null pair_id ${rows.length} 列, 補上 ${fixed} 列`);
  if (misses.size) console.log(`  仍對不到:`, [...misses].join(", "));
}
await c.end();
