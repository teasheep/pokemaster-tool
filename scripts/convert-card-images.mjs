#!/usr/bin/env node
/**
 * 卡片圖轉 WebP — 線上只送 .webp, PNG 原檔留在 repo。
 *
 * 為什麼 PNG 不刪:
 *   build-embeddings.mjs / lib/server 的辨識管線讀的是 catalog 裡的 **PNG 路徑**
 *   (public/reference/{trainer,pokemon,ui}/*.png), 刪掉本機就重算不了 embedding。
 *   → PNG 留 repo, 靠 public/.assetsignore 讓它們不進 Cloudflare 部署。
 *
 * 轉哪些 (只轉「網頁真的會請求」的圖; 其餘目錄沒有任何 UI 在用, 見 public/.assetsignore):
 *   reference/trainer     訓練家立繪   q90   卡片主圖, 去背
 *   reference/pokemon     寶可夢圖     q90   卡片右下圓圈, 去背
 *   reference/ui          星星/屬性/角色/徽章  q92 (線條圖示, 給高一點)
 *   reference/ui/candy    糖果圖示     q92 + 縮到 128px (見下面 CANDY_PX)
 *
 * 一律 alphaQuality:100 — 卡片是去背圖, alpha 走樣會在卡框內看到白邊
 * (AGENTS.md「卡片外觀是照遊戲重現的規格」)。`--verify` 會把 alpha RMSE 印出來驗這件事。
 *
 * **trainer / pokemon 只轉 catalog 指得到的**: 這兩個目錄裡有一千多張是 pairId remap 與
 * dedupe 留下的歷史殘留 (沒有任何一筆 record 指到)。全轉的話部署圖片有 60% 是沒人會請求的
 * 孤兒圖。所以以 catalog 的 trainerId / pokemonId 為準, 並把不再被指到的 .webp 一併清掉
 * (**只刪 .webp, PNG 一律留著** — 之後 catalog 又指回來時重跑就會補回)。
 * ui / ui/candy 檔名是程式碼寫死拼出來的, 不吃 catalog, 整個目錄照轉。
 *
 * 冪等可重跑 (與其他資料管線腳本一致): 已存在且比 PNG 新的 .webp 直接跳過。
 * 因為要讀最終的 catalog, 這支在管線裡排最後 (5c) — 見 scripts/update-catalog.mjs。
 *
 * 用法:
 *   node scripts/convert-card-images.mjs                # 只轉新的/過期的 + 清孤兒
 *   node scripts/convert-card-images.mjs --force        # 全部重轉
 *   node scripts/convert-card-images.mjs --keep-orphans # 不清孤兒 .webp
 *   node scripts/convert-card-images.mjs --verify       # 只做畫質驗證 (抽樣比對 PNG vs WebP)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cpus } from "node:os";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const publicDir = join(repoRoot, "public");

const args = process.argv.slice(2);
const force = args.includes("--force");
const verifyOnly = args.includes("--verify");
const keepOrphans = args.includes("--keep-orphans");

/**
 * catalog 指得到的圖檔名 — 卡片的路徑是 `{trainerId}_128` 與 `{pokemonId}_128`
 * (見 src/components/sync-pair-card.tsx), 所以這裡就用同一套規則反推。
 * catalog 讀不到就回 null = 不過濾 (寧可多轉也不要少轉)。
 */
function catalogImageNames() {
  const p = join(repoRoot, "src", "data", "pomatools-pairs.json");
  if (!existsSync(p)) {
    console.warn("⚠ 找不到 catalog, 這次不做 catalog 過濾 (整個目錄都轉)");
    return null;
  }
  const records = JSON.parse(readFileSync(p, "utf8")).records ?? [];
  const trainer = new Set();
  const pokemon = new Set();
  for (const r of records) {
    if (r.trainerId) trainer.add(`${r.trainerId}_128.png`);
    if (r.pokemonId) pokemon.add(`${r.pokemonId}_128.png`);
  }
  if (!trainer.size || !pokemon.size) {
    console.warn("⚠ catalog 沒有 trainerId/pokemonId, 這次不做 catalog 過濾");
    return null;
  }
  return { trainer, pokemon };
}
const CATALOG_NAMES = verifyOnly ? null : catalogImageNames();

