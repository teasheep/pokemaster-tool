#!/usr/bin/env node
/**
 * 用 wiki-ex-style.json (來自 fandom wiki, 權威) 補正 pomatools-pairs.json 的 EX 資料。
 *
 * 背景: pomatools 的 hasSixEx 實際只追到 ~303 隻 (其實對應 EX role 解鎖),
 *       但 wiki 顯示 598 隻可達 6★ EX、其中 438 隻有 EX style。
 *       此腳本把 wiki 的真實 EX style / 6★ EX / EX role 補進 pomatools 紀錄 (純新增欄位)。
 *
 * 新增/修正欄位 (對有對上 wiki 的紀錄):
 *   hasSixEx       — 修正為 wiki 真值 (可達 6★ EX)
 *   hasExStyle     — 新增: 6★ EX 是否附帶 EX style 換裝 (wiki * 標記者為 false)
 *   exStyleDate    — 新增: 6★ EX 解鎖日期
 *   exStyleImage   — 新增: wiki VS 立繪檔名
 *   exRoleName     — 新增: 人類可讀 EX role (e.g. "Tech"); 既有 exRole(ROLE_xxx) 不動
 *   exDataSource   — 新增: "wiki" / "none" 標記資料來源
 *
 * 用法: node scripts/enrich-pomatools-exstyle.mjs   (idempotent, 可重跑)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const dataDir = join(repoRoot, "src", "data");

const wiki = JSON.parse(readFileSync(join(dataDir, "wiki-ex-style.json"), "utf8"));
const pomaFile = JSON.parse(readFileSync(join(dataDir, "pomatools-pairs.json"), "utf8"));
const records = pomaFile.records;

// EX 立繪下載結果 (scripts/scrape-wiki-ex-portraits.mjs 產出); 可能尚未跑 → 容忍缺檔
let exPortraits = {};
try {
  exPortraits = JSON.parse(readFileSync(join(dataDir, "ex-portraits.json"), "utf8")).portraits ?? {};
} catch {
  console.warn("(ex-portraits.json 不存在, 先跳過 exStyleImagePath; 跑完 scrape-wiki-ex-portraits 再重跑)");
}

// EX 立繪路徑: 優先用「該 trainerId 自己的檔」(存在才用), 否則退回 portraits 對照表。
// portraits 對照表對同名多變體訓練家 (卡露妮 _00/_90 等) 可能指到錯的變體, 實檔優先可防呆。
const exPathFor = (trainerId, fallback) => {
  const exact = `/reference/trainer-ex/${trainerId}_ex.png`;
  return existsSync(join(repoRoot, "public", exact)) ? exact : (fallback ?? null);
};

// pomaPairId → wiki roster entry (一隻 pomatools 可能對到多個 wiki 形態列, OR 起來)
const wikiByPoma = new Map();
for (const r of wiki.roster) {
  if (!r.pomaPairId) continue;
  const prev = wikiByPoma.get(r.pomaPairId);
  if (!prev) {
    wikiByPoma.set(r.pomaPairId, r);
  } else {
    // 合併: 任一形態有 6★EX/style 就算有, 日期取較早
    prev.hasSixEx = prev.hasSixEx || r.hasSixEx;
    prev.hasExStyle = prev.hasExStyle || r.hasExStyle;
    prev.exRoleConfirmed = prev.exRoleConfirmed || r.exRoleConfirmed;
  }
}

let enriched = 0;
let withStyle = 0;
let sixExCorrected = 0;
let uncovered = 0;

for (const rec of records) {
  const w = wikiByPoma.get(rec.pairId);
  if (w) {
    if (w.hasSixEx && !rec.hasSixEx) sixExCorrected++;
    rec.hasSixEx = w.hasSixEx;
    rec.hasExStyle = w.hasExStyle;
    rec.exStyleDate = w.sixExDate ?? null;
    rec.exStyleImage = w.sixExImage ?? null;
    // 只有真的 hasExStyle 才給 EX 立繪 (trainerId 跨拍組共用, 不能漏給無 EX style 的手足)
    rec.exStyleImagePath = w.hasExStyle ? exPathFor(rec.trainerId, exPortraits[rec.trainerId]?.ex) : null;
    rec.exRoleName = w.exRoleConfirmed ?? null;
    rec.exDataSource = "wiki";
    enriched++;
    if (w.hasExStyle) withStyle++;
  } else {
    // 對不上 wiki (多為主角/蛋拍組或 pomatools 獨有) — 明確標記未覆蓋
    if (rec.hasExStyle === undefined) rec.hasExStyle = false;
    rec.exDataSource = "none";
    uncovered++;
  }
}

// ── 兄弟繼承: pomatools 對同一邏輯拍組常有重複 pairId (event/form 變體),
//    wiki 只收一筆。讓未對上的重複紀錄繼承同 (trainer|species) 已對上手足的 EX 資料。
const norm = (s) => (s ?? "").toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
const coveredBySpecies = new Map();
for (const rec of records) {
  if (rec.exDataSource === "wiki") {
    coveredBySpecies.set(`${norm(rec.trainerName)}|${norm(rec.pokemonName)}`, rec);
  }
}
let inherited = 0;
for (const rec of records) {
  if (rec.exDataSource !== "none") continue;
  const sib = coveredBySpecies.get(`${norm(rec.trainerName)}|${norm(rec.pokemonName)}`);
  if (sib) {
    rec.hasSixEx = sib.hasSixEx;
    rec.hasExStyle = sib.hasExStyle;
    rec.exStyleDate = sib.exStyleDate;
    rec.exStyleImage = sib.exStyleImage;
    rec.exStyleImagePath = sib.hasExStyle ? exPathFor(rec.trainerId, exPortraits[rec.trainerId]?.ex ?? sib.exStyleImagePath) : null;
    rec.exRoleName = sib.exRoleName;
    rec.exDataSource = "wiki-sibling";
    inherited++;
  }
}

writeFileSync(join(dataDir, "pomatools-pairs.json"), JSON.stringify(pomaFile, null, 2));

const stillNone = records.filter((r) => r.exDataSource === "none").length;
console.log(`pomatools 紀錄總數     : ${records.length}`);
console.log(`  以 wiki 補正         : ${enriched}`);
console.log(`    └ 有 EX style      : ${withStyle}`);
console.log(`    └ hasSixEx 由 false→true: ${sixExCorrected}`);
console.log(`  重複紀錄繼承手足     : ${inherited}`);
console.log(`  仍未覆蓋 (shared-kit): ${stillNone}`);

// ── 產出 markdown 比對報告 ──────────────────────────────────────────────
const c = wiki.counts;
const noStyleList = wiki.sixEx.filter((e) => !e.hasExStyle).map((e) => e.page);
const lines = [];
lines.push("# EX Style 抓取與比對報告");
lines.push("");
lines.push(`> 來源: [Pokémon Masters EX Wiki](https://pokemon-masters-ex-game.fandom.com/wiki/6%E2%98%85_EX) — 6★ EX 頁面 + Sync Pairs/List`);
lines.push(`> 產生時間: ${new Date().toISOString()}`);
lines.push("");
lines.push("## 抓取統計 (wiki 權威值)");
lines.push("");
lines.push("| 項目 | 數量 |");
lines.push("| --- | ---: |");
lines.push(`| 名冊總數 (roster) | ${c.roster} |`);
lines.push(`| 可達 6★ EX | ${c.sixEx} |`);
lines.push(`| └ **有 EX style (換裝)** | **${c.withExStyle}** |`);
lines.push(`| └ 無 EX style (僅升招) | ${c.withoutExStyle} |`);
lines.push(`| 有 EX role | ${c.exRole} |`);
lines.push("");
lines.push("## 與 pomatools 既有資料比對");
lines.push("");
lines.push("| 項目 | 值 |");
lines.push("| --- | ---: |");
lines.push(`| wiki roster ↔ pomatools 對上 | ${c.matchedToPomatools}/${c.roster} |`);
lines.push(`| 主角拍組 (pomatools 不收錄) | ${c.protagonistPairs} |`);
lines.push(`| 其他對不上 | ${c.unmatched} |`);
lines.push(`| pomatools 原 hasSixEx 為真 | 303 |`);
lines.push(`| **hasSixEx 修正後為真 (wiki 權威)** | **${records.filter((r) => r.hasSixEx).length}** |`);
lines.push("");
lines.push("**關鍵發現**: pomatools 的 `hasSixEx` 與 `hasExRole` 同為 303, 實際上只追到 *EX role* 解鎖, 嚴重低估真正可達 6★ EX 的數量 (wiki: 598)。本次以 wiki 為準補正, 並新增 `hasExStyle` 欄位 (pomatools 原本完全沒有)。");
lines.push("");
const styleTrue = records.filter((r) => r.hasExStyle === true).length;
const stillNoneList = records
  .filter((r) => r.exDataSource === "none")
  .map((r) => `${r.trainerName} & ${r.pokemonName} (${r.pairId})`);
lines.push("## pomatools 補正後最終覆蓋");
lines.push("");
lines.push("| 項目 | 值 |");
lines.push("| --- | ---: |");
lines.push(`| pomatools 紀錄總數 | ${records.length} |`);
lines.push(`| 直接由 wiki 補正 | ${enriched} |`);
lines.push(`| 重複紀錄繼承手足 (wiki-sibling) | ${inherited} |`);
lines.push(`| **hasExStyle 欄位覆蓋** | **${records.length}/${records.length}** |`);
lines.push(`| └ hasExStyle = true | ${styleTrue} |`);
lines.push(`| hasSixEx = true (補正後) | ${records.filter((r) => r.hasSixEx).length} |`);
lines.push(`| 仍未覆蓋 (wiki 無此筆) | ${stillNoneList.length} |`);
lines.push("");
lines.push(`### 仍未覆蓋的 ${stillNoneList.length} 筆 (wiki 不收錄)`);
lines.push("");
lines.push("多為主角學園共用 kit 變體 (19999 系) 與遊戲原創角色, fandom wiki 未列為獨立拍組:");
lines.push("");
for (const n of stillNoneList) lines.push(`- ${n}`);
lines.push("");
lines.push(`## 無 EX style 的 6★ EX 拍組 (共 ${noStyleList.length} 隻, wiki 標 \\*)`);
lines.push("");
lines.push("這些拍組可達 6★ EX (升級沙招) 但沒有換裝立繪:");
lines.push("");
for (const n of noStyleList) lines.push(`- ${n}`);
lines.push("");

writeFileSync(join(dataDir, "wiki-ex-style-report.md"), lines.join("\n"));
console.log(`\n報告 → src/data/wiki-ex-style-report.md`);
console.log(`資料 → src/data/pomatools-pairs.json (已補正)`);
