// Build the production embedding cache for all sync pairs.
//   Per pair: pokemon CLS embedding + trainer CLS embedding + trainer fg color hist.
//   Output: src/data/pair-embeddings.json  (read once at runtime by embed-matcher.ts)
//
// Run: node scripts/build-embeddings.mjs
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline, RawImage } from "@huggingface/transformers";

const MODEL = "Xenova/dinov2-small";
const HB = 5; // trainer color hist bins/channel
const OUT = "src/data/pair-embeddings.json";

const pairs = JSON.parse(await fs.readFile("src/data/pomatools-pairs.json", "utf8")).records;
// EX 換裝立繪 (scrape-wiki-ex-portraits.mjs 產出): 真實 EX 立繪 + base 立繪 (同 wiki 來源, 公平比對)
let exPortraits = {};
try {
  exPortraits = JSON.parse(await fs.readFile("src/data/ex-portraits.json", "utf8")).portraits ?? {};
} catch {
  console.warn("(無 ex-portraits.json; EX style 偵測參照將略過)");
}
console.log(`loading ${MODEL} ...`);
const extractor = await pipeline("image-feature-extraction", MODEL);

async function clsEmb(pngBuf) {
  const img = await RawImage.fromBlob(new Blob([pngBuf]));
  const out = await extractor(img);
  const [, , dim] = out.dims;
  const v = new Float32Array(dim);
  for (let k = 0; k < dim; k++) v[k] = out.data[k]; // CLS token
  let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s) || 1;
  for (let k = 0; k < dim; k++) v[k] /= n;
  return Array.from(v, (x) => +x.toFixed(5));
}
function hist(rgb, alpha) {
  const h = new Float32Array(HB ** 3); const st = 256 / HB;
  for (let i = 0, p = 0; i < rgb.length; i += 3, p++) {
    if (alpha && alpha[p] < 90) continue;
    if (rgb[i] < 6 && rgb[i + 1] < 6 && rgb[i + 2] < 6) continue;
    const r = Math.min(HB - 1, (rgb[i] / st) | 0), g = Math.min(HB - 1, (rgb[i + 1] / st) | 0), b = Math.min(HB - 1, (rgb[i + 2] / st) | 0);
    h[r * HB * HB + g * HB + b]++;
  }
  let s = 0; for (const v of h) s += v * v; const n = Math.sqrt(s) || 1;
  return Array.from(h, (x) => +(x / n).toFixed(5));
}

const refPokePng = (b) => sharp(b).resize(160, 160, { fit: "contain", background: { r: 240, g: 240, b: 240 } }).flatten({ background: { r: 240, g: 240, b: 240 } }).png().toBuffer();
const refTrainerPng = (b) => sharp(b).resize(180, 180, { fit: "fill" }).flatten({ background: { r: 240, g: 240, b: 240 } }).png().toBuffer();
// EX-conditioned ref: trainer on a rainbow background (matches 6★EX cell rendering)
const RAINBOW = Buffer.from(`<svg width="180" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a8a"/><stop offset="0.28" stop-color="#ffe89a"/><stop offset="0.5" stop-color="#9affc0"/><stop offset="0.72" stop-color="#9ad8ff"/><stop offset="1" stop-color="#dca0ff"/></linearGradient></defs><rect width="180" height="180" fill="url(#g)"/></svg>`);
const refTrainerExPng = async (b) => {
  const t = await sharp(b).ensureAlpha().resize(168, 168, { fit: "inside" }).png().toBuffer();
  return sharp(RAINBOW).composite([{ input: t, gravity: "center" }]).flatten({ background: { r: 240, g: 240, b: 240 } }).png().toBuffer();
};
async function refTrainerHist(b) {
  const rgb = (await sharp(b).resize(64, 64, { fit: "fill" }).flatten({ background: { r: 0, g: 0, b: 0 } }).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  const a = (await sharp(b).ensureAlpha().resize(64, 64, { fit: "fill" }).extractChannel(3).raw().toBuffer({ resolveWithObject: true })).data;
  return hist(rgb, a);
}

const entries = [];
let miss = 0;
let exCount = 0;
for (const p of pairs) {
  try {
    const tb = await fs.readFile(path.join("public", p.trainerImagePath.replace(/^\//, "")));
    const pb = await fs.readFile(path.join("public", p.pokemonImagePath.replace(/^\//, "")));
    const entry = {
      id: p.pairId,
      pEmb: await clsEmb(await refPokePng(pb)),
      tEmb: await clsEmb(await refTrainerPng(tb)),
      tEmbEx: await clsEmb(await refTrainerExPng(tb)),  // 6★EX (rainbow bg) ref — 無 EX style 時用
      tHist: await refTrainerHist(tb),
    };
    // EX style 立繪存在 → 加真實 EX 換裝參照 (embedding + 色彩直方圖)
    // 必須 gate 在 p.hasExStyle: trainerId 跨拍組共用, 不能把 EX 參照漏給無 EX style 的手足
    const port = p.hasExStyle ? exPortraits[p.trainerId] : null;
    if (port?.ex) {
      try {
        const eb = await fs.readFile(path.join("public", port.ex.replace(/^\//, "")));
        entry.tEmbExStyle = await clsEmb(await refTrainerPng(eb)); // 真實 EX 換裝 embedding
        entry.tHistExStyle = await refTrainerHist(eb);             // EX 換裝色彩
        // wiki base 立繪 (同來源) → 公平的「base 色彩」基準; 沒有就 runtime fallback tHist
        if (port.base) {
          const bb = await fs.readFile(path.join("public", port.base.replace(/^\//, "")));
          entry.tHistBaseWiki = await refTrainerHist(bb);
        }
        exCount++;
      } catch (e) {
        console.warn("  ex portrait skip", p.pairId, e.message);
      }
    }
    entries.push(entry);
  } catch (e) {
    miss++; console.warn("skip", p.pairId, e.message);
  }
  if (entries.length % 100 === 0) console.log("  ", entries.length);
}
console.log(`EX style 參照: ${exCount} 隻`);

const payload = { model: MODEL, dimP: entries[0].pEmb.length, dimT: entries[0].tEmb.length, dimH: entries[0].tHist.length, count: entries.length, entries };
void 0;
await fs.writeFile(OUT, JSON.stringify(payload));
const sz = (await fs.stat(OUT)).size;
console.log(`\ndone: ${entries.length} pairs (${miss} missing) → ${OUT} (${(sz / 1e6).toFixed(1)}MB)`);