/**
 * 糖果圖的輸出邊長。
 * 依據 (src/components/gym/candy.tsx 的實際 CSS 尺寸):
 *   CandyBar 可編輯模式 size=60 (手機) / 56 (桌機) ← 全站最大
 *   CandyBar 唯讀/精簡 size=34 / 22 ・ 變化紀錄列 size=44
 * 最大 60px × 3 (現代手機多是 DPR3, 這個站主要在手機上用) = 180 → 往上取整到 192。
 * 來源是 256×256, 仍然縮得下來。**要放大顯示尺寸就要同步調大這裡, 不然會糊。**
 * (先前取 DPR2 的 128 會讓可編輯的糖果列在 DPR3 手機上被放大 1.4 倍。)
 */
const CANDY_PX = 192;

const TARGETS = [
  // wanted: 只轉 catalog 指得到的那些 (其餘是 remap/dedupe 的歷史殘留, 沒有任何頁面會請求)
  { name: "reference/trainer", dir: join(publicDir, "reference", "trainer"), quality: 90, wanted: CATALOG_NAMES?.trainer },
  { name: "reference/pokemon", dir: join(publicDir, "reference", "pokemon"), quality: 90, wanted: CATALOG_NAMES?.pokemon },
  // ui 根層只掃自己這一層 (candy 子目錄另有縮圖規則, 不能被一起吃掉)
  { name: "reference/ui", dir: join(publicDir, "reference", "ui"), quality: 92 },
  { name: "reference/ui/candy", dir: join(publicDir, "reference", "ui", "candy"), quality: 92, resize: CANDY_PX },
];

function listPngs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
    .map((e) => e.name)
    .sort();
}

function fmtMB(bytes) {
  return `${(bytes / 1048576).toFixed(2)}MB`;
}

/** 已有的 .webp 比 PNG 新 → 跳過 (冪等) */
function isFresh(pngPath, webpPath) {
  if (force || !existsSync(webpPath)) return false;
  return statSync(webpPath).mtimeMs >= statSync(pngPath).mtimeMs;
}

async function convertOne(pngPath, webpPath, { quality, resize }) {
  let img = sharp(pngPath);
  if (resize) {
    // fit:inside + withoutEnlargement — 只縮不放, 比例不變 (糖果圖本來就是正方形)
    img = img.resize(resize, resize, { fit: "inside", withoutEnlargement: true });
  }
  await img
    .webp({
      quality,
      // alpha 無損: 去背邊緣一走樣, 卡框內就會出現白邊
      alphaQuality: 100,
      effort: 6,
    })
    .toFile(webpPath);
  // 調 quality 之前先看這組實測 (2026-08-19, trainer+pokemon 各抽 20 張, 只算不透明像素):
  //   q90              33.8% of PNG   RMSE 5.61
  //   q95              41.1%          RMSE 5.24   ← 多 22% 體積只換到 0.4 RMSE, 不划算
  //   q90+smartSubsample 35.2%        RMSE 5.18
  //   lossless:true    60.3%          RMSE 0      ← 真的一個像素都不能變時走這條
  // 殘差主要來自 WebP 有損模式的 4:2:0 色度取樣 (跟 quality 無關), 所以拉 quality 效果有限。
}

/** 簡易併發池 (sharp 本身會用 libvips thread pool, 這裡只控同時開檔數) */
async function runPool(items, worker, limit) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

