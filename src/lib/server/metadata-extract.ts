// 從 cell 抽取 metadata: 星數 / EX / Lv 數字 / 寶數
//
//   - 星數+EX: template match cell top-left 對 p5_0..5.png / pex_0..5.png / pex_ex.png
//     (取代舊版黃色 bucket 啟發式)
//   - Lv: tesseract OCR 純數字
//   - 寶: tesseract OCR 單一數字 (六邊形中央)

import "server-only";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { createWorker, type Worker as TWorker } from "tesseract.js";

import { avgRGBWindow, subImageRGB } from "@/lib/server/_math";

// ========== 共享解碼 (decode-once) ==========
// 整張截圖只解碼一次成 RGB raw; 所有偵測器改吃這個 buffer, 不再各自 sharp(imageBuffer).extract()
// 重新解碼 4096px 原圖 (舊版每個 cell ~38 次 × 20 cells ≈ 760 次解碼/request)。
export type DecodedImage = {
  data: Uint8Array; // RGB, 已 removeAlpha
  width: number;
  height: number;
};

export async function decodeFull(imageBuffer: Buffer): Promise<DecodedImage> {
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// 從整張 raw 裡裁出一塊 cell-local 子影像, 包成可再 .extract()/.resize() 的 sharp 物件。
// (像素等同於 sharp(原圖).extract(同區域); 已實測 maxAbsDiff=0)。回傳含 sharp factory 與子影像尺寸。
// 偵測器只用 .sharp()/width/height (resize crops), 不直接讀 raw → 型別不含 data。
type CellSub = {
  width: number;
  height: number;
  /** 用子影像建立 sharp pipeline (供需要 resize 的偵測器) */
  sharp: () => sharp.Sharp;
};

/**
 * 從已解碼整張影像裁出一塊 cell-local 子影像並回傳可 .extract()/.resize() 的 sharp factory。
 * 內部偵測器與 embed-matcher 的 poke/trainer/hist crops 都用它從子影像 (而非 4096px 原圖) 裁切。
 * 像素等同於 sharp(原圖).extract(rect)。
 */
export function cellSubSharp(img: DecodedImage, rect: CellRect): CellSub {
  const { data, width, height } = subImageRGB(img.data, img.width, img.height, rect.x, rect.y, rect.width, rect.height);
  return {
    width,
    height,
    sharp: () => sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 3 } }),
  };
}

export type CellMetadata = {
  starCount: number; // 1-6 (當前升級星數; 6=EX)
  exUnlocked: boolean;
  /** 星標 EX 徽章為彩虹版 (pex_ex) = 已達 6★EX / 顯示 EX 造型 (確定性訊號) */
  exStyleActive: boolean;
  level: number | null;
  potential: number | null;
  /** 超覺醒等級 1-5 (左下為旋風圖標時); 0 = 非超覺醒 */
  superAwakening: number;
  /** 當前星級 (= exUnlocked ? 6 : starCount) — 用於 base<=current 約束 */
  currentRarity: number;
  /** 偵測到的主屬性 (type icon 模板比對); null = 信心不足 */
  detectedType: string | null;
  /** type 偵測信心 (0-1, 越高越確定) */
  typeConfidence: number;
  /** 偵測到的角色群組 strike/support/tech/sprint/field/multi; null = 信心不足 */
  detectedRole: string | null;
  /** role 偵測信心 */
  roleConfidence: number;
};

export type CellRect = { x: number; y: number; width: number; height: number };

// ========== 星數 + EX (template matching) ==========
// 從 cell top-left 裁切, resize 到 80×40, 跟 13 個官方星星 PNG 模板做 masked MSE
// 模板分類:
//   p5_0..5 → 1-5★ (一般), exUnlocked=false
//   pex_0..5 → 6★ EX-capable (各 promotion 階段), exUnlocked=true
//   pex_ex → 6★ 最終 EX 模式, exUnlocked=true

const NORM_W = 80;
const NORM_H = 40;

type StarTemplate = {
  file: string;
  starCount: number;
  exUnlocked: boolean;
  rgba: Buffer;  // NORM_W × NORM_H × 4 (RGBA), 用 alpha 當 mask
};

// 重要: pex_0..5 = 灰色 EX 徽章 = 5★ 滿、EX-capable 但「尚未升 6★EX」(背景金色, 證實為 5★)。
//       只有 pex_ex = 彩虹 EX 徽章 = 真正 6★EX (背景彩虹/淡)。
//       (舊版誤把 pex_0..5 全當 6★EX/exUnlocked, 導致 5★ 拍組星級/背景都錯)
const TEMPLATE_CONFIGS: Array<{ file: string; stars: number; ex: boolean }> = [
  { file: "p5_0", stars: 1, ex: false }, // 1★ 通常 = 沒有星標
  { file: "p5_1", stars: 1, ex: false },
  { file: "p5_2", stars: 2, ex: false },
  { file: "p5_3", stars: 3, ex: false },
  { file: "p5_4", stars: 4, ex: false },
  { file: "p5_5", stars: 5, ex: false },
  { file: "pex_0", stars: 5, ex: false }, // 灰 EX = 5★ EX-capable, 未升 6★EX
  { file: "pex_1", stars: 5, ex: false },
  { file: "pex_2", stars: 5, ex: false },
  { file: "pex_3", stars: 5, ex: false },
  { file: "pex_4", stars: 5, ex: false },
  { file: "pex_5", stars: 5, ex: false },
  { file: "pex_ex", stars: 6, ex: true }, // 彩虹 EX = 真正 6★EX
];

