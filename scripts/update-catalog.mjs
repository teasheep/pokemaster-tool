#!/usr/bin/env node
/**
 * 一鍵更新拍組資料 (新拍組推出時跑這支)。
 *
 * 設計原則: 「不依賴單一來源, 以免出錯」
 *   - 主目錄 (權威, 決定有哪些拍組 + pairId): brybry datamine
 *   - 驗證 / 補完: pomatools (清單+圖)、Fandom Wiki (EX/role)、Serebii (太晶/超覺醒/6★EX)
 *   reconcile-db.mjs 會把 pomatools/wiki/serebii 三方對 catalog 交叉比對,
 *   在每筆 record 標 verifiedSources / 矛盾欄位。
 *
 * 互動流程 (預設):
 *   1. 自動抓 + 交叉驗證 (不含 embedding)
 *   2. 列出「這次新增了哪些拍組」, 問你: 同意嗎? [Y/n]
 *      - 是 → 重算 embedding + 寫報告 + 完成
 *      - 否 → 重新抓 (回到步驟 1)
 *   只要選是/否, 不需要逐隻挑。
 *
 * 為什麼主目錄是 brybry 而非 pomatools:
 *   committed catalog (source:brybry) 與 pair-embeddings.json 的 pairId 都是 brybry
 *   的 11 碼 id (例 10000000000), 圖檔也用 brybry actor id (ch0000_00_red_128.png)。
 *   App 的 user_collection 存的就是這套 pairId。改用 pomatools (另一套 12 碼 id) 會讓
 *   所有人的收藏 + 既有 embedding + 圖檔命名全部對不上。pomatools 只當「驗證來源」。
 *   brybry 核心 datamine 可線上抓 (見 fetch-brybry-proto.mjs), 所以仍能自動拿到新拍組。
 *
 * 用法:
 *   node scripts/update-catalog.mjs                # 互動式 (抓完問你是否同意)
 *   node scripts/update-catalog.mjs --yes          # 不問, 直接套用 (自動化/CI)
 *   node scripts/update-catalog.mjs --skip-embeddings  # 只更新元資料 (快速預覽)
 *   node scripts/update-catalog.mjs --skip-wiki    # wiki 掛掉時, 沿用既有 wiki 資料
 *   node scripts/update-catalog.mjs --strict       # 把資料品質 ⚠ 視為錯誤 (exit 1)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const dataDir = join(repoRoot, "src", "data");
const CATALOG = join(dataDir, "pomatools-pairs.json");
const EMB = join(dataDir, "pair-embeddings.json");
const REPORT = join(dataDir, "update-report.md");

const args = process.argv.slice(2);
const skipEmbeddings = args.includes("--skip-embeddings");
const skipWiki = args.includes("--skip-wiki");
const strict = args.includes("--strict");
const assumeYes = args.includes("--yes") || args.includes("-y");
// 非 TTY (CI / 被 pipe) 時無法互動 → 視同 --yes, 不卡住
const interactive = !assumeYes && Boolean(stdin.isTTY);

// 報告要比對哪些欄位。**漏一個欄位 = 那個欄位的靜默退化永遠不會被印出來** ——
// 2026-09 實測: 舊清單少了 releaseDate / series / pairKind, 於是「小照 & 魔尼尼 的 series
// upcoming→general」整筆沒進報告, 而同一次更新裡 releaseDate 掉成 null 只因為發生在**新增**
// 拍組才被看見 (若發生在既有拍組上, 報告一個字都不會印)。
// hasAwakening 更是 AGENTS.md 點名的前科欄位 (杜若 & 鋁鋼橋龍 被洗成 false), 一定要在名單裡。
const WATCH_FIELDS = [
  "trainerName", "pokemonName", "trainerNameZh", "pokemonNameZh",
  "type", "region", "group", "basePotential", "roleAsset",
  "change", "hasSixEx", "hasExStyle", "exRoleName",
  // 使用者看得見 + 有前科的欄位 (2026-09 補齊)
  "releaseDate", "series", "pairKind", "acquisitions",
  "hasAwakening", "exRole", "hasExRole",
];

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function summarize(records) {
  const map = new Map();
  for (const r of records ?? []) {
    if (!r?.pairId) continue;
    const picked = {};
    for (const f of WATCH_FIELDS) picked[f] = r[f] ?? null;
    map.set(String(r.pairId), picked);
  }
  return map;
}

function displayName(rec) {
  const t = rec.trainerNameZh ?? rec.trainerName ?? "?";
  const p = rec.pokemonNameZh ?? rec.pokemonName ?? "?";
  return `${t} & ${p}`;
}

// 比對快照 vs 現在的 catalog
function diffCatalog(before) {
  const after = readJson(CATALOG, { records: [] }).records ?? [];
  const afterMap = summarize(after);
  const recById = new Map(after.map((r) => [String(r.pairId), r]));
  const added = [...afterMap.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !afterMap.has(id));
  const changed = [];
  for (const [id, now] of afterMap) {
    const prev = before.get(id);
    if (!prev) continue;
    const diffs = WATCH_FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(now[f]));
    if (diffs.length) changed.push({ id, diffs, now });
  }
  return { after, afterMap, recById, added, removed, changed };
}

// ── 編排階段 ──
// soft=true: 失敗只警告繼續 (例如 wiki 暫時掛掉, 可沿用既有 json)
const META_STAGES = [
  { name: "0. 抓 brybry datamine (新拍組源頭)", script: "fetch-brybry-proto.mjs", extra: [], soft: true },
  { name: "1. brybry → catalog + 圖", script: "scrape-brybry.mjs", extra: [], soft: false },
  { name: "2. Wiki EX/role/roster", script: "scrape-wiki-exstyle.mjs", extra: [], soft: true, skip: skipWiki },
  { name: "3. Wiki EX 立繪", script: "scrape-wiki-ex-portraits.mjs", extra: [], soft: true, skip: skipWiki },
  { name: "4. 用 Wiki 校正 EX 欄位", script: "enrich-pomatools-exstyle.mjs", extra: [], soft: false },
  // brybry 還沒收錄但已實裝的拍組 (wiki 為源) — 補進 catalog, brybry 跟上後自動讓位
  { name: "4b. 補 wiki-only 已實裝拍組", script: "add-wiki-pairs.mjs", extra: [], soft: true },
  // 日期/徽章/系列 — 漏跑會讓全部拍組失去系列標籤 (2026-08-14 曾因未排進管線而整批洗掉)
  { name: "4c. 日期/徽章/系列 (pomatools)", script: "patch-pomatools-meta.mjs", extra: [], soft: false },
  // 主角 (Player) 拍組 — brybry/pomatools 都不收, 但道館賽常用。
  // 排在 4c 之後: 它自帶 series/releaseDate, 不要被 pomatools 的 patch 蓋掉。
  { name: "4d. 補主角拍組", script: "add-protagonist-pairs.mjs", extra: [], soft: true },
  { name: "5. 多來源交叉驗證 (pomatools+wiki+serebii)", script: "reconcile-db.mjs", extra: [], soft: false },
  // 最後才改名 — 前面每一階段都是用名字比對來源的, 早改會對不到 (前科: 四季鹿掉了 acquisitions)
  { name: "5b. 同名拍組補形態名", script: "disambiguate-pair-names.mjs", extra: [], soft: true },
  // **一定要排在最後** — 會下載新圖的不只 stage 1: 4b (add-wiki-pairs) 與 4d (add-protagonist-pairs)
  // 也會寫 reference/trainer|pokemon 的 PNG。轉檔早跑就漏掉那兩批, 而 PNG 不進部署
  // (見 public/.assetsignore) → 那些拍組線上就是空卡。而且它要讀最終的 catalog 決定轉哪些圖,
  // 也必須等 5/5b 定案。冪等, 重跑成本只有 stat。soft:false — 圖沒轉等於線上空圖。
  { name: "5c. 卡片圖轉 WebP", script: "convert-card-images.mjs", extra: [], soft: false },
  // **一定要排在 catalog 定案 (5/5b) 之後** — 它把 catalog 投影成 client 版靜態資產
  // (public/catalog/<指紋>.json) 並算出指紋常數; 早跑就會把舊資料連同舊指紋寫進去,
  // 而那個網址是 immutable 快取一年 → 線上「全圖鑑」整年拿舊資料 (與 5c 同一個教訓)。
  // 冪等: 內容沒變就不動檔。soft:false — 產不出來 = 全圖鑑只能靠 /api/catalog 那條退路。
  { name: "5d. client 圖鑑靜態資產 + 指紋", script: "emit-client-catalog.mjs", extra: [], soft: false },
];
const EMB_STAGE = { name: "6. 重算 embedding", script: "build-embeddings.mjs", extra: [], soft: false };

function runStage(stage) {
  const scriptPath = join(__dirname, stage.script);
  if (!existsSync(scriptPath)) {
    console.warn(`\n⚠ 找不到 ${stage.script}, 跳過`);
    return true;
  }
  console.log(`\n${"━".repeat(60)}\n▶ ${stage.name}  (${stage.script} ${stage.extra.join(" ")})\n${"━".repeat(60)}`);
  const res = spawnSync(process.execPath, [scriptPath, ...stage.extra], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const ok = res.status === 0;
  if (!ok) {
    if (stage.soft) {
      console.warn(`\n⚠ ${stage.script} 失敗 (exit ${res.status}) — soft 階段, 沿用既有資料繼續`);
    } else {
      console.error(`\n✖ ${stage.script} 失敗 (exit ${res.status}) — 必要階段, 中止`);
    }
  }
  return ok || stage.soft;
}

function runMetaStages() {
  for (const stage of META_STAGES) {
    if (stage.skip) {
      console.log(`\n(略過 ${stage.name})`);
      continue;
    }
    if (!runStage(stage)) {
      console.error("\n更新中止 — 修正上面的錯誤後重跑。");
      process.exit(1);
    }
  }
}

async function askYesNo(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ans = (await rl.question(question)).trim().toLowerCase();
    // 預設 (直接 Enter) = 是
    return ans === "" || ans === "y" || ans === "yes" || ans === "是";
  } finally {
    rl.close();
  }
}

function printAdded(added, recById) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🆕 這次新增 ${added.length} 隻拍組:`);
  console.log("═".repeat(60));
  for (const id of added) {
    const rec = recById.get(id) ?? {};
    const sources = Array.isArray(rec.verifiedSources) ? rec.verifiedSources : [];
    const tag = sources.length < 2 ? "  🆕 NEW (其他來源待收錄)" : "";
    console.log(`  • ${displayName(rec)}  [${sources.join("/") || "brybry only"}]${tag}`);
  }
  console.log("\n🆕 NEW = 目前只有 brybry 有、pomatools/wiki 還沒收錄; 資料之後可能還會變動。");
}

function writeReport(before, diff) {
  const { afterMap, recById, added, removed, changed, after } = diff;
  const embIds = new Set((readJson(EMB, { entries: [] }).entries ?? []).map((e) => String(e.id)));

  let newCount = 0;
  const addedDetail = added.map((id) => {
    const rec = recById.get(id) ?? {};
    const sources = Array.isArray(rec.verifiedSources) ? rec.verifiedSources : [];
    const hasEmb = embIds.has(id);
    const isNew = sources.length < 2; // 只有 brybry, 其他來源尚未收錄
    const tags = [];
    if (isNew) tags.push("🆕 NEW");
    if (!hasEmb) tags.push("缺 embedding (待重算)");
    if (isNew) newCount++;
    return { id, name: displayName(rec), sources, hasEmb, tags };
  });
  const catalogMissingEmb = after.filter((r) => !embIds.has(String(r.pairId))).length;

  const lines = [];
  lines.push("# 拍組資料更新報告");
  lines.push("");
  lines.push(`- catalog: ${before.size} → ${afterMap.size} 隻`);
  lines.push(`- 新增 ${added.length} ・ 移除 ${removed.length} ・ 欄位變動 ${changed.length}`);
  lines.push(`- embedding: ${embIds.size} 筆 (catalog 中 ${catalogMissingEmb} 隻尚無 embedding)`);
  lines.push(`- 其中 🆕 NEW (只有 brybry, 其他來源待收錄): ${newCount} / ${added.length}`);
  lines.push("");
  lines.push("> **🆕 NEW** = 目前只有 brybry datamine 收錄、pomatools/wiki 還沒跟上的新拍組。");
  lines.push("> 這類拍組的資料 (名稱/屬性/技能/EX 等) **之後可能還會變動**; 等其他來源補上時, 下次更新會自動校正。");
  lines.push("> 多來源原則: 每筆 record 的 `verifiedSources` 來自 pomatools / wiki / serebii 交叉比對。");
  lines.push("> 詳細矛盾欄位見 `db-reconcile-report.md`; EX 校正見 `wiki-ex-style-report.md`。");
  lines.push("");
  if (addedDetail.length) {
    lines.push("## 新增拍組");
    lines.push("");
    lines.push("| pairId | 拍組 | 已驗證來源 | embedding | 標記 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const a of addedDetail) {
      lines.push(`| ${a.id} | ${a.name} | ${a.sources.join("/") || "brybry only"} | ${a.hasEmb ? "✓" : "✗"} | ${a.tags.join(" ") || "—"} |`);
    }
    lines.push("");
  }
  if (changed.length) {
    lines.push("## ✏️ 欄位變動");
    lines.push("");
    for (const c of changed.slice(0, 100)) {
      const detail = c.diffs
        .map((f) => `${f}: ${JSON.stringify(before.get(c.id)[f])} → ${JSON.stringify(c.now[f])}`)
        .join("; ");
      lines.push(`- **${displayName(c.now)}** (${c.id}) — ${detail}`);
    }
    if (changed.length > 100) lines.push(`- … 另有 ${changed.length - 100} 筆`);
    lines.push("");
  }
  if (removed.length) {
    lines.push("## ❌ 從來源消失的拍組 (請確認是改名/合併還是真的下架)");
    lines.push("");
    for (const id of removed) {
      const prev = before.get(id);
      lines.push(`- ${prev.trainerName ?? "?"} & ${prev.pokemonName ?? "?"} (${id})`);
    }
    lines.push("");
  }
  if (!added.length && !changed.length && !removed.length) {
    lines.push("_這次沒有偵測到任何變動。_");
    lines.push("");
  }
  writeFileSync(REPORT, lines.join("\n"), "utf8");
  return newCount;
}

async function main() {
  console.log("=== 拍組資料更新 ===");
  console.log(`模式: ${interactive ? "互動 (抓完問你是否同意)" : "非互動 (--yes / 非 TTY)"}${skipEmbeddings ? " ・略過 embedding" : ""}${skipWiki ? " ・略過 wiki" : ""}${strict ? " ・strict" : ""}`);

  // 階段 0: 先快照目前 catalog (待會 diff 用; 抓取會覆寫它)
  const before = summarize(readJson(CATALOG, { records: [] }).records);
  console.log(`\n快照: 目前 catalog ${before.size} 隻拍組`);

  // 抓取 + 交叉驗證, 互動確認 (否 → 重抓)
  let diff;
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1) console.log(`\n↻ 重新抓取 (第 ${attempt} 次)…`);
    runMetaStages();
    diff = diffCatalog(before);

    if (diff.added.length === 0) {
      console.log("\n(這次沒有新增拍組)");
      if (diff.changed.length) console.log(`(但有 ${diff.changed.length} 筆欄位變動 — 見報告)`);
      break;
    }

    printAdded(diff.added, diff.recById);
    if (diff.removed.length) console.log(`\n(另有 ${diff.removed.length} 隻從來源消失 — 見報告)`);

    if (!interactive) break; // --yes / 非 TTY: 直接套用

    const ok = await askYesNo(`\n同意套用以上更新嗎? 否則重新抓。[Y/n] `);
    if (ok) break;
    console.log("→ 你選了「否」, 重新抓取。(若來源還沒更新, 結果可能一樣; 要放棄請 Ctrl+C 後 git checkout 還原)");
  }

  // 同意後才重算 embedding (較慢)
  if (!skipEmbeddings) {
    if (!runStage(EMB_STAGE)) {
      console.error("\nembedding 階段失敗 — 中止。");
      process.exit(1);
    }
    diff = diffCatalog(before); // 重讀 (embedding 不改 catalog, 但保險重算)
  } else {
    console.log("\n(略過 embedding 重算)");
  }

  const newCount = writeReport(before, diff);

  console.log(`\n${"═".repeat(60)}`);
  console.log("✅ 更新完成");
  console.log(`   新增 ${diff.added.length} ・ 移除 ${diff.removed.length} ・ 變動 ${diff.changed.length}`);
  console.log(`   🆕 NEW (其他來源待收錄): ${newCount}`);
  console.log(`   報告: src/data/update-report.md`);
  console.log(`   交叉驗證細節: src/data/db-reconcile-report.md`);
  console.log("═".repeat(60));
  console.log("\n下一步: 覆核報告 → git add -A → commit → 部署 (新拍組不需動資料庫)。");

  // --strict: 嚴格模式下, 只有 brybry (其他來源未收錄) 的新拍組會擋下
  if (strict && newCount > 0) {
    console.error(`\n✖ --strict: 有 ${newCount} 筆 NEW 拍組只有 brybry 來源, exit 1。`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n✖ 更新失敗:", e);
  process.exit(1);
});
