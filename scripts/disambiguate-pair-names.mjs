#!/usr/bin/env node
/**
 * 同名拍組補形態名 — 管線的最後一步。
 *
 * 為什麼在最後: 同一位訓練家 + 同一隻寶可夢真的可能有兩對拍組 (鳴依（學院）& 四季鹿的
 * 春/夏是兩對, 可以同時上場)。名字一模一樣使用者分不出來, 所以要補上官方形態名;
 * 但前面每一個階段 (pomatools 日期/系列、wiki EX、reconcile) 都是**用名字比對**的,
 * 太早改名會讓它們對不到來源 (前科: 一改就掉了 acquisitions, 還配到別人的上架日)。
 *
 * 只在真的撞名、且形態名分得開時才加, 不然會長出「胡帕（懲戒胡帕）」這種蠢名字。
 * 冪等: 已經帶括號的不會再加一層。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const brybryDir = join(repoRoot, "src", "data", "brybry");
const catalogPath = join(repoRoot, "src", "data", "pomatools-pairs.json");

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const fzh = readJson(join(brybryDir, "monster_form_zh-TW.json"), {});
const fen = readJson(join(brybryDir, "monster_form_en.json"), {});

const file = JSON.parse(readFileSync(catalogPath, "utf8"));
const records = file.records;

const byName = new Map();
for (const r of records) {
  const key = `${r.trainerName}|${r.pokemonName}`;
  (byName.get(key) ?? byName.set(key, []).get(key)).push(r);
}

let renamed = 0;
const skipped = [];
for (const [key, list] of byName) {
  if (list.length < 2) continue;
  const forms = list.map((r) => (r.formId ? fzh[String(r.formId)] : null));
  // 形態名要齊全且互不相同, 否則加了也分不開 — 留著讓稽核報告去抓
  if (forms.some((f) => !f) || new Set(forms).size !== list.length) {
    skipped.push(`${key} ×${list.length} (形態名: ${forms.map((f) => f ?? "無").join(" / ")})`);
    continue;
  }
  for (const r of list) {
    const zh = fzh[String(r.formId)];
    const en = fen[String(r.formId)];
    if (zh && r.pokemonNameZh && !r.pokemonNameZh.includes("（")) r.pokemonNameZh = `${r.pokemonNameZh}（${zh}）`;
    if (en && !r.pokemonName.includes("(")) r.pokemonName = `${r.pokemonName} (${en})`;
    renamed++;
  }
}

writeFileSync(catalogPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
console.log(`同名拍組補形態名: ${renamed} 筆`);
for (const s of skipped) console.warn(`  ⚠ 仍然同名 (形態名分不開): ${s}`);
