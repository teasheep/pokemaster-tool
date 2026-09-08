// 產出教練休息室的 logo —— **幾何與文案的單一來源就是這支**, 產出的檔案都不要手改。
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
//   public/logo/coach-ball-mark.svg       黑版, 無字
//   public/logo/coach-ball-mark-white.svg 白版, 無字
//   public/logo/coach-ball-mark-tiny.svg  黑版無字加粗 — 只給 16px
//   src/app/icon.svg                      站上的 favicon (小尺寸簡化版)
//   src/components/coach-ball-mark.tsx    站上的品牌圖示 (小尺寸簡化版, currentColor)

import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

const OUT = "public/logo";
const FONT = "ref/.noto-subset.ttf";
if (!fs.existsSync(FONT)) {
  console.error(`缺 ${FONT} —— 先跑 npm run logo:font`);
  process.exit(1);
}
// opentype 2.x: loadSync 已棄用, 改 parse(buffer)。
// ⚠ Node 的 Buffer 是 pool 出來的, `.buffer` 會指到整塊 pool → 一定要照 byteOffset 切,
//   不然 opentype 讀到的是別人的位元組 (症狀: Unsupported OpenType signature)。
const fontBuf = fs.readFileSync(FONT);
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
  ["coach-ball-mark-tiny.svg", { ink: "#000", bg: "#fff", withText: false, w: 9, label: "教練休息室", note: "無字加粗版 — 只給 16px 這種極小尺寸 (一般線寬在那裡會糊掉)。" }],
];
for (const [name, opts] of files) {
  fs.writeFileSync(path.join(OUT, name), svg(opts));
  console.log("✓", path.join(OUT, name));
}

// ── 站上實際用到的兩份 (favicon + header 的品牌圖示) ──
//
// **小尺寸用簡化版**: 這兩個地方只有 16~20px, 實測全細節版在那個尺寸會糊成一團 ——
// M 與兩顆凸點併成一條黑帶, 中央按鈕的內外圈也黏在一起。所以拿掉兩顆凸點與按鈕內圈,
// 並把線寬從 7 加到 14 (lucide 的圖示是 2/24 = 8.3%, 我們原本只有 3.5%, 相對太細)。
// 大 logo (public/logo/) 維持全細節, 那裡尺寸夠。
const SMALL_GEOM = `  <circle cx="100" cy="100" r="84"/>
    <path d="M16 100 H68"/>
    <path d="M132 100 H184"/>
    <path d="M79 63 V35 L100 53 L121 35 V63" stroke-width="15"/>
    <circle cx="100" cy="100" r="26"/>`;

/**
 * favicon。Next 的 App Router 檔案慣例: `src/app/icon.svg` 會自動變成 <link rel="icon">
 * (favicon.ico 留著給不吃 SVG 的舊瀏覽器)。
 * 分頁列的底色淺色/深色都有 → 用 prefers-color-scheme 換色, 一個檔兩種底都看得清楚。
 * 幾何用小尺寸簡化版 (SMALL_GEOM)。
 */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="教練休息室">
  <title>教練休息室</title>
  <!-- 由 npm run logo:build 產生, 不要手改。分頁列底色深淺都有, 所以自己換色。
       小尺寸簡化版 (favicon 常被畫到 16px) —— 理由見腳本裡的 SMALL_GEOM。 -->
  <style>
    :root { --ink: #000; }
    @media (prefers-color-scheme: dark) { :root { --ink: #fff; } }
  </style>
  <g fill="none" stroke="var(--ink)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
${SMALL_GEOM}
  </g>
</svg>
`;
fs.writeFileSync("src/app/icon.svg", FAVICON);
console.log("✓ src/app/icon.svg (favicon)");

/**
 * 站上的品牌圖示 (SiteHeader / 登入頁)。做成元件而不是 <img>:
 * 顏色要跟著 currentColor 走 (深淺主題各一種), 而且不該為了一顆 20px 的圖示多一個請求。
 * 線寬用 tiny 那組 —— header 只有 20px, 一般線寬在那個尺寸太細。
 */
const COMPONENT = `// 品牌圖示 (大師球外框)。**由 npm run logo:build 產生, 不要手改** ——
// 幾何的單一來源是 scripts/build-logo.node.mjs, 對外發佈的 SVG 檔在 public/logo/。
//
// 用 currentColor 而不是寫死顏色: 深色主題自己會跟著變, 呼叫端用 text-* 決定顏色。
// **簡化版**: 站上只有 20px, 全細節在那個尺寸會糊成一團 (M 與凸點併成一條黑帶)。
// 所以拿掉兩顆凸點與按鈕內圈, 線寬加到 14 (lucide 是 2/24 = 8.3%)。大 logo 維持全細節。

export function CoachBallMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={14}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="100" cy="100" r="84" />
      <path d="M16 100 H68" />
      <path d="M132 100 H184" />
      <path d="M79 63 V35 L100 53 L121 35 V63" strokeWidth={15} />
      <circle cx="100" cy="100" r="26" />
    </svg>
  );
}
`;
fs.writeFileSync("src/components/coach-ball-mark.tsx", COMPONENT);
console.log("✓ src/components/coach-ball-mark.tsx (站上的品牌圖示)");