let templatesCache: StarTemplate[] | null = null;
let templatesPromise: Promise<StarTemplate[]> | null = null;

async function loadTemplates(): Promise<StarTemplate[]> {
  if (templatesCache) return templatesCache;
  if (templatesPromise) return templatesPromise;
  templatesPromise = (async () => {
    const arr: StarTemplate[] = [];
    const baseDir = join(process.cwd(), "public", "reference", "ui");
    for (const cfg of TEMPLATE_CONFIGS) {
      const path = join(baseDir, `${cfg.file}.png`);
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      const rgba = await sharp(buf)
        .resize(NORM_W, NORM_H, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer();
      arr.push({ file: cfg.file, starCount: cfg.stars, exUnlocked: cfg.ex, rgba });
    }
    templatesCache = arr;
    return arr;
  })();
  return templatesPromise;
}

async function detectStars(
  sub: CellSub,
  rect: CellRect
): Promise<{ starCount: number; exUnlocked: boolean; exStyleActive: boolean; template: string | null }> {
  const templates = await loadTemplates();
  if (templates.length === 0) return { starCount: 5, exUnlocked: false, exStyleActive: false, template: null };

  // 裁切 cell 左上 (星星區): 50% 寬 × 22% 高
  const cropW = Math.round(rect.width * 0.5);
  const cropH = Math.round(rect.height * 0.22);
  if (cropW < 20 || cropH < 10) return { starCount: 5, exUnlocked: false, exStyleActive: false, template: null };

  const cellRgba = await sub.sharp()
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .resize(NORM_W, NORM_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // masked MSE — 只對模板 alpha > 0.5 的像素算誤差
  let bestStars = 5;
  let bestEx = false;
  let bestFile: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of templates) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < t.rgba.length; i += 4) {
      const a = t.rgba[i + 3]!;
      if (a < 128) continue;
      const dr = cellRgba[i]! - t.rgba[i]!;
      const dg = cellRgba[i + 1]! - t.rgba[i + 1]!;
      const db = cellRgba[i + 2]! - t.rgba[i + 2]!;
      sum += dr * dr + dg * dg + db * db;
      count++;
    }
    if (count === 0) continue;
    const score = sum / count;
    if (score < bestScore) {
      bestScore = score;
      bestStars = t.starCount;
      bestEx = t.exUnlocked;
      bestFile = t.file;
    }
  }
  // EX style active = 星標 EX 徽章是彩虹版 (pex_ex), 而非灰色 (pex_0..5)。
  // 這是「已升到 6★EX / 顯示 EX 造型」的確定性訊號 (實測 18/18 對中)。
  return { starCount: bestStars, exUnlocked: bestEx, exStyleActive: bestFile === "pex_ex", template: bestFile };
}

// 外框顏色判 rarity (獨立於星數的交叉驗證)
//   銅(3★) #c46f4d系 / 銀(4★) 灰 / 金(5★) #eecc22系 / 彩虹(6★EX) 高彩度多色
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
  const d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function detectFrameRarity(
  img: DecodedImage,
  rect: CellRect
): { rarity: number; confidence: number } {
  // 取卡片邊框數個取樣點 (避開星星/Lv/寶/pokemon 角落), 看主色
  // 邊框在卡片最外圈; 取上緣中段 + 左右緣中段
  // (decode-once: 直接索引共享 raw buffer, 不再各取樣點各自 sharp.extract)
  const pts: Array<[number, number]> = [
    [0.5, 0.06], [0.5, 0.94],  // 上中, 下中
    [0.05, 0.5], [0.95, 0.5],  // 左中, 右中
    [0.5, 0.10], [0.5, 0.90],
  ];
  const hues: number[] = [];
  const sats: number[] = [];
  const vals: number[] = [];
  for (const [fx, fy] of pts) {
    const px = rect.x + Math.round(fx * rect.width);
    const py = rect.y + Math.round(fy * rect.height);
    // 對齊舊版: left/top 夾在 0 以上, 視窗超出右/下邊界則略過 (舊版 sharp.extract 會丟例外被 catch)
    const acc = avgRGBWindow(img.data, img.width, img.height, Math.max(0, px - 2), Math.max(0, py - 2), 4, 4);
    if (!acc || acc.n === 0) continue;
    const r = acc.r / acc.n, g = acc.g / acc.n, b = acc.b / acc.n;
    const [h, s, v] = rgbToHsv(r, g, b);
    hues.push(h); sats.push(s); vals.push(v);
  }
  if (hues.length < 3) return { rarity: 5, confidence: 0 };

  const avgSat = sats.reduce((a, b) => a + b, 0) / sats.length;
  // 彩虹: hue 變異大 (各取樣點顏色差很多) 且彩度高
  const hueSpread = (() => {
    let maxD = 0;
    for (let i = 0; i < hues.length; i++)
      for (let j = i + 1; j < hues.length; j++) {
        let d = Math.abs(hues[i]! - hues[j]!);
        if (d > 180) d = 360 - d;
        maxD = Math.max(maxD, d);
      }
    return maxD;
  })();
  const highSatCount = sats.filter((s) => s > 0.4).length;

  if (hueSpread > 90 && highSatCount >= 2) {
    return { rarity: 6, confidence: 0.6 }; // 彩虹 6★EX
  }
  // 低彩度 = 銀 (4★)
  if (avgSat < 0.18) {
    return { rarity: 4, confidence: 0.4 };
  }
  // 有彩度: 看平均 hue — 金(黃 45-60°) vs 銅(橘 15-40°)
  const avgHue = hues.reduce((a, b) => a + b, 0) / hues.length;
  if (avgHue >= 42 && avgHue <= 65) return { rarity: 5, confidence: 0.4 }; // 金
  if (avgHue >= 10 && avgHue < 42) return { rarity: 3, confidence: 0.35 }; // 銅
  return { rarity: 5, confidence: 0.15 }; // 不確定, 預設金低信心
}

