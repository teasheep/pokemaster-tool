#!/usr/bin/env node
/**
 * 清掉 catalog 裡「同一對拍組被 datamine 收成好幾筆」的重複紀錄。
 *
 * 來源: brybry datamine 對某些拍組會給多個 actor 變體 (ch00XX_00 / ch00XX_01) 或
 * 同一 actor 多筆條目; fandom wiki roster 才是「遊戲裡真的有幾對」的權威。
 * 判準: 同 (trainerName, pokemonName) 有多筆時, 保留 wiki roster 對到的那個 pairId
 * (wiki 沒對到就留最小的 pairId), 其餘刪除。
 *
 * 例外 (不是重複, 不要動):
 *   - 阿爾套裝 (_90) 與本體同 EN 名 — 是不同拍組 (series 不同)
 *   - 洛托姆/鹿子的形態變體 — wiki 本來就列成兩對
 *
 * 會一併輸出「舊 pairId → 保留的 pairId」對照表, 給 DB remap 用 (--db 直接改雲端)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const catalogPath = join(repoRoot, "src", "data", "pomatools-pairs.json");
const wikiPath = join(repoRoot, "src", "data", "wiki-ex-style.json");

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const wiki = JSON.parse(readFileSync(wikiPath, "utf8"));

/** wiki 對到的 pomaPairId 集合 = 「這個 id 是真的那一對」 */
const wikiIds = new Set(
  (wiki.roster ?? []).map((r) => r.pomaPairId).filter(Boolean).map(String)
);

/**
 * wiki 上同一對 (訓練家+寶可夢) 有幾列 — 形態變體 (鹿子的春/夏、洛托姆各形態)
 * 在 wiki 是兩列但可能都對到同一個 pomaPairId, 所以要看「列數」而不是「對到幾個 id」。
 * wiki 的寶可夢名帶形態 (Deerling (Spring Form) / Hoopa Confined), 用前綴比對。
 */
function wikiRowCount(trainerName, pokemonName) {
  const t = (trainerName ?? "").toLowerCase();
  const p = (pokemonName ?? "").toLowerCase();
  return (wiki.roster ?? []).filter(
    (r) =>
      (r.trainer ?? "").toLowerCase() === t &&
      (r.pokemon ?? "").toLowerCase().startsWith(p)
  ).length;
}

/** 同 EN 名但實際是不同拍組 — 用 series 區分, 不算重複 */
const isDistinctVariant = (a, b) => a.series !== b.series;

const groups = new Map();
for (const r of catalog.records) {
  const k = `${r.trainerName ?? ""}|${r.pokemonName ?? ""}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const remap = {};
const dropIds = new Set();
for (const [key, list] of groups) {
  if (list.length < 2) continue;
  // series 全都不同 → 是不同拍組 (阿爾套裝之類), 跳過
  if (list.every((r, i) => list.every((o, j) => i === j || isDistinctVariant(r, o)))) continue;
  // wiki 上本來就有多列 (形態變體) → 是真的多對, 跳過
  const rows = wikiRowCount(list[0].trainerName, list[0].pokemonName);
  if (rows >= list.length) continue;
  const known = list.filter((r) => wikiIds.has(String(r.pairId)));
  if (known.length > 1) continue;

  const keep = known[0] ?? [...list].sort((a, b) => String(a.pairId).localeCompare(String(b.pairId)))[0];
  for (const r of list) {
    if (r.pairId === keep.pairId) continue;
    remap[r.pairId] = keep.pairId;
    dropIds.add(r.pairId);
  }
  console.log(
    `重複: ${key} ×${list.length} → 保留 ${keep.pairId} (${keep.trainerId}), 刪除 ${list
      .filter((r) => r.pairId !== keep.pairId)
      .map((r) => r.pairId)
      .join(", ")}`
  );
}

const remapPath = join(repoRoot, "src", "data", "pair-id-remap.json");
if (dropIds.size === 0) {
  console.log("catalog 沒有重複紀錄。");
  // 已經清過了, 但雲端可能還沒搬 — 用上次留下的對照表繼續 (冪等)
  if (!process.argv.includes("--db")) process.exit(0);
  try {
    Object.assign(remap, JSON.parse(readFileSync(remapPath, "utf8")));
    console.log(`沿用既有對照表 (${Object.keys(remap).length} 筆) 檢查雲端資料`);
  } catch {
    process.exit(0);
  }
} else {
  catalog.records = catalog.records.filter((r) => !dropIds.has(r.pairId));
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`catalog: 刪除 ${dropIds.size} 筆 → 剩 ${catalog.records.length} 筆`);
  writeFileSync(remapPath, `${JSON.stringify(remap, null, 2)}\n`);
  console.log("對照表已寫入 src/data/pair-id-remap.json");
}

// ── 雲端資料的 pair_id 一併搬家 (--db) ──
if (!process.argv.includes("--db")) {
  console.log("(要同步改雲端資料請加 --db)");
  process.exit(0);
}
const { createClient } = await import("@supabase/supabase-js");
const env = {};
for (const line of readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// user_collection 有 (user_id,pair_id) 唯一鍵、member_pairs 有 (member_id,pair_label) —
// 撞到既有列就直接刪掉舊列 (保留使用者已經在維護的那一筆)
const TABLES = [
  { table: "user_collection", conflict: ["user_id"] },
  { table: "member_pairs", conflict: ["member_id"] },
  { table: "gym_pairs", conflict: ["gym_id"] },
  { table: "gym_team_pairs", conflict: [] },
];
for (const { table, conflict } of TABLES) {
  for (const [oldId, newId] of Object.entries(remap)) {
    const { data: rows, error } = await admin.from(table).select("*").eq("pair_id", oldId);
    if (error) {
      console.log(`  ${table}: 讀取失敗 ${error.message}`);
      break;
    }
    for (const row of rows ?? []) {
      let clash = null;
      if (conflict.length > 0) {
        let q = admin.from(table).select("id").eq("pair_id", newId);
        for (const c of conflict) q = q.eq(c, row[c]);
        const { data: ex } = await q.limit(1);
        clash = ex?.[0] ?? null;
      }
      if (clash) {
        await admin.from(table).delete().eq("id", row.id);
        console.log(`  ${table}: ${oldId} → 已有 ${newId}, 刪除重複列`);
      } else {
        await admin.from(table).update({ pair_id: newId }).eq("id", row.id);
        console.log(`  ${table}: ${oldId} → ${newId}`);
      }
    }
  }
}
console.log("雲端資料 remap 完成");
