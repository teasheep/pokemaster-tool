#!/usr/bin/env node
/**
 * 把「初上線日登記簿」套進 catalog (資料管線最後一階, 排在所有日期來源之後)。
 *
 * 登記簿 = src/data/pair-debut-dates.json, **全站唯一的手寫日期入口**。
 * 它以 pairId 為鍵, 所以表達得了「同一位訓練家的第二個拍組要改日期」——
 * scripts/patch-pomatools-meta.mjs 的 RELEASED_OVERRIDES 以 trainerId 為鍵, 做不到這件事
 * (18 筆裡有 9 筆坐在有 2 到 11 個拍組的 trainerId 上)。
 *
 * 為什麼排最後: pomatools / wiki / RELEASED_OVERRIDES 都會寫 releaseDate,
 * 登記簿要蓋得過它們才有意義。這一階跑完 catalog 的日期就定案了。
 *
 * ⚠ 這支腳本**不做判斷**, 它只是把查證過的結果套上去。
 *   要改日期請改登記簿 (而且一定要附來源網址), 不要改這裡的邏輯。
 *
 * 用法:
 *   node scripts/apply-debut-dates.mjs            # 套用 (冪等)
 *   node scripts/apply-debut-dates.mjs --dry-run  # 只印會改什麼, 不寫檔
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const CATALOG = join(repoRoot, "src", "data", "pomatools-pairs.json");
const REGISTRY = join(repoRoot, "src", "data", "pair-debut-dates.json");

const dryRun = process.argv.slice(2).includes("--dry-run");

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const registry = JSON.parse(readFileSync(REGISTRY, "utf8")).entries;

const byId = new Map(catalog.records.map((r) => [r.pairId, r]));

const applied = [];
const unchanged = [];
const orphans = [];

for (const [pairId, e] of Object.entries(registry)) {
  const rec = byId.get(pairId);
  if (!rec) {
    orphans.push(`${pairId} ${e.label}`);
    continue;
  }
  if (rec.releaseDate === e.debut) {
    unchanged.push({ pairId, label: e.label, debut: e.debut });
    continue;
  }
  applied.push({ pairId, label: e.label, from: rec.releaseDate, to: e.debut });
  rec.releaseDate = e.debut;
}

console.log("=== 初上線日登記簿 ===");
console.log(`  登記   ${Object.keys(registry).length} 筆`);
console.log(`  套用   ${applied.length} 筆`);
console.log(`  未變   ${unchanged.length} 筆 (登記值 = 現值; 這些是防漂移的錨點, 不要刪)`);

for (const a of applied) {
  console.log(`    ${a.pairId}  ${a.label.padEnd(22)} ${a.from ?? "null"} → ${a.to}`);
}

if (orphans.length) {
  // 登記簿指到不存在的 pairId = remap-pair-ids 之後忘了跟著改, 或登記時打錯 id。
  // 這會讓那一筆的修正靜靜失效, 所以一定要吵。
  console.error(`\n✗ 登記簿有 ${orphans.length} 筆指到 catalog 裡不存在的 pairId:`);
  for (const o of orphans) console.error(`  ${o}`);
  console.error(`\n  跑過 scripts/remap-pair-ids.mjs 的話, 登記簿要跟著改。`);
  process.exit(1);
}

if (dryRun) {
  console.log("\n  --dry-run: 沒有寫檔");
} else if (applied.length) {
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, "\t")}\n`, "utf8");
  console.log(`\n  已寫回 src/data/pomatools-pairs.json`);
  console.log(`  ⚠ 記得重跑 npm run data:catalog (投影內容變了, 指紋要跟著換)`);
} else {
  console.log("\n  沒有要改的 (冪等)");
}
