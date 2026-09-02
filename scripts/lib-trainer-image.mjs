// wiki 全身模型圖 → brybry 128 縮圖規格的共用處理
// (add-wiki-pairs.mjs 與 fetch-wiki-trainer-images.mjs 共用, 不要各自再抄)
//
// brybry 遊戲縮圖的取景 = 臉部為主體、頭飾頂到框緣被卡框微裁、下緣到胸口。
// 全身直立圖直接縮放會變成「小人漂浮」— 這裡取「頂部 寬×0.85」的頭肩帶,
// 以 cover 放大到近乎滿框, 臉部大小才會跟 brybry 卡片一致。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

export async function toTrainer128(buf) {
  const trimmed = await sharp(buf).trim({ threshold: 8 }).png().toBuffer();
  const m0 = await sharp(trimmed).metadata();
  // 頭肩帶: 高 = 寬 × 0.85 (夠寬的動態姿勢圖不裁)
  const cropH = Math.min(m0.height, Math.round(m0.width * 0.85));
  const band =
    cropH < m0.height
      ? await sharp(trimmed)
          .extract({ left: 0, top: 0, width: m0.width, height: cropH })
          .png()
          .toBuffer()
      : trimmed;
  // cover 到 124×118 (保留頂部 — 頭飾在上緣), 再墊成 128×128 (上 3 下 7 左右 2)
  const covered = await sharp(band)
    .resize(124, 118, { fit: "cover", position: "north" })
    .png()
    .toBuffer();
  return sharp(covered)
    .extend({
      top: 3,
      bottom: 7,
      left: 2,
      right: 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
