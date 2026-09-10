#!/usr/bin/env node
/**
 * 抓官方卡面並轉成 WebP (資料管線 stage 5b2, 排在 5c 轉檔之前的同一族)。
 *
 * 卡面來源是 pomasters/SyncPairsTracker 的成品卡 (128×128 壓平 PNG) —— 我方不再自己合成。
 * 對照表由 scripts/map-official-cards.mjs 產生, 檔名一律改成 `<pairId>_<3|4|5|EX>`。
 *
 * ⚠ **PNG 快取刻意放在 .cache/ 不放 public/**, 與 reference/trainer 那幾個目錄的慣例不同。
 *   理由是「還不能對外送的拍組」那條紅線: public/ 底下的檔由 Workers Assets 直送,
 *   訪客知道網址就抓得到。把未上架拍組的卡面擋在 public/ 外面, 靠的是「**不產生**」
 *   而不是「產生了再用 .assetsignore 排除」—— 後者只要有人忘了刪那一行就是外洩,
 *   1.1.0 那次就是這個形狀。所以:
 *     PNG  → .cache/official-cards/     (gitignored, 全部拍組都抓, 本機用)
 *     WebP → public/reference/card/     (**進版控**, 只產已上架的)
 *   而且 .assetsignore **一行都不用加**。
 *
 * WebP 進版控的理由 (與 src/data/pomasters/syncpairs.json 同一條): 上游沒有 LICENSE、
 * 沒有 tag、issues 全關, 「隨時可以重新產生」對它不成立; CI 也只跑 npm ci + 部署, 不跑資料管線。
 *
 * 轉檔參數 q90 / alphaQuality 100 / smartSubsample —— 前兩個與既有立繪同一組
 * (alpha 走樣卡框內會出現白邊, 有前科); smartSubsample 是為了卡面上的星星描邊與彩色 EX 字,
 * 那正是 4:2:0 色度取樣最會壞的東西。
 *
 * 用法:
 *   node scripts/fetch-official-cards.mjs              # 抓 + 轉 (冪等)
 *   node scripts/fetch-official-cards.mjs --no-fetch   # 只用既有快取重轉
 *   node scripts/fetch-official-cards.mjs --force      # 全部重轉
 *   node scripts/fetch-official-cards.mjs --keep-orphans  # 不清孤兒 webp
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { loadPairModule } from "./lib-pair-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const PIN_FILE = join(repoRoot, "src", "data", "upstream-pin.json");
const MAP_FILE = join(repoRoot, "src", "data", "official-card-map.json");
const CACHE_DIR = join(repoRoot, ".cache", "official-cards");
const OUT_DIR = join(repoRoot, "public", "reference", "card");

const args = process.argv.slice(2);
const noFetch = args.includes("--no-fetch");
const force = args.includes("--force");
const keepOrphans = args.includes("--keep-orphans");

const CONCURRENCY = 8;
const WEBP = { quality: 90, alphaQuality: 100, smartSubsample: true, effort: 6 };

const fmtMB = (b) => `${(b / 1048576).toFixed(2)}MB`;

/** 一次跑 n 個 */
async function pool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!existsSync(MAP_FILE)) {
    throw new Error(`找不到對照表, 先跑 npm run data:cardmap\n  ${MAP_FILE}`);
  }
  const pin = JSON.parse(readFileSync(PIN_FILE, "utf8"));
  const map = JSON.parse(readFileSync(MAP_FILE, "utf8"));
  const { all, isUnreleasedPair } = await loadPairModule();
  const byId = new Map(all.map((r) => [r.pairId, r]));

  // 未上架的拍組**不產 webp**。判準走真正的 isUnreleasedPair (含判準 B 的日期比較),
  // 所以上架當天重跑這支就會自動補出來 —— 不需要任何人記得去刪一行排除設定。
  const held = [];
  const jobs = []; // { pairId, tier, upstream, png, webp, emit }
  for (const e of map.entries) {
    const rec = byId.get(e.pairId);
    const emit = rec ? !isUnreleasedPair(rec) : false;
    if (!emit) held.push(e.pairId);
    for (const [tier, upstream] of Object.entries(e.files)) {
      jobs.push({
        pairId: e.pairId,
        tier,
        upstream,
        png: join(CACHE_DIR, `${e.pairId}_${tier}.png`),
        webp: join(OUT_DIR, `${e.pairId}_${tier}.webp`),
        emit,
      });
    }
  }

  console.log("=== 官方卡面 ===");
  console.log(`  上游       ${pin.repo}@${pin.sha.slice(0, 7)}  ${pin.upstreamVersion}`);
  console.log(`  對照表     ${map.entries.length} 組拍組 ・ ${jobs.length} 個檔`);
  if (held.length) {
    console.log(`  暫不產出   ${held.length} 組 (未上架, ${jobs.filter((j) => !j.emit).length} 個檔) — 上架日重跑就會補上`);
  }

  // ── 下載 (只補缺的; pin 住 sha 所以內容固定, 有檔就不必重抓) ──
  mkdirSync(CACHE_DIR, { recursive: true });
  const missing = jobs.filter((j) => !existsSync(j.png));
  if (missing.length && noFetch) {
    throw new Error(`--no-fetch 但快取缺 ${missing.length} 個檔`);
  }
  if (missing.length) {
    console.log(`\n  下載 ${missing.length} 個檔 (已有 ${jobs.length - missing.length})…`);
    const failed = [];
    let done = 0;
    await pool(missing, CONCURRENCY, async (j) => {
      const url = `https://raw.githubusercontent.com/${pin.repo}/${pin.sha}/${j.upstream}`;
      try {
        const res = await fetch(encodeURI(url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(j.png, Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        failed.push(`${j.upstream} — ${err.message}`);
      }
      if (++done % 200 === 0) console.log(`    ${done}/${missing.length}`);
    });
    if (failed.length) {
      // 圖沒抓到線上就是空卡, 這條不可以 soft
      console.error(`\n✗ 下載失敗 ${failed.length} 個:`);
      for (const f of failed.slice(0, 20)) console.error(`  ${f}`);
      process.exit(1);
    }
  }

  // ── 轉 WebP (只轉已上架的) ──
  mkdirSync(OUT_DIR, { recursive: true });
  const emitJobs = jobs.filter((j) => j.emit);
  let converted = 0, skipped = 0, pngBytes = 0, webpBytes = 0;
  const sizes = [];
  await pool(emitJobs, CONCURRENCY, async (j) => {
    const fresh =
      !force && existsSync(j.webp) && statSync(j.webp).mtimeMs >= statSync(j.png).mtimeMs;
    if (fresh) {
      skipped++;
      webpBytes += statSync(j.webp).size;
      pngBytes += statSync(j.png).size;
      return;
    }
    await sharp(j.png).webp(WEBP).toFile(j.webp);
    converted++;
    const w = statSync(j.webp).size;
    pngBytes += statSync(j.png).size;
    webpBytes += w;
    sizes.push(w);
  });

  // ── 清孤兒 (只刪 webp, 不刪快取的 PNG) ──
  const wanted = new Set(emitJobs.map((j) => `${j.pairId}_${j.tier}.webp`));
  let removed = 0;
  if (!keepOrphans && existsSync(OUT_DIR)) {
    for (const name of readdirSync(OUT_DIR)) {
      if (!name.toLowerCase().endsWith(".webp")) continue;
      if (wanted.has(name)) continue;
      rmSync(join(OUT_DIR, name));
      removed++;
    }
  }

  console.log(`\n  轉檔       新轉 ${converted} ・ 沿用 ${skipped}${removed ? ` ・ 清孤兒 ${removed}` : ""}`);
  console.log(`  體積       PNG ${fmtMB(pngBytes)} → WebP ${fmtMB(webpBytes)}  (${((webpBytes / pngBytes) * 100).toFixed(1)}%)`);
  console.log(`  平均       ${(webpBytes / emitJobs.length / 1024).toFixed(1)}KB/張 ・ 共 ${emitJobs.length} 檔`);
  console.log(`  產出       public/reference/card/`);
  console.log(`\n  ⚠ WebP 要 commit; .cache/ 不進版控。.assetsignore 一行都不用加 —— 未上架的根本沒產生。`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