// ========== Lv / 寶 OCR (tesseract) ==========
// 小型 worker pool (取代單一 module-global worker): OCR 不再把整條 pipeline 序列化。
// 同時跑數個 cell 的 Lv/寶 OCR 時可平行, 各 worker 互不阻塞。
const OCR_POOL_SIZE = 3; // 2-4 之間; cell 併發為 4, 取 3 平衡記憶體

type OcrPool = {
  workers: TWorker[];
  /** 取得一個閒置 worker (簡單 round-robin + 互斥鎖) */
  acquire: () => Promise<{ worker: TWorker; release: () => void }>;
};

let ocrPoolPromise: Promise<OcrPool> | null = null;

async function createOcrWorker(): Promise<TWorker> {
  const w = await createWorker("eng");
  await w.setParameters({ tessedit_char_whitelist: "0123456789" });
  return w;
}

async function getOcrPool(): Promise<OcrPool> {
  if (ocrPoolPromise) return ocrPoolPromise;
  ocrPoolPromise = (async () => {
    const workers = await Promise.all(
      Array.from({ length: OCR_POOL_SIZE }, () => createOcrWorker()),
    );
    const busy = new Array<boolean>(workers.length).fill(false);
    const waiters: Array<(idx: number) => void> = [];
    const acquire = (): Promise<{ worker: TWorker; release: () => void }> => {
      const idx = busy.findIndex((b) => !b);
      const make = (i: number) => {
        busy[i] = true;
        return {
          worker: workers[i]!,
          release: () => {
            const next = waiters.shift();
            if (next) next(i); // 直接交棒給等待者, 維持 busy=true
            else busy[i] = false;
          },
        };
      };
      if (idx >= 0) return Promise.resolve(make(idx));
      return new Promise((resolve) => {
        waiters.push((i) => resolve(make(i)));
      });
    };
    return { workers, acquire };
  })();
  return ocrPoolPromise;
}

// 單一預處理變體 → PNG buffer (lazy fallback 用; 不一次全做)
function ocrVariant(buf: Buffer, variant: 0 | 1 | 2): Promise<Buffer> {
  const base = sharp(buf).resize({ width: 240, withoutEnlargement: false }).greyscale().normalize();
  if (variant === 0) return base.png().toBuffer();              // 直接放大 + greyscale
  if (variant === 1) return base.threshold(180).png().toBuffer(); // 二值化 (適合白字)
  return base.negate().png().toBuffer();                          // 反轉 (適合白字在亮底)
}

// lazy fallback: 先跑變體 1, 能 parse 就停; 不行才跑 2/3。
// parseDigits 一律回傳「texts 中第一個合理數字」, 故先停在變體 1 與全跑後結果完全相同。
async function ocrDigitsMulti(buf: Buffer, label: string, min: number, max: number): Promise<string[]> {
  const pool = await getOcrPool();
  const { worker, release } = await pool.acquire();
  const texts: string[] = [];
  try {
    for (let v = 0 as 0 | 1 | 2; v <= 2; v = (v + 1) as 0 | 1 | 2) {
      try {
        const img = await ocrVariant(buf, v);
        const { data } = await worker.recognize(img);
        texts.push(data.text.replace(/\s/g, ""));
      } catch (e) {
        console.warn(`[ocr ${label}] variant ${v} failed`, e);
      }
      // 變體 v 已能 parse 出合理數字 → 不必再跑後續變體 (結果相同)
      if (parseDigits(texts, min, max) != null) break;
    }
  } finally {
    release();
  }
  return texts;
}

function parseDigits(texts: string[], min: number, max: number): number | null {
  // 從所有變體挑出第一個合理的數字
  for (const t of texts) {
    const digits = t.replace(/[^0-9]/g, "");
    if (!digits) continue;
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n >= min && n <= max) return n;
  }
  // 也允許單字 (例如 "1")
  for (const t of texts) {
    const m = t.match(/[0-9]/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n >= min && n <= max) return n;
    }
  }
  return null;
}

async function detectLevel(
  sub: CellSub,
  rect: CellRect
): Promise<number | null> {
  // Lv 數字區: x 55~99%, y 0~22% (避開 Lv. 字母, 只看數字; 加寬以容納 3 位數 200)
  const x = Math.round(rect.width * 0.55); // cell-local (sub-image 以 cell 左上為原點)
  const y = Math.round(rect.height * 0.0);
  const w = Math.round(rect.width * 0.44);
  const h = Math.round(rect.height * 0.22);
  if (w < 10 || h < 10) return null;
  const cropBuf = await sub.sharp()
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
  // 等級上限 200 (超覺醒可達 Lv 200; 舊版 150 會漏判 Lv 200 拍組)
  const texts = await ocrDigitsMulti(cropBuf, "lv", 1, 200);
  return parseDigits(texts, 1, 200);
}

