// wiki / brybry 全身立繪 → brybry 128 縮圖規格的共用處理
// (fetch-wiki-trainer-images.mjs 與 add-wiki-pairs.mjs 共用, 不要各自再抄)
//
// **為什麼要有這支**: 卡片是把整張立繪塞進固定的 144×144 再裁切
// (components/sync-pair-card.tsx), 所以「人物在畫布裡多大、在哪」完全由圖決定。
// brybry 原生縮圖是**頭肩胸像** (臉大、頭頂到框緣、下緣到胸口); 全身圖直接縮放就會
// 變成「小人漂浮」, 一整面卡牆裡那幾張一眼就看得出來
// (2026-09-08 使用者回報:「人物的位置都跟其他拍組有落差」)。
//
// **取景基準是量出來的**: 對 471 張原生縮圖掃 alpha, 頭寬約佔框寬 44%、頭頂貼齊上緣、
// 肩胸被下緣裁掉 (所以原生圖的下緣留白一律是 0)。這也正是找出問題圖的判準 ——
// `下緣有留白` = 整個人都在框內 = 沒有被裁成胸像。
//
// **一張圖一組參數, 不要再用啟發式**: 舊版是「取頂部 寬×0.85 的帶狀」, 那在
//   - 動作大、手臂張開的圖 (寬 ≥ 高×0.85) 完全不裁 → 全身被壓進框裡;
//   - 兜帽/誇張髮型 (伊芙、丘助的寶可夢連帽裝) 頭部比例與常人不同;
// 兩種都失準。而需要處理的只有 9 張, 逐張目視定參數比自動偵測可靠得多
// (頭寬偵測會把華蓮的雙馬尾當成頭, 量出 0.719 —— 比原生基準還「大」, 完全反了)。

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

/** 不透明內容的邊界框 (alpha > 64 —— 門檻太低會把半透明光暈算進來, 整張畫布都變成「內容」) */
export async function figureBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > 64) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("整張圖都是透明的");
  return { W, H, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 全身立繪 → 128×128 頭肩胸像。
 *
 * @param band 從人物頭頂往下取多少 (佔人物**全高**的比例) = 「拉多近」。
 *             一般站姿 0.26; 兜帽角色要放大到 0.38 (兜帽讓頭部比例變高, 0.26 會切過臉);
 *             半身構圖的原圖 0.34。實際值見 fetch-wiki-trainer-images.mjs 的 TARGETS。
 * @param cx   取景中心 x (佔人物寬度的比例, 0.5 = 正中)。手臂張開或道具偏一邊時才需要調。
 *
 * 產出對齊原生規格: **內容一路填到下緣** (肩胸被下框裁掉), 頭頂上方留 2px。
 * ⚠ 不要在下方 extend 留白 —— 原生縮圖的下緣留白一律是 0, 墊了就又變成
 * 「人物浮在框裡」, 那正是這支函式要修的問題 (tests/trainer-art.test.ts 會擋)。
 */
export async function toPortrait(buf, { band, cx = 0.5 }) {
  const HEADROOM = 2;
  const f = await figureBox(buf);
  const cropH = Math.round(f.h * band);
  // 與目標框同比例, 才不會變形
  const cropW = Math.round((cropH * 128) / (128 - HEADROOM));
  let left = Math.round(f.x + f.w * cx - cropW / 2);
  left = Math.max(0, Math.min(Math.max(0, f.W - cropW), left));
  const top = Math.max(0, f.y);
  const inner = await sharp(buf)
    .extract({
      left,
      top,
      width: Math.min(cropW, f.W - left),
      height: Math.min(cropH, f.H - top),
    })
    .resize(128, 128 - HEADROOM, { fit: "cover", position: "north" })
    .png()
    .toBuffer();
  return sharp(inner)
    .extend({ top: HEADROOM, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** @deprecated 舊的啟發式版本, 只留給還沒改的呼叫端; 新的一律用 toPortrait */
export async function toTrainer128(buf) {
  return toPortrait(buf, { band: 0.26, cx: 0.5 });
}
