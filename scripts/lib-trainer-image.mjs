// 全身立繪 → brybry 原生「頭肩胸像」規格的共用處理
// (fetch-wiki-trainer-images.mjs 用它, 不要各自再抄一份)
//
// ## 為什麼要有這支
//
// 卡片把整張立繪塞進固定的框再裁切 (components/sync-pair-card.tsx), 所以「人物多大、
// 在哪」完全由圖決定。brybry 原生縮圖是頭肩胸像; 通用職業 NPC 與主角給的是**全身圖**,
// 縮進同一個框就變成「小人漂浮」, 一整面卡牆裡一眼就看得出來。
//
// ## ⚠ 卡片只顯示原圖的中央那一塊 —— 比對裸圖會被騙 (2026-09-08 踩過)
//
// sync-pair-card.tsx 的幾何: 外 svg `viewBox 0 0 128 128`, 立繪是
// `<image x=-8 y=-5 width=144 height=144>` 再裁進 CARD_POLY (外接矩形 x 14..114, y 14..120)。
// 換算回原圖 = **只看得到 x 20..108、y 17..111** (上下各切 17px, 左右各切 20px)。
//
// 第一版就是拿「整張 128 裸圖」並排比對, 看起來一致就收工, 結果實際卡片上頭太大、人偏左
// (使用者:「跟其他的比較還是差很多吧, 像伊布那個頭就太大了, 主角的話應該是太靠左了」)。
// **改參數後一定要用卡片的可見範圍預覽**, 不要看裸圖。
//
// ## 取景基準是量出來的
//
// 對原生縮圖掃 alpha 得到 TARGET: 頭寬約佔框寬 44%、頭心在 x=0.363 (略偏左)、
// 頭頂貼齊上緣。`alignToNative()` 在原圖上量同樣三個數字, 直接算出縮放與位移對過去。
//
// ## gain / dx / dy 為什麼還是要逐張給
//
// 自動量頭寬會被**誇張的髮型與裝扮**騙: 華蓮的雙馬尾、伊芙的伊布耳朵、紗幽子的長髮
// 都會被算進「頭寬」→ 縮太小 (實測 gain=1 時她們是整個人站在框裡)。
// 只有 9 張, 逐張目視定比自動偵測可靠。**gain 大 = 更近**。

// 一般 import 而不是 createRequire —— 這支會被本機工具頁的 API route 一起打包,
// createRequire(import.meta.url) 與 new URL(..., import.meta.url) 都會讓 bundler 解析失敗。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/** wiki 原圖的本機快取 (ref/ 不進版控) —— 調參數要重算很多次, 不該每次都打 wiki */
const CACHE_DIR = path.join(process.cwd(), "ref/.art-src");

/** 下載並快取原圖; 腳本與工具頁的 API 共用同一份 */
export async function sourceBuffer(id, url) {
  const cached = path.join(CACHE_DIR, id + ".png");
  if (existsSync(cached)) return readFileSync(cached);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, buf);
  return buf;
}

/** 原生胸像的取景基準 (128 畫布上的像素) */
export const TARGET = { headW: 0.438 * 128, headCx: 0.363 * 128, headTop: 0.016 * 128 };

/**
 * 量「頭」: 人物 bbox 的上緣 8~20% 那一帶的中位跨距與中心。
 * alpha 門檻 64 —— 太低會把半透明光暈算成內容, 整張畫布都變「有東西」。
 */
export async function headMetrics(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const opaque = (x, y) => data[(y * W + x) * C + 3] > 64;
  const runs = [];
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++) {
      if (opaque(x, y)) {
        if (l < 0) l = x;
        r = x;
      }
    }
    runs.push(l < 0 ? null : { l, r });
    if (l >= 0) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (top < 0) throw new Error("整張圖都是透明的");
  const figH = bottom - top + 1;
  const band = runs
    .slice(top + Math.round(figH * 0.08), top + Math.round(figH * 0.2))
    .filter(Boolean);
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return {
    W,
    H,
    top,
    headW: median(band.map((r) => r.r - r.l + 1)),
    headCx: median(band.map((r) => (r.l + r.r + 1) / 2)),
  };
}

/**
 * 全身立繪 → 128×128, 讓頭的大小與位置對齊原生胸像。
 *
 * @param gain 頭要多大 (1 = 完全照 TARGET; **大於 1 = 更近**)
 * @param dx   往右移幾 px (輸出座標)
 * @param dy   往下移幾 px (輸出座標)
 */
export async function alignToNative(buf, { gain = 1, dx = 0, dy = 0 } = {}) {
  const m = await headMetrics(buf);
  const scale = (TARGET.headW * gain) / m.headW;
  const win = 128 / scale; // 要從原圖取多大一塊
  const originX = m.headCx - (TARGET.headCx + dx) / scale;
  const originY = m.top - (TARGET.headTop + dy) / scale;
  // extract 不能越界 → 先把四周墊出足夠的透明邊 (人物可能貼著原圖邊緣)
  const pad =
    Math.ceil(Math.max(0, -originX, -originY, originX + win - m.W, originY + win - m.H)) + 2;
  const padded = await sharp(buf)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(padded)
    .extract({
      left: Math.round(originX + pad),
      top: Math.round(originY + pad),
      width: Math.round(win),
      height: Math.round(win),
    })
    .resize(128, 128)
    .png()
    .toBuffer();
}
