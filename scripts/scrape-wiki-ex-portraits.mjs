#!/usr/bin/env node
/**
 * 下載 wiki EX-style 立繪 (VS...EX.png) + 對應 base 立繪 (去掉 EX) 做 EX 裝偵測/顯示參照。
 *
 * EX style = 同姿勢換色, 因此「base vs EX」最強訊號是色彩。為了公平比對 (同一畫風來源),
 * 同時抓 base 與 EX 兩張 (都來自 wiki VS 立繪), 而非拿 brybry render 比 wiki 圖。
 *
 * 來源: wiki-ex-style.json 的 roster (hasExStyle + pomaTrainerId + sixExImage)。
 * 透過 Fandom imageinfo API 解出真實 URL (回傳的其實是 WebP), 用 sharp 轉 PNG 128×128。
 *
 * 輸出:
 *   public/reference/trainer-ex/{trainerId}_ex.png        — EX 換裝立繪 (顯示 + 偵測)
 *   public/reference/trainer-ex-base/{trainerId}_base.png — 對應 base 立繪 (偵測公平比對)
 *   src/data/ex-portraits.json                            — { trainerId: { ex, base } } 下載結果
 *
 * 用法: node scripts/scrape-wiki-ex-portraits.mjs   (已存在的檔會略過)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const API = "https://pokemon-masters-ex-game.fandom.com/api.php";

const exDir = join(repoRoot, "public", "reference", "trainer-ex");
const baseDir = join(repoRoot, "public", "reference", "trainer-ex-base");
mkdirSync(exDir, { recursive: true });
mkdirSync(baseDir, { recursive: true });

function curl(url, asBinary) {
  // -s silent, --fail 非 2xx 報錯; binary 回傳 base64 再解 (避免 stdout 編碼問題)
  if (asBinary) {
    const b64 = execFileSync(
      "curl",
      ["-sSL", "--fail", "-A", UA, url, "--output", "-"],
      { maxBuffer: 64 * 1024 * 1024, encoding: "base64" }
    );
    return Buffer.from(b64, "base64");
  }
  return execFileSync("curl", ["-sSL", "--fail", "-A", UA, url], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** 批次查 imageinfo (titles 最多 50/req) → { "File:X.png": url|null } */
function resolveUrls(fileTitles) {
  const out = new Map();
  for (let i = 0; i < fileTitles.length; i += 50) {
    const chunk = fileTitles.slice(i, i + 50);
    const titles = encodeURIComponent(chunk.join("|"));
    const url = `${API}?action=query&titles=${titles}&prop=imageinfo&iiprop=url&format=json`;
    const j = JSON.parse(curl(url, false));
    const pages = j.query?.pages ?? {};
    // normalized: API 可能改寫標題, 建立對照
    const norm = new Map();
    for (const n of j.query?.normalized ?? []) norm.set(n.to, n.from);
    for (const k in pages) {
      const p = pages[k];
      const ii = p.imageinfo?.[0];
      const key = norm.get(p.title) ?? p.title;
      out.set(key, ii?.url ?? null);
    }
    process.stdout.write(`  resolved ${Math.min(i + 50, fileTitles.length)}/${fileTitles.length}\r`);
  }
  console.log("");
  return out;
}

async function downloadPng(url, dest) {
  if (existsSync(dest)) return "skip";
  const buf = curl(url, true);
  // wiki 回傳 WebP (副檔名雖是 .png) → sharp 自動辨識, 轉 128×128 PNG 保留 alpha
  await sharp(buf)
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(dest);
  return "ok";
}

async function main() {
  const wiki = JSON.parse(
    readFileSync(join(repoRoot, "src", "data", "wiki-ex-style.json"), "utf8")
  );

  // 收集 hasExStyle 且有 pomaTrainerId 的 (trainerId, exFile)
  const targets = new Map(); // trainerId → { exFile, baseFile }
  for (const r of wiki.roster) {
    if (!r.hasExStyle || !r.pomaTrainerId || !r.sixExImage) continue;
    const exFile = `File:${r.sixExImage}`;
    // base 立繪檔名 = EX 檔去掉結尾的 "EX" (VSSygnaSuitRedEX.png → VSSygnaSuitRed.png)
    const baseFile = `File:${r.sixExImage.replace(/EX\.png$/i, ".png")}`;
    if (!targets.has(r.pomaTrainerId)) {
      targets.set(r.pomaTrainerId, { exFile, baseFile });
    }
  }
  console.log(`需要立繪的拍組 (hasExStyle): ${targets.size}`);

  // 解析 URL
  const exTitles = [...targets.values()].map((t) => t.exFile);
  const baseTitles = [...targets.values()].map((t) => t.baseFile);
  console.log("解析 EX 立繪 URL...");
  const exUrls = resolveUrls(exTitles);
  console.log("解析 base 立繪 URL...");
  const baseUrls = resolveUrls([...new Set(baseTitles)]);

  // 下載
  const result = {};
  let exOk = 0, exSkip = 0, exMiss = 0, baseOk = 0, baseMiss = 0;
  let i = 0;
  for (const [trainerId, { exFile, baseFile }] of targets) {
    i++;
    const exUrl = exUrls.get(exFile);
    const baseUrl = baseUrls.get(baseFile);
    const rec = { ex: null, base: null };
    if (exUrl) {
      try {
        const st = await downloadPng(exUrl, join(exDir, `${trainerId}_ex.png`));
        rec.ex = `/reference/trainer-ex/${trainerId}_ex.png`;
        st === "skip" ? exSkip++ : exOk++;
      } catch (e) {
        exMiss++; console.warn(`\n  EX 下載失敗 ${trainerId}: ${e.message}`);
      }
    } else exMiss++;
    if (baseUrl) {
      try {
        await downloadPng(baseUrl, join(baseDir, `${trainerId}_base.png`));
        rec.base = `/reference/trainer-ex-base/${trainerId}_base.png`;
        baseOk++;
      } catch {
        baseMiss++;
      }
    } else baseMiss++;
    result[trainerId] = rec;
    if (i % 50 === 0) process.stdout.write(`  下載 ${i}/${targets.size}\r`);
  }
  console.log("");
  console.log(`EX 立繪: ${exOk} 新下載, ${exSkip} 已存在, ${exMiss} 無 URL`);
  console.log(`base 立繪: ${baseOk} 下載, ${baseMiss} 無 (偵測時 fallback brybry)`);

  writeFileSync(
    join(repoRoot, "src", "data", "ex-portraits.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), portraits: result }, null, 2)
  );
  console.log(`\n寫入 → src/data/ex-portraits.json (${Object.keys(result).length} 筆)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