async function detectPotential(
  sub: CellSub,
  rect: CellRect
): Promise<number | null> {
  // 寶六邊形: x 0~28%, y 65~95%
  const x = Math.round(rect.width * 0.0);
  const y = Math.round(rect.height * 0.65);
  const w = Math.round(rect.width * 0.28);
  const h = Math.round(rect.height * 0.32);
  if (w < 10 || h < 10) return null;
  const cropBuf = await sub.sharp()
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
  const texts = await ocrDigitsMulti(cropBuf, "pot", 1, 5);
  return parseDigits(texts, 1, 5);
}

// ========== 超覺醒偵測 (左下圖標: 旋風 vs 寶六邊形) ==========
// 超覺醒 (super awakening) 的左下圖標是「藍色旋風 (awakening.png)」, 取代一般的
// 「彩虹寶六邊形 (sync_icon.png)」。最強訊號 = 色彩: 旋風幾乎純藍 (無暖色); 彩虹六邊形含紅/橙/黃。
// 實測 (1199304.jpg): 超覺醒 #1 = 暖色 4% / 藍 86%; 一般六邊形暖色 12-37% → 乾淨分離。
const AWK_N = 40;
const AWK_RING = (() => {
  const m = new Uint8Array(AWK_N * AWK_N);
  for (let y = 0; y < AWK_N; y++)
    for (let x = 0; x < AWK_N; x++) {
      const dx = (x + 0.5) / AWK_N - 0.5, dy = (y + 0.5) / AWK_N - 0.5;
      const r = Math.hypot(dx, dy);
      m[y * AWK_N + x] = r > 0.20 && r < 0.52 ? 1 : 0; // 環狀, 排除中央數字
    }
  return m;
})();

async function detectSuperAwakening(
  sub: CellSub,
  rect: CellRect
): Promise<boolean> {
  const w = Math.round(rect.width * 0.28);
  const h = Math.round(rect.height * 0.30);
  if (w < 10 || h < 10) return false;
  let reg: Buffer;
  try {
    reg = await sub.sharp()
      .extract({ left: 0, top: Math.round(rect.height * 0.70), width: w, height: h })
      .resize(AWK_N, AWK_N, { fit: "fill" }).removeAlpha().raw().toBuffer();
  } catch {
    return false;
  }
  let warm = 0, blue = 0, tot = 0;
  for (let i = 0, p = 0; i < reg.length; i += 3, p++) {
    if (!AWK_RING[p]) continue;
    const [hh, s, v] = rgbToHsv(reg[i]!, reg[i + 1]!, reg[i + 2]!);
    if (s < 0.25 || v < 0.2) continue; // 跳過 白字/暗邊
    tot++;
    if (hh < 55 || hh > 335) warm++;        // 紅/橙/黃 (彩虹六邊形才有)
    else if (hh >= 185 && hh <= 255) blue++; // 藍/青 (旋風主色)
  }
  if (tot < 8) return false;
  const warmFrac = warm / tot, blueFrac = blue / tot;
  // 旋風: 幾乎無暖色 + 藍佔多數 → 超覺醒
  return warmFrac < 0.10 && blueFrac > 0.60;
}

// ========== 屬性偵測 (type icon 模板比對) ==========

const TYPE_NUM_TO_NAME: Record<string, string> = {
  "001": "normal", "002": "fire", "003": "water", "004": "electric",
  "005": "grass", "006": "ice", "007": "fighting", "008": "poison",
  "009": "ground", "010": "flying", "011": "psychic", "012": "bug",
  "013": "rock", "014": "ghost", "015": "dragon", "016": "dark",
  "017": "steel", "018": "fairy",
};

const TYPE_NORM = 32; // type icon 比對尺寸

type TypeTemplate = { name: string; rgba: Buffer };
let typeTplCache: TypeTemplate[] | null = null;
let typeTplPromise: Promise<TypeTemplate[]> | null = null;

