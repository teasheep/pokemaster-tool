// 訓練家立繪的取景預覽 —— **調 fetch-wiki-trainer-images.mjs 的參數時一定要用這支看**。
//
// 為什麼需要它 (2026-09-08 的前科): 卡片不是把整張 128 圖畫出來, 而是
//   `<image x=-8 y=-5 width=144 height=144>` 再裁進 CARD_POLY
//   → **只看得到原圖的 x 20..108 / y 17..111** (上下各切 17px, 左右各切 20px)。
// 第一版拿整張裸圖並排比對, 看起來一致就收工, 結果實際卡片上頭太大、人偏左
// (使用者:「你有自己截圖看過了嗎? 跟其他的比較還是差很多吧」)。
//
// 用法:
//   node scripts/preview-trainer-art.mjs                      → 那 9 張重裁過的 + 原生基準
//   node scripts/preview-trainer-art.mjs ch0656_00_ibu ...    → 指定 trainerId
// 產出 ref/trainer-preview.png (ref/ 不進版控), 直接開來看。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const DIR = "public/reference/trainer";
const OUT = "ref/trainer-preview.png";
const TILE = 190;

/** 卡片的幾何 (與 components/sync-pair-card.tsx 一致) */
const SCALE = 144 / 128;
const WIN = {
  left: Math.round((14 + 8) / SCALE),
  top: Math.round((14 + 5) / SCALE),
  right: Math.round((114 + 8) / SCALE),
  bottom: Math.round((120 + 5) / SCALE),
};

/** 這 9 張是重裁過的 (見 fetch-wiki-trainer-images.mjs) */
const FIXED = [
  "ch0351_00_shione", "ch0363_00_asami", "ch0364_00_masahito",
  "ch0652_68_sayoko", "ch0653_68_kirika", "ch0656_00_ibu",
  "ch0657_00_chusuke", "ch0658_00_karen", "chp000_00_player",
];
/** 原生 brybry 縮圖 — 取景的基準, 一定要放進來當尺 */
const NATIVE = ["ch0000_80_red", "ch0002_00_kotone", "ch0008_00_erika"];

async function cardView(id) {
  const file = path.join(DIR, `${id}_128.webp`);
  if (!fs.existsSync(file)) {
    console.error(`  跳過 ${id} (沒有這張圖)`);
    return null;
  }
  const w = WIN.right - WIN.left;
  const h = WIN.bottom - WIN.top;
  return sharp(file)
    .extract({ left: WIN.left, top: WIN.top, width: w, height: h })
    .resize(TILE, Math.round((TILE * h) / w))
    .flatten({ background: { r: 238, g: 238, b: 243 } })
    .toBuffer();
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : [...FIXED, ...NATIVE];
const tiles = [];
for (const id of ids) {
  const t = await cardView(id);
  if (t) tiles.push(t);
}
if (!tiles.length) {
  console.error("沒有可預覽的圖");
  process.exit(1);
}
const meta = await sharp(tiles[0]).metadata();
const cols = Math.min(6, tiles.length);
const rows = Math.ceil(tiles.length / cols);
fs.mkdirSync("ref", { recursive: true });
await sharp({
  create: { width: cols * TILE, height: rows * meta.height, channels: 3, background: { r: 255, g: 255, b: 255 } },
})
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * TILE, top: Math.floor(i / cols) * meta.height })))
  .png()
  .toFile(OUT);

console.log(`卡片可見範圍 = 原圖 x ${WIN.left}..${WIN.right}, y ${WIN.top}..${WIN.bottom} (原圖 128×128)`);
console.log(`→ ${OUT}`);
ids.forEach((id, i) => {
  if (i % cols === 0) process.stdout.write(`\n 第 ${Math.floor(i / cols) + 1} 排: `);
  process.stdout.write(`${id}${NATIVE.includes(id) ? "(原生)" : ""}  `);
});
console.log("");
