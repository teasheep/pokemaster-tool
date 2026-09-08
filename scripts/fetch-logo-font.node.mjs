// 取 Noto Sans TC Bold **只含 logo 用到的那幾個字**的子集, 給 build-logo 轉外框用。
//
// 為什麼不用系統字型: 微軟正黑之類的授權綁在 Windows 上, 把字形轉進要散布的 logo 有疑慮。
// Noto Sans TC 是 SIL OFL, 明文允許嵌入與衍生。
//
// ⚠ **不要用 MSIE 的 User-Agent** —— Google Fonts 會回 EOT (IE 專用的包裝格式),
//    opentype.js 讀不了 (症狀: Unsupported OpenType signature)。現代瀏覽器的 UA 則是 woff2。
//    舊 Android 的 UA 才會拿到 TTF。
//
// 產出 ref/.noto-subset.ttf (ref/ 不進版控 —— 字型檔不必進 repo, 要重產再跑一次就好;
// 真正進 repo 的是 build-logo 轉出來的 SVG 路徑)。

import fs from "node:fs";

/** logo 上會出現的字 —— 改文案就改這裡, 子集會跟著只含需要的字形 */
const TEXT = "教練";

const UA_TTF =
  "Mozilla/5.0 (Linux; U; Android 2.3.7; en-us; Nexus One Build/FRF91) " +
  "AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1";

const css = await fetch(
  "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700&text=" + encodeURIComponent(TEXT),
  { headers: { "User-Agent": UA_TTF } }
).then((r) => r.text());

const url = css.match(/url\((https:[^)]+)\)/)?.[1];
if (!url) {
  console.error("拿不到字型網址:\n" + css.slice(0, 400));
  process.exit(1);
}

const res = await fetch(url, { headers: { "User-Agent": UA_TTF } });
const buf = Buffer.from(await res.arrayBuffer());
const sig = [...buf.subarray(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
if (sig !== "00 01 00 00") {
  console.error(`拿到的不是 TTF (前 4 bytes ${sig}, content-type ${res.headers.get("content-type")})`);
  process.exit(1);
}

fs.mkdirSync("ref", { recursive: true });
fs.writeFileSync("ref/.noto-subset.ttf", buf);
console.log(`✓ ${TEXT} 的子集 ${(buf.length / 1024).toFixed(1)}KB → ref/.noto-subset.ttf`);