async function loadTypeTemplates(): Promise<TypeTemplate[]> {
  if (typeTplCache) return typeTplCache;
  if (typeTplPromise) return typeTplPromise;
  typeTplPromise = (async () => {
    const arr: TypeTemplate[] = [];
    const baseDir = join(process.cwd(), "public", "reference", "ui");
    for (const [num, name] of Object.entries(TYPE_NUM_TO_NAME)) {
      const path = join(baseDir, `TYPE_${num}.png`);
      if (!existsSync(path)) continue;
      const rgba = await sharp(readFileSync(path))
        .resize(TYPE_NORM, TYPE_NORM, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .raw()
        .toBuffer();
      arr.push({ name, rgba });
    }
    typeTplCache = arr;
    return arr;
  })();
  return typeTplPromise;
}

async function detectType(
  sub: CellSub,
  rect: CellRect
): Promise<{ type: string | null; confidence: number }> {
  const templates = await loadTypeTemplates();
  if (templates.length === 0) return { type: null, confidence: 0 };

  // 屬性 icon = 右側最上方那顆圓圈 (sync/主屬性)。校準自 auto-detect 實際 cell:
  //   x 0.80-0.99, y 0.26-0.42 (Lv 下方第一個 icon; 不要含下方的 moveType/類別徽章)
  const x = Math.round(rect.width * 0.80); // cell-local
  const y = Math.round(rect.height * 0.26);
  const w = Math.round(rect.width * 0.19);
  const h = Math.round(rect.height * 0.16);
  if (w < 10 || h < 8) return { type: null, confidence: 0 };

  const cellRgba = await sub.sharp()
    .extract({ left: x, top: y, width: w, height: h })
    .resize(TYPE_NORM, TYPE_NORM, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // masked MSE (只比模板不透明像素), 找最小誤差
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;
  for (const t of templates) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < t.rgba.length; i += 4) {
      if (t.rgba[i + 3]! < 128) continue;
      const dr = cellRgba[i]! - t.rgba[i]!;
      const dg = cellRgba[i + 1]! - t.rgba[i + 1]!;
      const db = cellRgba[i + 2]! - t.rgba[i + 2]!;
      sum += dr * dr + dg * dg + db * db;
      count++;
    }
    if (count === 0) continue;
    const score = sum / count;
    if (score < bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = t.name;
    } else if (score < secondScore) {
      secondScore = score;
    }
  }

  // 信心 = best 跟 second 的相對差距 (越分得開越有信心)
  // bestScore 越小越好; 用 second/best ratio 當信心指標
  let confidence = 0;
  if (best && Number.isFinite(secondScore) && bestScore > 0) {
    const ratio = secondScore / bestScore; // >1, 越大越確定
    confidence = Math.min(1, Math.max(0, (ratio - 1) * 1.5));
    // 絕對誤差太大 (整片不像任何 type icon) 也降低信心
    if (bestScore > 4000) confidence *= 0.3;
  }
  return { type: best, confidence };
}

// ========== 角色定位偵測 (左側 icon 對 ROLE_*.png) ==========

// roleAsset → 角色群組 (P/S strike 視覺難分, 過濾用 group)
const ROLE_ASSET_GROUP: Record<string, string> = {
  ROLE_001P: "strike", ROLE_001S: "strike",
  ROLE_002: "support", ROLE_004: "tech",
  ROLE_008: "sprint", ROLE_016: "field", ROLE_032: "multi",
};
const ROLE_TEMPLATE_FILES = ["ROLE_001P", "ROLE_002", "ROLE_004", "ROLE_008", "ROLE_016", "ROLE_032"];
const ROLE_NORM = 32;

type RoleTemplate = { group: string; rgba: Buffer };
let roleTplCache: RoleTemplate[] | null = null;
let roleTplPromise: Promise<RoleTemplate[]> | null = null;

async function loadRoleTemplates(): Promise<RoleTemplate[]> {
  if (roleTplCache) return roleTplCache;
  if (roleTplPromise) return roleTplPromise;
  roleTplPromise = (async () => {
    const arr: RoleTemplate[] = [];
    const baseDir = join(process.cwd(), "public", "reference", "ui");
    for (const f of ROLE_TEMPLATE_FILES) {
      const path = join(baseDir, `${f}.png`);
      if (!existsSync(path)) continue;
      const rgba = await sharp(readFileSync(path))
        .resize(ROLE_NORM, ROLE_NORM, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer();
      arr.push({ group: ROLE_ASSET_GROUP[f] ?? "strike", rgba });
    }
    roleTplCache = arr;
    return arr;
  })();
  return roleTplPromise;
}

async function detectRole(
  sub: CellSub,
  rect: CellRect
): Promise<{ group: string | null; confidence: number }> {
  const templates = await loadRoleTemplates();
  if (templates.length === 0) return { group: null, confidence: 0 };
  // role icon = 左側星星下方 (x 0.01-0.19, y 0.29-0.46)
  const x = Math.round(rect.width * 0.01); // cell-local
  const y = Math.round(rect.height * 0.29);
  const w = Math.round(rect.width * 0.19);
  const h = Math.round(rect.height * 0.18);
  if (w < 10 || h < 8) return { group: null, confidence: 0 };

  const cellRgba = await sub.sharp()
    .extract({ left: x, top: y, width: w, height: h })
    .resize(ROLE_NORM, ROLE_NORM, { fit: "fill" })
    .ensureAlpha().raw().toBuffer();

  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;
  for (const t of templates) {
    let sum = 0, count = 0;
    for (let i = 0; i < t.rgba.length; i += 4) {
      if (t.rgba[i + 3]! < 128) continue;
      const dr = cellRgba[i]! - t.rgba[i]!;
      const dg = cellRgba[i + 1]! - t.rgba[i + 1]!;
      const db = cellRgba[i + 2]! - t.rgba[i + 2]!;
      sum += dr * dr + dg * dg + db * db;
      count++;
    }
    if (count === 0) continue;
    const score = sum / count;
    if (score < bestScore) { secondScore = bestScore; bestScore = score; best = t.group; }
    else if (score < secondScore) secondScore = score;
  }
  let confidence = 0;
  if (best && Number.isFinite(secondScore) && bestScore > 0) {
    confidence = Math.min(1, Math.max(0, (secondScore / bestScore - 1) * 1.5));
    if (bestScore > 4000) confidence *= 0.3;
  }
  return { group: best, confidence };
}

// ========== 技能屬性 (move-type) icon 偵測 ==========
// 卡片右緣由上往下堆疊的圓形屬性圖標 (1~3 個)。用「內圈底色最近模板色 + 白色符號比例」
// 判斷每個 slot 是否有 icon + 屬於哪個屬性。橘色系 (火/格鬥/地面/岩石/一般) 顏色相近難分,
// 但 count + 高彩度屬性 (鋼/水/草/電/超能力/妖精/惡/毒/龍/幽靈/蟲/飛行) 很可靠。

const MT_ORANGE_FAMILY = new Set(["fire", "fighting", "ground", "rock", "normal"]);
const MT_SLOTS: Array<[number, number, number, number]> = [
  [0.80, 0.255, 0.165, 0.125],
  [0.80, 0.415, 0.165, 0.125],
  [0.80, 0.575, 0.165, 0.125],
];
const MT_N = 24;
const MT_DISC = (() => {
  const d = new Uint8Array(MT_N * MT_N);
  for (let y = 0; y < MT_N; y++) for (let x = 0; x < MT_N; x++) {
    const dx = (x + 0.5) / MT_N - 0.5, dy = (y + 0.5) / MT_N - 0.5;
    d[y * MT_N + x] = Math.hypot(dx, dy) < 0.42 ? 1 : 0;
  }
  return d;
})();

export type MoveTypeDetection = { count: number; types: string[]; specific: string[] };

type TypeBg = { name: string; r: number; g: number; b: number };
let typeBgCache: TypeBg[] | null = null;
let typeBgPromise: Promise<TypeBg[]> | null = null;

function discBgStats(rgba: Buffer | Uint8Array, isTemplate: boolean) {
  let br = 0, bg = 0, bb = 0, bn = 0, white = 0, total = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    if (!MT_DISC[p]) continue;
    if (isTemplate && rgba[i + 3]! < 128) continue;
    total++;
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const lum = (r + g + b) / 3;
    if (lum > 190 && Math.abs(r - g) < 45 && Math.abs(g - b) < 45) white++;
    else { br += r; bg += g; bb += b; bn++; }
  }
  bn = bn || 1;
  return { r: br / bn, g: bg / bn, b: bb / bn, whiteFrac: white / (total || 1) };
}

