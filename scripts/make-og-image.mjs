/**
 * 產生 `public/og.png` (1200×630) —— 分享到 LINE / Facebook / X 時的卡片圖。
 *
 * 為什麼用瀏覽器截圖而不是 sharp 或 next/og:
 *   - sharp 的 SVG 文字要靠系統字型, 中文在不同機器上會掉字或換字型。
 *   - `next/og` (satori) 要另外載入中文字型檔 (幾 MB), 而且會在 Worker 上花 CPU ——
 *     OG 圖是**靜態的**, 沒有理由每次請求現算。
 *   - 直接開站上跑得起來的那個 Chrome 排版, 拿到的就是站台本人的字型與配色。
 *
 * 一年也跑不了幾次 (改標語或配色才要重跑), 所以 playwright 不進 dependencies ——
 * 用 `npx playwright` 借一次就好。
 *
 *   node scripts/make-og-image.mjs
 *
 * ⚠ 產出的 `public/og.png` **要進版控** (它不是資料管線的衍生檔, 是設計資產,
 *   而且部署時 Workers Assets 要送它出去)。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "og.png");

// 站台的實際配色 (globals.css 的 light 主題) 與字級, 抄過來而不是重新設計 ——
// 分享卡片要一眼認得出是同一個站。
const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; padding: 0 96px;
    font-family: 'Noto Sans TC', system-ui, sans-serif;
    background: #faf6ef;
    /* 站上 body 的細格紋理 */
    background-image:
      linear-gradient(rgba(120,100,60,.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(120,100,60,.05) 1px, transparent 1px);
    background-size: 48px 48px;
    color: #1c1917;
  }
  .eyebrow { font-size: 30px; font-weight: 500; color: #78716c; letter-spacing: .02em; }
  h1 { font-size: 104px; font-weight: 900; line-height: 1.08; margin-top: 14px; letter-spacing: -.01em; }
  p  { font-size: 40px; color: #57534e; margin-top: 28px; font-weight: 500; }
  .foot { position: absolute; left: 96px; bottom: 64px; display: flex; align-items: center;
          gap: 16px; font-size: 28px; color: #a8a29e; font-weight: 500; }
  .dot { width: 14px; height: 14px; border-radius: 999px; background: #f59e0b; }
</style></head><body>
  <div class="eyebrow">Pokémon Masters EX</div>
  <h1>道館戰工具</h1>
  <p>拍組、道館、分配，一目了然。</p>
  <div class="foot"><span class="dot"></span>教練休息室 · pokemaster-tool.com</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const buf = await page.screenshot({ type: "png" });
await browser.close();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`✓ ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
