import type { NextConfig } from "next";

// 部署目標: cloudflare 時把「僅限本機的辨識功能」從 build 完全排除 —
// 那些 route 頂層 import 原生模組 (onnxruntime/sharp), Workers 無法載入,
// 只靠執行期 404 擋不住 bundler。做法: 辨識的 page/route 用 *.node.tsx / *.node.ts
// 副檔名, cloudflare build 不把它們視為路由 (官方 pageExtensions 排除模式)。
const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";

/**
 * 安全性標頭 — **只能寫在這裡, 寫進 public/_headers 是白工**。
 *
 * 已驗證 (2026-08-21), 三路交叉確認:
 * 1) 原始碼: Workers Assets 的 router 只有兩條路 —— 命中靜態資產 → ASSET_WORKER
 *    (只有它會套 _headers, 見 node_modules/miniflare/dist/src/workers/assets/assets.worker.js
 *    的 attachCustomHeaders); 沒命中 → USER_WORKER, 它的 response 原樣回傳、不加工。
 * 2) 線上實測: /catalog/1nbqg8x.json 回 ETag + CF-Cache-Status + _headers 給的 immutable,
 *    而 / 回 x-opennext: 1 + Worker 自己的 private, no-cache。
 * 3) 本機 workerd (opennextjs-cloudflare build + wrangler dev, 沒有部署): 在建置產物的
 *    _headers 塞一條 /* 標記, 只有 /catalog/*.json 帶得回來, /login 與 /api/export 都沒有。
 * 也就是頁面 HTML 與 /api/* 這種動態回應永遠碰不到 _headers → 安全標頭走 Next 的 headers()。
 * 反過來 public/_headers 仍是靜態資產唯一的出口 (資產不經過 Worker), 兩邊各管一半。
 */
const SECURITY_HEADERS = [
  // 最急的一條: 這個站把祕密放在網址裡 (/share/<token>、/api/export?key=)。沒有它,
  // 使用者從那些頁點任何外部連結, 整條網址 (含金鑰) 會跟著 Referer 送給對方。
  // strict-origin-when-cross-origin = 跨站只送 origin (無路徑無 query), 站內才給完整網址。
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 不准瀏覽器猜 Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 防點擊劫持。站內沒有任何 iframe; 用 SAMEORIGIN 而不是 DENY —— 對第三方的效果一樣,
  // 但不會擋掉將來自家的預覽 iframe。Google 登入是整頁導向 (signInWithOAuth 改 location),
  // 不是把 Google 嵌進 iframe, 所以不受影響。
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // 這個站不用這些裝置能力 (辨識是本機限定功能, 而且走檔案輸入不是相機串流)。
  // 只列 Next 官方文件那四項 —— 多列 usb/payment 之類的, Firefox 會對不認得的功能名
  // 在 console 逐頁警告, 換不到保護。
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // 只走 HTTPS。刻意不加 preload —— 那是不可逆的, 而且 workers.dev 不是我們的網域。
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // CSP 只上「不可能打掛這個站」的那幾條:
  //   frame-ancestors = X-Frame-Options 的現代版 (兩條並存, 舊瀏覽器吃前者)
  //   base-uri / form-action / object-src = 擋 <base> 注入、表單被導去外站、外掛物件
  // **刻意沒有 script-src / default-src**: 本站有三種 inline script (Next 的 __next_f
  // flight 資料、next-themes 防閃爍、layout 裡的 __name 補丁), 嚴格 script-src 必須靠
  // middleware 逐次發 nonce 才不會整站白畫面 —— 那是獨立的一件事, 不在這輪。
  // 也沒有上 Report-Only: 沒有回報端點的話它只會在 console 洗版, 換不到資訊。
  //
  // ⚠ **哪天要補完整 CSP, 這三件事會靜默打掛 /login 的 Google One Tap** (見
  //    src/components/google-one-tap.tsx) —— 它失敗時不會報錯, 就是不出現:
  //    1. script-src / connect-src / frame-src 都要放行 https://accounts.google.com。
  //    2. Permissions-Policy **不要**為了「補齊」加上 identity-credentials-get=() —
  //       那等於直接關掉 FedCM (現在沒列 = 預設 allowlist 是 self, 頂層頁面可用)。
  //    3. 要加 Cross-Origin-Opener-Policy 的話只能是 same-origin-allow-popups。
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  pageExtensions: isCloudflare
    ? ["tsx", "ts"]
    : ["node.tsx", "node.ts", "tsx", "ts"],
  // 安全標頭 (為什麼寫在這裡而不是 public/_headers, 見 SECURITY_HEADERS 上方的驗證紀錄)。
  // 同一個 key 被兩條規則設到時「後面蓋前面」, 所以特例規則排在全站規則之後。
  // 這裡一律不碰 Cache-Control —— 頁面的 private, no-cache, no-store 是對的, 別蓋掉。
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // 網址本身就是祕密的兩條路徑: 連 origin 都不必送, 也不要被搜尋引擎收錄
      {
        source: "/share/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/export",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  // 路由層轉導 (頁面內 redirect() 碰到 loading.tsx 會變成串流的「載入中」殼,
  // 使用者會看到閃一下才跳)
  async redirects() {
    return [
      // 道館根路徑 → 成員與拍組 (預設分頁, 使用者指定); 道館戰一覽在 /battles (真頁面)
      { source: "/gyms/:id", destination: "/gyms/:id/members", permanent: false },
      { source: "/gyms/:id/strategy", destination: "/gyms/:id/members", permanent: false },
      // 道館攻略仍然下架 (2026-08-17) — 只擋入口, 頁面與資料留著之後重做。
      // **道館紀錄 2026-09-10 已經回來了** (使用者:「之前做過的道館紀錄我覺得可以加回來了」),
      // 所以 /activity 這一行拿掉了 —— 分頁在 gym-tabs.tsx。
      { source: "/gyms/:id/guides", destination: "/gyms/:id/members", permanent: false },
      // 道館拍組已併進「成員與拍組」(同一頁的「全館拍組」視角)
      { source: "/gyms/:id/pairs", destination: "/gyms/:id/members", permanent: false },
      // AI 串接改成個人頁 (金鑰跟人走)
      { source: "/gyms/:id/mcp", destination: "/connect", permanent: false },
    ];
  },
  // native/wasm 套件, 不要被 bundler 解析 (Node 環境用; cloudflare build 已排除相關路由)
  serverExternalPackages: [
    "sharp",
    "tesseract.js",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
};

export default nextConfig;