async function loadTypeBgColors(): Promise<TypeBg[]> {
  if (typeBgCache) return typeBgCache;
  if (typeBgPromise) return typeBgPromise;
  typeBgPromise = (async () => {
    const out: TypeBg[] = [];
    const baseDir = join(process.cwd(), "public", "reference", "ui");
    for (const [num, name] of Object.entries(TYPE_NUM_TO_NAME)) {
      const p = join(baseDir, `TYPE_${num}.png`);
      if (!existsSync(p)) continue;
      const rgba = await sharp(readFileSync(p))
        .resize(MT_N, MT_N, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer();
      const s = discBgStats(rgba, true);
      out.push({ name, r: s.r, g: s.g, b: s.b });
    }
    typeBgCache = out;
    return out;
  })();
  return typeBgPromise;
}

// 屬性色系 (用模板底色聚類): 主屬性偵測只需分得出色系即可 (橘色系內 火/格鬥 不需細分)
const TYPE_FAMILY: Record<string, string> = {
  fire: "warm", fighting: "warm", ground: "warm", rock: "warm",
  normal: "gray", steel: "gray", dark: "gray",
  water: "blue", ice: "blue", dragon: "blue", flying: "blue",
  grass: "green", bug: "green",
  electric: "yellow",
  psychic: "pink", fairy: "pink", poison: "pink", ghost: "pink",
};
export function typeFamilyOf(type: string): string | null {
  return TYPE_FAMILY[type] ?? null;
}

// 主屬性偵測: 讀「最上方屬性 icon 的內圈底色」(避開銅圈), 比最近模板色 → 屬性/色系。
// 這是強訊號 (例如截圖篩選成格鬥, 非格鬥候選可直接排除)。
export async function detectPrimaryType(
  img: DecodedImage,
  rect: CellRect
): Promise<{ type: string | null; family: string | null; confidence: number }> {
  const colors = await loadTypeBgColors();
  if (colors.length === 0) return { type: null, family: null, confidence: 0 };
  const sx = rect.x + Math.round(0.825 * rect.width);
  const sy = rect.y + Math.round(0.275 * rect.height);
  const sw = Math.round(0.105 * rect.width);
  const sh = Math.round(0.085 * rect.height);
  if (sw < 4 || sh < 4) return { type: null, family: null, confidence: 0 };
  let r = 0, g = 0, b = 0, n = 0;
  // decode-once: 直接索引共享 raw buffer (僅取樣求平均, 無 resize → 像素等同舊版 extract)
  const { data } = subImageRGB(img.data, img.width, img.height, sx, sy, sw, sh);
  for (let i = 0; i < data.length; i += 3) {
    const lum = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    if (lum > 200 || lum < 40) continue;   // 排除白符號 + 暗邊
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
  }
  if (n < 4) return { type: null, family: null, confidence: 0 };
  r /= n; g /= n; b /= n;
  let best: TypeBg | null = null, bd = Infinity;
  for (const c of colors) { const d = Math.hypot(r - c.r, g - c.g, b - c.b); if (d < bd) { bd = d; best = c; } }
  const confidence = Math.max(0, Math.min(1, (70 - bd) / 70));
  return { type: best?.name ?? null, family: best ? (TYPE_FAMILY[best.name] ?? null) : null, confidence };
}

export async function detectMoveTypes(
  sub: CellSub,
  rect: CellRect
): Promise<MoveTypeDetection> {
  const colors = await loadTypeBgColors();
  if (colors.length === 0) return { count: 0, types: [], specific: [] };
  const types: string[] = [];
  for (const [fx, fy, fw, fh] of MT_SLOTS) {
    const sx = Math.round(fx * rect.width); // cell-local
    const sy = Math.round(fy * rect.height);
    const sw = Math.round(fw * rect.width);
    const sh = Math.round(fh * rect.height);
    if (sw < 6 || sh < 6) break;
    let stats: ReturnType<typeof discBgStats>;
    try {
      const rgba = await sub.sharp()
        .extract({ left: sx, top: sy, width: sw, height: sh })
        .resize(MT_N, MT_N, { fit: "fill" }).ensureAlpha().raw().toBuffer();
      stats = discBgStats(rgba, false);
    } catch { break; }
    let best: string | null = null, bd = Infinity;
    for (const c of colors) {
      const d = Math.hypot(stats.r - c.r, stats.g - c.g, stats.b - c.b);
      if (d < bd) { bd = d; best = c.name; }
    }
    // 圖標需有白色符號 (whiteFrac) 且底色非常貼近某屬性。icon 由上往下連續, 缺一即止
    // 嚴格門檻避免「空 slot 落在青色卡背」被誤判成冰/水/龍
    const present = best != null && stats.whiteFrac > 0.10 && bd < 48;
    if (!present) break;
    types.push(best!);
  }
  const specific = types.filter((t) => !MT_ORANGE_FAMILY.has(t));
  return { count: types.length, types, specific };
}

// ========== 角色定位 icon 偵測 v2 (左側 banner, 灰階 ZNCC + offset 搜尋) ==========
// 左側青色 banner + 白色符號 (»=速戰 ▲=場地 拳=攻擊 ♡=輔助 齒=技術 圈=複合)。
// banner 顏色相同, 靠「符號形狀」分; 用模板灰階 masked ZNCC, 小範圍位移搜尋抗 banner 上下飄移。

const ROLEICON_FILES: Record<string, string> = {
  ROLE_001P: "strike", ROLE_002: "support", ROLE_004: "tech",
  ROLE_008: "sprint", ROLE_016: "field", ROLE_032: "multi",
};
const ROLEICON_N = 40;
const ROLEICON_BASE: [number, number, number, number] = [0.0, 0.275, 0.205, 0.20];
const ROLEICON_DX = [-0.015, 0, 0.015];
const ROLEICON_DY = [-0.03, -0.015, 0, 0.015, 0.03, 0.045];

type RoleIconTpl = { group: string; g: Float32Array; m: Uint8Array };
let roleIconCache: RoleIconTpl[] | null = null;
let roleIconPromise: Promise<RoleIconTpl[]> | null = null;

async function loadRoleIconTpls(): Promise<RoleIconTpl[]> {
  if (roleIconCache) return roleIconCache;
  if (roleIconPromise) return roleIconPromise;
  roleIconPromise = (async () => {
    const out: RoleIconTpl[] = [];
    const baseDir = join(process.cwd(), "public", "reference", "ui");
    for (const [file, group] of Object.entries(ROLEICON_FILES)) {
      const p = join(baseDir, `${file}.png`);
      if (!existsSync(p)) continue;
      const { data } = await sharp(readFileSync(p))
        .resize(ROLEICON_N, ROLEICON_N, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const g = new Float32Array(ROLEICON_N * ROLEICON_N), m = new Uint8Array(ROLEICON_N * ROLEICON_N);
      for (let i = 0, q = 0; i < data.length; i += 4, q++) { g[q] = (data[i]! + data[i + 1]! + data[i + 2]!) / 3; m[q] = data[i + 3]! > 100 ? 1 : 0; }
      out.push({ group, g, m });
    }
    roleIconCache = out;
    return out;
  })();
  return roleIconPromise;
}

function roleIconZncc(a: Float32Array, t: RoleIconTpl): number {
  let ma = 0, mb = 0, n = 0;
  for (let i = 0; i < a.length; i++) { if (!t.m[i]) continue; ma += a[i]!; mb += t.g[i]!; n++; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { if (!t.m[i]) continue; const u = a[i]! - ma, v = t.g[i]! - mb; num += u * v; da += u * u; db += v * v; }
  return num / (Math.sqrt(da * db) || 1);
}

export async function detectRoleIcon(
  img: DecodedImage,
  rect: CellRect
): Promise<{ group: string | null; confidence: number; margin: number; scores: Record<string, number> }> {
  const tpls = await loadRoleIconTpls();
  if (tpls.length === 0) return { group: null, confidence: 0, margin: 0, scores: {} };
  const [bx, by, bw, bh] = ROLEICON_BASE;
  const cw = Math.round(bw * rect.width), ch = Math.round(bh * rect.height);
  if (cw < 8 || ch < 8) return { group: null, confidence: 0, margin: 0, scores: {} };
  // decode-once: 18 個 offset 位置不再各自對 4096px 原圖 extract。
  // 改先從共享 raw 裁出涵蓋整個搜尋帶 (含 offset 範圍) 的單一子影像, 再在子影像上滑窗。
  // 像素等同舊版 sharp(原圖).extract(各 offset).resize(...)。
  // 邊界語意: 仍以「絕對座標 left/top < 0」判定略過 (與舊版一致); 子影像帶足夠 padding,
  // 故略左偏移 (cell-local 為負但絕對 ≥0) 時仍能取到 cell 左側的真實像素。
  const absLefts: number[] = [], absTops: number[] = [];
  for (const dx of ROLEICON_DX) absLefts.push(rect.x + Math.round((bx + dx) * rect.width));
  for (const dy of ROLEICON_DY) absTops.push(rect.y + Math.round((by + dy) * rect.height));
  // 子影像原點夾在 0 以上 (被略過的負座標窗格不影響); 保留滑窗 rebase 正確性。
  const subLeft = Math.max(0, Math.min(...absLefts));
  const subTop = Math.max(0, Math.min(...absTops));
  const subW = Math.max(...absLefts) - subLeft + cw;
  const subH = Math.max(...absTops) - subTop + ch;
  const band = subImageRGB(img.data, img.width, img.height, subLeft, subTop, subW, subH);
  const bandSharp = () => sharp(Buffer.from(band.data.buffer, band.data.byteOffset, band.data.byteLength), { raw: { width: band.width, height: band.height, channels: 3 } });
  const grays: Float32Array[] = [];
  for (const dy of ROLEICON_DY) for (const dx of ROLEICON_DX) {
    const left = rect.x + Math.round((bx + dx) * rect.width);
    const top = rect.y + Math.round((by + dy) * rect.height);
    if (left < 0 || top < 0) continue;
    try {
      const { data } = await bandSharp()
        .extract({ left: left - subLeft, top: top - subTop, width: cw, height: ch })
        .resize(ROLEICON_N, ROLEICON_N, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
      grays.push(Float32Array.from(data));
    } catch { /* edge */ }
  }
  if (grays.length === 0) return { group: null, confidence: 0, margin: 0, scores: {} };
  const scored = tpls.map((t) => {
    let bz = -2; for (const g of grays) { const z = roleIconZncc(g, t); if (z > bz) bz = z; }
    return { group: t.group, z: bz };
  }).sort((a, b) => b.z - a.z);
  const scores: Record<string, number> = {};
  for (const s of scored) scores[s.group] = Math.max(scores[s.group] ?? -2, s.z);
  return { group: scored[0]!.group, confidence: scored[0]!.z, margin: scored[0]!.z - (scored[1]?.z ?? 0), scores };
}

// ========== entry ==========

export async function extractMetadata(
  img: DecodedImage,
  rect: CellRect
): Promise<CellMetadata> {
  // decode-once: 共用一塊 cell-local 子影像給需要 resize 的偵測器; 取樣型偵測直接索引整張 raw。
  const sub = cellSubSharp(img, rect);
  const [stars, level, potential, awakened, typeRes, roleRes] = await Promise.all([
    detectStars(sub, rect),
    detectLevel(sub, rect),
    detectPotential(sub, rect),
    detectSuperAwakening(sub, rect),
    detectType(sub, rect),
    detectRole(sub, rect),
  ]);
  const frameRar = detectFrameRarity(img, rect); // 純取樣 (同步)
  const starRarity = stars.exUnlocked ? 6 : stars.starCount;
  // 6★EX 由星標「彩虹 EX 徽章」(exUnlocked/exStyleActive) 確定性判定; 框色只用來分 3/4/5。
  // 非 6★EX 時上限壓在 5 — 否則金色 5★ 邊框會被 detectFrameRarity 誤判成彩虹(6) → 星級/背景都錯。
  const currentRarity = stars.exUnlocked
    ? 6
    : Math.min(5, frameRar.confidence >= 0.35 ? Math.max(starRarity, frameRar.rarity) : starRarity);
  // 左下圖標是旋風 → 該數字是「超覺醒等級」而非「寶數」; 兩者互斥, 分開回報以免混淆數值。
  return {
    starCount: stars.starCount,
    exUnlocked: stars.exUnlocked,
    exStyleActive: stars.exStyleActive,
    level,
    potential: awakened ? null : potential,
    superAwakening: awakened ? (potential ?? 0) : 0,
    currentRarity,
    detectedType: typeRes.confidence >= 0.35 ? typeRes.type : null,
    typeConfidence: typeRes.confidence,
    detectedRole: roleRes.confidence >= 0.35 ? roleRes.group : null,
    roleConfidence: roleRes.confidence,
  };
}

export async function terminateOcrWorker() {
  if (ocrPoolPromise) {
    const pool = await ocrPoolPromise;
    await Promise.all(pool.workers.map((w) => w.terminate()));
    ocrPoolPromise = null;
  }
}

/**
 * 預熱: 觸發所有 module-scope singleton (template 載入 + OCR worker pool),
 * 讓第一個真正的 request 不必冷啟。供 /api/warmup 呼叫。
 */
export async function warmupMetadata(): Promise<void> {
  await Promise.all([
    loadTemplates(),
    loadTypeTemplates(),
    loadRoleTemplates(),
    loadTypeBgColors(),
    loadRoleIconTpls(),
    getOcrPool(),
  ]);
}
