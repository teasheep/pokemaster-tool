// 產出教練休息室的 logo (四個檔)。
//
// 文字**轉成路徑**, 不依賴看的人裝了什麼字型 —— logo 會被丟進設計軟體、印刷、
// 貼圖平台這些沒有中文字型的地方。字型用 Noto Sans TC Bold (SIL OFL, 可自由嵌入/轉外框),
// 不用系統字型 (微軟正黑之類授權綁 Windows, 轉進 logo 再散布有疑慮)。
//
// 用法: npm run logo:font (取字型子集, 只需第一次) → npm run logo:build
//
// 產出:
//   public/logo/coach-ball.svg            黑版, 有「教練」
//   public/logo/coach-ball-white.svg      白版, 有「教練」(深色底用)
//   public/logo/coach-ball-mark.svg       黑版, 無字 (favicon 這種很小的地方)
//   public/logo/coach-ball-mark-white.svg 白版, 無字

import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

const OUT = "public/logo";
// opentype 2.x: loadSync 已棄用, 改 parse(buffer)
// Node 的 Buffer 是 pool 出來的, .buffer 會指到整塊 pool → 一定要照 byteOffset 切,
// 不然 opentype 讀到的是別人的位元組 (症狀: Unsupported OpenType signature)。
const fontBuf = fs.readFileSync("ref/.noto-subset.ttf");
const FONT = "ref/.noto-subset.ttf";
if (!fs.existsSync(FONT)) {
  console.error(`缺 ${FONT} —— 先跑 node scripts/fetch-logo-font.node.mjs`);
  process.exit(1);
}
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

// ── 文字轉路徑 ──
// 先在原點畫一次量出實際邊界, 再平移到球的下半部置中 (不同字型的 metrics 差很多,
// 用 advance width 推位置會偏, 一律以實際墨水邊界為準)。
const SIZE = 44;
const raw = font.getPath("教練", 0, 0, SIZE);
const bb = raw.getBoundingBox();
const CX = 100; // 球心 x
const TEXT_CY = 150; // 字在球內的垂直中心
const dx = CX - (bb.x1 + bb.x2) / 2;
const dy = TEXT_CY - (bb.y1 + bb.y2) / 2;
const textPath = font.getPath("教練", dx, dy, SIZE).toPathData(2);

// 確認字真的落在球內 (r=86, 扣掉筆畫)
const w = bb.x2 - bb.x1;
const h = bb.y2 - bb.y1;
const halfWidthAtY = Math.sqrt(86 ** 2 - (TEXT_CY - 100) ** 2);
console.log(
  `字框 ${w.toFixed(1)}×${h.toFixed(1)}, 該高度球內可用寬度 ${(halfWidthAtY * 2).toFixed(1)} → ${
    w < halfWidthAtY * 2 - 8 ? "放得下" : "太寬, 要縮"
  }`
);

/**
 * 球體本身 (大師球外框)。`ink` = 線條顏色, `bg` = 球內填色,
 * `w` = 線寬 (極小尺寸要加粗, 見 tiny 版)。
 */
function ball(ink, bg, w = 7) {
  return `  <g fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="100" cy="100" r="86" fill="${bg}"/>
    <path d="M14 100 H70"/>
    <path d="M130 100 H186"/>
    <circle cx="55" cy="48" r="9"/>
    <circle cx="145" cy="48" r="9"/>
    <path d="M79 63 V35 L100 53 L121 35 V63" stroke-width="${w + 1}"/>
    <circle cx="100" cy="100" r="27" fill="${bg}"/>
    <circle cx="100" cy="100" r="12"/>
  </g>`;
}

function svg({ ink, bg, withText, label, note, w }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="${label}">
  <title>${label}</title>
  <!-- ${note}
       文字已轉為路徑 (Noto Sans TC Bold, SIL OFL) — 不依賴系統字型。
       要改字就重跑 npm run logo:build, 不要手改下面那條 path。 -->
${ball(ink, bg, w)}${
    withText
      ? `
  <path d="${textPath}" fill="${ink}"/>`
      : ""
  }
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
const files = [
  ["coach-ball.svg", { ink: "#000", bg: "#fff", withText: true, label: "教練", note: "黑版 (淺色底)。" }],
  ["coach-ball-white.svg", { ink: "#fff", bg: "none", withText: true, label: "教練", note: "白版 (深色底; 球內不填色, 直接透出底色)。" }],
  ["coach-ball-mark.svg", { ink: "#000", bg: "#fff", withText: false, label: "教練休息室", note: "無字版 — favicon 這種很小的地方用, 加了字會糊成一團。" }],
  ["coach-ball-mark-white.svg", { ink: "#fff", bg: "none", withText: false, label: "教練休息室", note: "無字白版 (深色底)。" }],
  // 16px 的 favicon: 一般線寬 (7/200 = 3.5%) 在那個尺寸只有 0.56px, 會糊成一團灰。
  // 實測 32px 以上用一般版就夠清楚, 只有 16px 需要這個加粗版。
  ["coach-ball-mark-tiny.svg", { ink: "#000", bg: "#fff", withText: false, w: 12, label: "教練休息室", note: "無字加粗版 — 只給 16px 這種極小尺寸 (一般線寬在那裡會糊掉)。" }],
];
for (const [name, opts] of files) {
  fs.writeFileSync(path.join(OUT, name), svg(opts));
  console.log("✓", path.join(OUT, name));
}
