#!/usr/bin/env node
/**
 * 把雲端資料裡舊的 pairId 換成 catalog 現在用的 pairId (拍組本身沒變, 只是 id 換了)。
 *
 * 什麼時候會用到: datamine 更新後同一對拍組的 id 換了 —
 *   - 佔位 id 讓位給正式 id (wiki-harmony-feraligatr → 10366000000)
 *   - 收錯 NPC/劇情版, 改收真正的可抽版 (鎯琊 & 胡帕 10066000001 → 10066010000)
 * 不做這件事的話, 成員的收藏/道館名單會指向 catalog 裡不存在的拍組 (灰卡、名字掉回英文)。
 *
 * 預設是 dry-run (只印計畫); 要真的寫入加 --apply。
 * 對照表: src/data/pair-id-remap.json (dedupe-catalog-pairs.mjs 也會寫這個檔)
 *
 * 同一個人/道館同時有新舊兩筆時: 保留數值較高的那筆, 刪掉另一筆 (不製造重複列)。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const require = createRequire(join(repoRoot, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const apply = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const remap = JSON.parse(readFileSync(join(repoRoot, "src", "data", "pair-id-remap.json"), "utf8"));
const catalog = JSON.parse(
  readFileSync(join(repoRoot, "src", "data", "pomatools-pairs.json"), "utf8")
).records;
const byId = new Map(catalog.map((r) => [r.pairId, r]));
const label = (id) => {
  const r = byId.get(id);
  return r ? `${r.trainerNameZh ?? r.trainerName} & ${r.pokemonNameZh ?? r.pokemonName}` : id;
};

// 對照表必須指向 catalog 真的有的 id, 否則只是把爛資料搬到另一個爛 id
const bad = Object.entries(remap).filter(([, to]) => !byId.has(to));
if (bad.length) {
  console.error("✖ 對照表的目標 id 不在 catalog 裡:", bad);
  process.exit(1);
}

/** 每張表: [表名, 這張表的「一列」在哪些欄位上唯一 (用來偵測撞列), 比大小的欄位] */
const TABLES = [
  ["user_collection", ["user_id"], "potential"],
  ["member_pairs", ["member_id"], "grade"],
  ["gym_pairs", ["gym_id", "type"], null],
  ["gym_team_pairs", ["team_id", "slot"], null],
  ["stage_plan_pairs", ["stage_id"], null],
];

let totalUpdate = 0;
let totalDelete = 0;

for (const [table, uniqCols, rankCol] of TABLES) {
  const { data, error } = await admin.from(table).select("*").in("pair_id", Object.keys(remap));
  if (error) {
    console.log(`${table}: 讀取失敗 — ${error.message}`);
    continue;
  }
  if (!data?.length) {
    console.log(`${table}: 沒有要改的列`);
    continue;
  }
  // 目標 id 已經存在的列 (避免 unique 撞)
  const { data: existing } = await admin
    .from(table)
    .select("*")
    .in("pair_id", [...new Set(Object.values(remap))]);
  const keyOf = (row, pairId) => [...uniqCols.map((c) => row[c]), pairId].join("|");
  const existingKeys = new Map((existing ?? []).map((r) => [keyOf(r, r.pair_id), r]));

  const updates = [];
  const deletes = [];
  for (const row of data) {
    const to = remap[row.pair_id];
    const clash = existingKeys.get(keyOf(row, to));
    if (!clash) {
      updates.push(row);
      continue;
    }
    // 撞列: 留數值高的
    const mine = rankCol ? (row[rankCol] ?? 0) : 0;
    const theirs = rankCol ? (clash[rankCol] ?? 0) : 0;
    if (mine > theirs) {
      deletes.push(clash); // 刪掉新 id 那筆較低的, 再把舊的搬過去
      updates.push(row);
      existingKeys.delete(keyOf(row, to));
    } else {
      deletes.push(row); // 新 id 那筆已經比較好 → 舊的直接刪
    }
  }

  console.log(
    `${table}: 命中 ${data.length} 列 → 改 id ${updates.length} 筆, 刪重複 ${deletes.length} 筆`
  );
  for (const row of updates.slice(0, 6)) {
    console.log(`    ${row.pair_id} → ${remap[row.pair_id]}  (${label(remap[row.pair_id])})`);
  }
  if (updates.length > 6) console.log(`    … 其餘 ${updates.length - 6} 筆同樣處理`);

  if (apply) {
    for (const row of deletes) {
      const { error: e } = await admin.from(table).delete().eq("id", row.id);
      if (e) console.error(`  ✖ 刪 ${table} ${row.id} 失敗: ${e.message}`);
      else totalDelete++;
    }
    for (const row of updates) {
      const patch = { pair_id: remap[row.pair_id] };
      if ("pair_label" in row) patch.pair_label = label(remap[row.pair_id]);
      const { error: e } = await admin.from(table).update(patch).eq("id", row.id);
      if (e) console.error(`  ✖ 改 ${table} ${row.id} 失敗: ${e.message}`);
      else totalUpdate++;
    }
  }
}

console.log(
  apply
    ? `\n✅ 已寫入: 改 ${totalUpdate} 筆 / 刪 ${totalDelete} 筆`
    : "\n(dry-run — 要真的寫入請加 --apply)"
);
