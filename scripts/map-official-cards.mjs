#!/usr/bin/env node
/**
 * 建立「我方 pairId → 上游官方卡面檔」的對照表 (資料管線 stage 4f)。
 *
 * 產出 src/data/official-card-map.json —— **要 commit**。
 *   固化成資料檔而不是每次現算, 是為了讓「上游把誰的 id 換掉了」在 git diff 上看得見。
 *
 * ⚠ 檔名一律改成我方的 `<pairId>_<3|4|5|EX>` —— 對方的檔名不是穩定 id:
 *   含空白與句點 (`Lt. Surge_0101_3.png`)、阿爾套裝拍組中間多一段變體號
 *   (`Brock_0095_2_5.png`)、而且那是他們的顯示名, 上游改名就整批失聯。
 *
 * 比對分四段, **多義一律不配、留給人工**, 任何一筆對外可見的拍組沒對到就 exit 1:
 *   1. 精確雙鍵   internalTrainerName|internalPokemonName ↔ trainerId|pokemonId
 *   2. 主角拍組   對方那 11 筆的 internalTrainerName 是空字串或 "hero", 改用寶可夢英文名
 *   3. 同訓練家   兩邊都只剩一個候選 (= 我方記進化前、對方記進化後那批)
 *   4. 職業 NPC   手寫 actor 別名表 (見 NPC_ALIAS)
 *
 * ⚠ **判準 A 的拍組要先排除再比對** —— 那 10 筆佔位拍組 (19999*) 與莉莉艾/鳴依/小光/阿響
 *   共用 trainerId, 不先排掉會把第 3 段拖成多義。它們本來就不在上游資料裡, 也不對外送。
 *
 * 用法:
 *   node scripts/map-official-cards.mjs             # 產表 (冪等, 內容沒變不重寫)
 *   node scripts/map-official-cards.mjs --verbose   # 逐筆列出每一段配到什麼
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPairModule } from "./lib-pair-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const MIRROR = join(repoRoot, "src", "data", "pomasters", "syncpairs.json");
const OUT_FILE = join(repoRoot, "src", "data", "official-card-map.json");

const verbose = process.argv.slice(2).includes("--verbose");

/**
 * 8 位通用職業 NPC: 我方 trainerId 走 datamine 指定的角色本尊 actor (isGeneric=0),
 * 對方走通用職業 actor (isGeneric=1)。兩者是同一位角色, 但那 8 個本尊 actor
 * 在 brybry 上沒有 _128 縮圖 (實測全 404), 所以我方的立繪是另外重裁的。
 * 卡面以官方為準 —— 使用者原話「它的是跟遊戲圖片最接近的」。
 */
const NPC_ALIAS = {
  ch0652_68_sayoko: "ch0521_60_hexmaniac",   // 紗幽子（靈異迷）
  ch0653_68_kirika: "ch0610_60_furisodegirl", // 桐華（長袖和服少女）
  ch0658_00_karen: "ch0659_00_furisodegirl",  // 華蓮（長袖和服少女）
  ch0351_00_shione: "ch0660_00_furisodegirl", // 汐音（長袖和服少女）
  ch0363_00_asami: "ch0661_00_furisodegirl",  // 亞莎美（長袖和服少女）
  ch0656_00_ibu: "ch0654_00_pokekidf",        // 伊芙（寶可夢小朋友）
  ch0657_00_chusuke: "ch0655_00_pokekidm",    // 丘助（寶可夢小朋友）
  ch0364_00_masahito: "ch0080_00_yamaotoko",  // 勇仁（登山男）
};

/** 主角形象固定用官方預設男主角 Scottie (AGENTS.md) */
const PROTAGONIST_PREFIX = "Scottie";

/**
 * `icons/Brock_0095_2_5.png` → { prefix: "Brock_0095_2", tier: "5" }
 * 從尾巴解析, 因為前面可能有空白、句點與額外的變體號。
 */