async function convertTarget(target) {
  const all = listPngs(target.dir);
  const files = target.wanted ? all.filter((n) => target.wanted.has(n)) : all;
  const orphanCount = all.length - files.length;
  if (!files.length) {
    console.log(`  (${target.name}: 沒有 PNG, 跳過)`);
    return null;
  }
  if (!existsSync(target.dir)) mkdirSync(target.dir, { recursive: true });

  let converted = 0;
  let skipped = 0;
  const failed = [];

  await runPool(
    files,
    async (name) => {
      const pngPath = join(target.dir, name);
      const webpPath = pngPath.replace(/\.png$/i, ".webp");
      if (isFresh(pngPath, webpPath)) {
        skipped++;
        return;
      }
      try {
        await convertOne(pngPath, webpPath, target);
        converted++;
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    },
    Math.max(2, cpus().length)
  );

  // 清孤兒 .webp — catalog 不再指到的圖留在部署裡就是純浪費。只刪 .webp, PNG 一律保留
  // (辨識管線還要用; 而且 catalog 之後又指回來時重跑這支就會補回來)。
  let pruned = 0;
  let prunedBytes = 0;
  if (target.wanted && !keepOrphans) {
    for (const name of all) {
      if (target.wanted.has(name)) continue;
      const webpPath = join(target.dir, name.replace(/\.png$/i, ".webp"));
      if (!existsSync(webpPath)) continue;
      prunedBytes += statSync(webpPath).size;
      rmSync(webpPath);
      pruned++;
    }
  }

  // 統計 (轉完才量, 數字才是真的)
  let pngBytes = 0;
  let webpBytes = 0;
  let webpCount = 0;
  for (const name of files) {
    const pngPath = join(target.dir, name);
    const webpPath = pngPath.replace(/\.png$/i, ".webp");
    pngBytes += statSync(pngPath).size;
    if (existsSync(webpPath)) {
      webpBytes += statSync(webpPath).size;
      webpCount++;
    }
  }
  const ratio = pngBytes ? ((webpBytes / pngBytes) * 100).toFixed(1) : "0";
  console.log(
    `  ${target.name.padEnd(20)} ${String(files.length).padStart(5)} 檔  ` +
      `PNG ${fmtMB(pngBytes).padStart(9)} → WebP ${fmtMB(webpBytes).padStart(9)}  (${ratio}%)  ` +
      `新轉 ${converted} ・沿用 ${skipped}` +
      (orphanCount ? `  ・catalog 外 ${orphanCount} 張不轉` : "") +
      (pruned ? ` (清掉 ${pruned} 個孤兒 webp, 省 ${fmtMB(prunedBytes)})` : "") +
      (failed.length ? `  ✖ 失敗 ${failed.length}` : "")
  );
  for (const f of failed) console.error(`     ✖ ${f}`);

  return { name: target.name, files: files.length, webpCount, pngBytes, webpBytes, failed };
}

// ────────── 畫質驗證 ──────────
// PNG 與 WebP 都 decode 成 raw RGBA, 比 RGB 的 RMSE / 最大單通道差, 以及 alpha 的 RMSE。
// alpha RMSE 必須是 0 — 去背邊緣一走樣, 卡框內就會看到白邊。
//
// **RGB 要分「看得見的」跟「全圖」兩組**: 去背圖有一大片 alpha=0 的區域, 那裡的 RGB
// 在 PNG 裡是垃圾值 (編碼器隨便填), WebP 會把它壓成平坦色以省位元 —— 兩邊差很大但
// 螢幕上完全看不到。只看全圖 RMSE 會誤判成「畫質爛掉」(第一次量就是這樣, rmse 22-27)。
// 判準看 visible (alpha>0) 那一組。
async function rawOf(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function comparePair(pngPath, webpPath) {
  const [a, b] = await Promise.all([rawOf(pngPath), rawOf(webpPath)]);
  if (a.w !== b.w || a.h !== b.h) return { sizeMismatch: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
  let allSq = 0;
  let allN = 0;
  let visSq = 0;
  let visN = 0;
  let visMax = 0;
  let alphaSq = 0;
  let alphaN = 0;
  let alphaMax = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const visible = a.data[i + 3] > 0; // alpha=0 的 RGB 是垃圾值, 不列入「看得見的」統計
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      allSq += d * d;
      allN++;
      if (visible) {
        visSq += d * d;
        visN++;
        if (Math.abs(d) > visMax) visMax = Math.abs(d);
      }
    }
    const da = a.data[i + 3] - b.data[i + 3];
    alphaSq += da * da;
    alphaN++;
    if (Math.abs(da) > alphaMax) alphaMax = Math.abs(da);
  }
  return {
    rgbRmse: Math.sqrt(visSq / (visN || 1)), // 看得見的部分 (判準)
    rgbMax: visMax,
    rgbRmseAll: Math.sqrt(allSq / allN), // 含透明區 (僅供對照)
    visRatio: visN / allN,
    alphaRmse: Math.sqrt(alphaSq / alphaN),
    alphaMax,
  };
}

function sample(list, n) {
  const copy = [...list];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

async function verify() {
  console.log("\n=== 畫質驗證 (隨機抽樣 PNG vs WebP, raw RGBA 比對) ===");
  const groups = [
    { name: "trainer", dir: join(publicDir, "reference", "trainer"), n: 30 },
    { name: "pokemon", dir: join(publicDir, "reference", "pokemon"), n: 30 },
  ];
  let worstAlpha = 0;
  const all = [];
  for (const g of groups) {
    const pngs = listPngs(g.dir).filter((f) => existsSync(join(g.dir, f.replace(/\.png$/i, ".webp"))));
    const picked = sample(pngs, g.n);
    const rows = [];
    for (const name of picked) {
      const r = await comparePair(join(g.dir, name), join(g.dir, name.replace(/\.png$/i, ".webp")));
      if (r.sizeMismatch) {
        console.error(`  ✖ ${g.name}/${name}: 尺寸不符 ${r.sizeMismatch}`);
        continue;
      }
      rows.push({ name, ...r });
      all.push({ group: g.name, name, ...r });
      if (r.alphaRmse > worstAlpha) worstAlpha = r.alphaRmse;
    }
    rows.sort((x, y) => y.rgbRmse - x.rgbRmse);
    const avg = rows.reduce((s, r) => s + r.rgbRmse, 0) / (rows.length || 1);
    const avgAll = rows.reduce((s, r) => s + r.rgbRmseAll, 0) / (rows.length || 1);
    console.log(`\n  ${g.name}  抽 ${rows.length} 張 (平均 ${(100 * rows.reduce((s, r) => s + r.visRatio, 0) / (rows.length || 1)).toFixed(0)}% 像素不透明)`);
    console.log(`    RGB RMSE (看得見的)  平均 ${avg.toFixed(3)} ・中位 ${rows[Math.floor(rows.length / 2)]?.rgbRmse.toFixed(3)} ・最差 ${rows[0]?.rgbRmse.toFixed(3)}`);
    console.log(`    RGB RMSE (含透明區)  平均 ${avgAll.toFixed(3)}   ← 透明像素的 RGB 是垃圾值, 僅供對照`);
    console.log(`    alpha RMSE 最大 ${Math.max(...rows.map((r) => r.alphaRmse)).toFixed(6)} ・alpha 最大單點差 ${Math.max(...rows.map((r) => r.alphaMax))}`);
    console.log("    最差 5 張 (看得見的 RGB RMSE / 最大單通道差):");
    for (const r of rows.slice(0, 5)) {
      console.log(`      ${r.name.padEnd(34)} rmse ${r.rgbRmse.toFixed(3)}  max Δ ${String(r.rgbMax).padStart(3)}`);
    }
  }
  console.log("");
  if (worstAlpha === 0) {
    console.log("  ✅ alpha 通道完全無損 (RMSE 0) — 去背邊緣不會有白邊");
  } else {
    console.error(`  ✖ alpha RMSE ${worstAlpha} ≠ 0 — 去背會走樣, 請把 alphaQuality 拉到無損或改 lossless:true 重轉`);
    process.exitCode = 1;
  }
  return all;
}

async function main() {
  if (verifyOnly) {
    await verify();
    return;
  }

  console.log("=== 卡片圖轉 WebP ===");
  console.log(`模式: ${force ? "--force (全部重轉)" : "增量 (已存在且較新的 .webp 沿用)"}`);
  const results = [];
  for (const t of TARGETS) {
    const r = await convertTarget(t);
    if (r) results.push(r);
  }

  const totalPng = results.reduce((s, r) => s + r.pngBytes, 0);
  const totalWebp = results.reduce((s, r) => s + r.webpBytes, 0);
  const totalFiles = results.reduce((s, r) => s + r.files, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed.length, 0);
  console.log("  " + "─".repeat(74));
  console.log(
    `  ${"合計".padEnd(20)} ${String(totalFiles).padStart(5)} 檔  ` +
      `PNG ${fmtMB(totalPng).padStart(9)} → WebP ${fmtMB(totalWebp).padStart(9)}  ` +
      `(${((totalWebp / totalPng) * 100).toFixed(1)}%, 省 ${fmtMB(totalPng - totalWebp)})`
  );

  if (totalFailed) {
    console.error(`\n✖ 有 ${totalFailed} 張轉檔失敗 — 線上會是 404 空圖, 修好再部署。`);
    process.exit(1);
  }
  console.log("\n✅ 完成。畫質驗證: node scripts/convert-card-images.mjs --verify");
}

main().catch((e) => {
  console.error("\n✖ 轉檔失敗:", e);
  process.exit(1);
});