function parseIcon(path) {
  const base = path.replace(/^icons\//, "").replace(/\.png$/i, "");
  const cut = base.lastIndexOf("_");
  if (cut < 0) return null;
  return { prefix: base.slice(0, cut), tier: base.slice(cut + 1) };
}

/** 一筆上游紀錄 → { tier: 上游檔名 }, 主角只取 Scottie */
function tiersOf(row) {
  const out = {};
  const isPlayer = row.trainerName === "Player";
  for (const path of row.images ?? []) {
    const parsed = parseIcon(path);
    if (!parsed) continue;
    if (isPlayer && !parsed.prefix.startsWith(PROTAGONIST_PREFIX)) continue;
    // 同一階若有多個候選 (變體號), 取檔名最短的那個 = 本體
    const prev = out[parsed.tier];
    if (prev && prev.length <= path.length) continue;
    out[parsed.tier] = path;
  }
  return out;
}

async function main() {
  if (!existsSync(MIRROR)) {
    throw new Error(`找不到上游鏡像, 先跑 node scripts/fetch-pomasters.mjs\n  ${MIRROR}`);
  }
  const upstream = JSON.parse(readFileSync(MIRROR, "utf8"));
  const rows = upstream.SYNCPAIRS;

  const { all, isUnreleasedPair } = await loadPairModule();

  // 判準 A = 沒來源也沒日期。這裡刻意只排 A 不排 B:
  //   判準 B (還沒到上架日) 的拍組**要**留在對照表裡 —— 上架當天圖就已經對好了,
  //   擋它們的是「產不產圖」那一步 (convert 階段), 不是這張表。
  const blockedA = all.filter((r) => (r.verifiedSources?.length ?? 0) === 0 && !r.releaseDate);
  const blockedASet = new Set(blockedA.map((r) => r.pairId));
  const ours = all.filter((r) => !blockedASet.has(r.pairId));

  const usedRows = new Set();
  const matched = new Map(); // pairId → { row, via }
  const ambiguous = [];
  const take = (rec, row, via) => { matched.set(rec.pairId, { row, via }); usedRows.add(row); };
  const upstreamTrainerId = (rec) => NPC_ALIAS[rec.trainerId] ?? rec.trainerId;

  // ── 1. 精確雙鍵 ──
  const byPair = new Map();
  for (const row of rows) byPair.set(`${row.internalTrainerName}|${row.internalPokemonName}`, row);
  for (const rec of ours) {
    const hit = byPair.get(`${upstreamTrainerId(rec)}|${rec.pokemonId}`);
    if (hit && !usedRows.has(hit)) take(rec, hit, "exact");
  }
  const nExact = matched.size;

  // ── 2. 主角拍組 (對方 internalTrainerName 是空字串或 "hero") ──
  for (const rec of ours) {
    if (matched.has(rec.pairId) || rec.trainerId !== "chp000_00_player") continue;
    const want = String(rec.pokemonName ?? "").toLowerCase();
    const cands = rows.filter(
      (r) => !usedRows.has(r) && r.trainerName === "Player" && r.pokemonName.toLowerCase() === want
    );
    if (cands.length === 1) take(rec, cands[0], "protagonist");
    else if (cands.length > 1) ambiguous.push({ pairId: rec.pairId, stage: "protagonist", n: cands.length });
  }
  const nProtagonist = matched.size - nExact;

  // ── 3. 同一位訓練家, 兩邊都只剩一個 (我方記進化前 / 對方記進化後) ──
  for (const rec of ours) {
    if (matched.has(rec.pairId)) continue;
    const key = upstreamTrainerId(rec);
    const cands = rows.filter((r) => !usedRows.has(r) && r.internalTrainerName === key);
    const oursLeft = ours.filter((o) => !matched.has(o.pairId) && upstreamTrainerId(o) === key);
    if (cands.length === 1 && oursLeft.length === 1) take(rec, cands[0], "trainer-unique");
    else if (cands.length > 1 && oursLeft.length === 1) {
      ambiguous.push({ pairId: rec.pairId, stage: "trainer-unique", n: cands.length });
    }
  }
  const nTrainerUnique = matched.size - nExact - nProtagonist;

  // ── 結果 ──
  const missing = ours.filter((o) => !matched.has(o.pairId));
  const leftover = rows.filter((r) => !usedRows.has(r));

  console.log("=== 官方卡面對照表 ===");
  console.log(`  母體       ${ours.length} 筆 (catalog ${all.length} 扣掉判準A ${blockedA.length})`);
  console.log(`  精確雙鍵   ${nExact}`);
  console.log(`  主角拍組   ${nProtagonist}`);
  console.log(`  同訓練家   ${nTrainerUnique}`);
  console.log(`  合計       ${matched.size} / ${ours.length}`);
  console.log(`  上游未用   ${leftover.length}`);

  if (ambiguous.length) {
    console.error(`\n✗ 多義 ${ambiguous.length} 筆 (一律不配, 請補 NPC_ALIAS 或人工指定):`);
    for (const a of ambiguous) console.error(`  ${a.pairId}  第 ${a.stage} 段有 ${a.n} 個候選`);
    process.exit(1);
  }
  if (missing.length) {
    console.error(`\n✗ 未對到 ${missing.length} 筆:`);
    for (const m of missing) {
      console.error(`  ${m.pairId}  ${m.trainerNameZh ?? m.trainerName} & ${m.pokemonNameZh ?? m.pokemonName}  [${m.trainerId}|${m.pokemonId}]`);
    }
    console.error(`\n新拍組上游還沒收錄的話, 先跑 node scripts/fetch-pomasters.mjs --bump。`);
    console.error(`上游把 actor id 換掉的話, 補 NPC_ALIAS 或加一段比對規則, 不要放寬既有規則。`);
    process.exit(1);
  }

  // ── 產表 ──
  const entries = [];
  const ladderGaps = [];
  const exGaps = [];
  const nameMismatch = [];

  for (const rec of ours) {
    const { row, via } = matched.get(rec.pairId);
    const tiers = tiersOf(row);
    // 星級階梯: 從原始星級到 5 星每一階都要有
    const wanted = [];
    for (let s = rec.basePotential; s <= 5; s++) wanted.push(String(s));
    for (const s of wanted) if (!tiers[s]) ladderGaps.push(`${rec.pairId} 缺 ${s}★`);
    // 6★EX: 對方的 _EX 檔存在條件 = syncPairEXPose, 與我方 hasSixEx 是兩回事, 分開記
    if (row.syncPairEXPose && !tiers.EX) exGaps.push(`${rec.pairId} 標了 EXPose 卻沒有 _EX 檔`);

    if (String(rec.pokemonName ?? "").toLowerCase() !== row.pokemonName.toLowerCase()) {
      nameMismatch.push({
        pairId: rec.pairId,
        ours: rec.pokemonName,
        oursZh: rec.pokemonNameZh ?? null,
        theirs: row.pokemonName,
      });
    }

    const files = {};
    for (const s of [...wanted, ...(tiers.EX ? ["EX"] : [])]) {
      if (tiers[s]) files[s] = tiers[s];
    }
    entries.push({
      pairId: rec.pairId,
      via,
      basePotential: rec.basePotential,
      hasSixEx: Boolean(rec.hasSixEx),
      exPose: Boolean(row.syncPairEXPose),
      upstreamPokemonName: row.pokemonName,
      files,
    });
  }

  if (ladderGaps.length) {
    console.error(`\n✗ 星級階梯有缺口 ${ladderGaps.length} 處:`);
    for (const g of ladderGaps.slice(0, 20)) console.error(`  ${g}`);
    process.exit(1);
  }
  if (exGaps.length) {
    console.error(`\n✗ EX 檔缺口 ${exGaps.length} 處:`);
    for (const g of exGaps.slice(0, 20)) console.error(`  ${g}`);
    process.exit(1);
  }

  const withEx = entries.filter((e) => e.files.EX).length;
  const fileCount = entries.reduce((n, e) => n + Object.keys(e.files).length, 0);
  console.log(`  有 EX 卡面 ${withEx}`);
  console.log(`  要抓的檔   ${fileCount}`);

  // 進化型: 官方卡面畫的是進化後的型, 我方 catalog 記初始型 (已定案要改名, 但要動線上, 不在這一批)
  console.log(`\n  寶可夢名不同 ${nameMismatch.length} 筆 (官方卡面畫進化後的型):`);
  for (const m of nameMismatch.slice(0, verbose ? 99 : 6)) {
    console.log(`    ${m.pairId}  ${m.oursZh ?? m.ours} (${m.ours}) → ${m.theirs}`);
  }
  if (!verbose && nameMismatch.length > 6) console.log(`    … 其餘 ${nameMismatch.length - 6} 筆 (加 --verbose 看全部)`);

  const payload = {
    _note: [
      "由 scripts/map-official-cards.mjs 產生, 不要手改。",
      "上游來源與授權見 src/data/upstream-pin.json; 上游資料鏡像在 src/data/pomasters/syncpairs.json。",
      "files 的 key 是星級 (3/4/5/EX), value 是上游檔名。下載時一律改名成 <pairId>_<星級>.png。",
    ],
    generatedFrom: upstream.fetchedFrom,
    upstreamVersion: upstream.upstreamVersion,
    counts: {
      catalog: all.length,
      blockedA: blockedA.length,
      mapped: entries.length,
      withEx,
      files: fileCount,
      via: { exact: nExact, protagonist: nProtagonist, trainerUnique: nTrainerUnique },
    },
    // 官方卡面畫進化後的型 —— 已定案要把這批的名字改成進化後, 但那要回填 member_pairs
    // 的 pair_label (unique key), 會動到線上, 所以先只記錄不處理。
    evolvedNameMismatch: nameMismatch,
    entries,
  };
  const text = `${JSON.stringify(payload, null, "\t")}\n`;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const changed = !existsSync(OUT_FILE) || readFileSync(OUT_FILE, "utf8") !== text;
  if (changed) writeFileSync(OUT_FILE, text, "utf8");
  console.log(`\n  產出       src/data/official-card-map.json${changed ? "  [已寫入]" : "  [內容未變]"}`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
