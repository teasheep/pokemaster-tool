// 完整拍組圖鑑 (client 投影版) — **退路**, 不是主路徑。
//
// 主路徑是靜態資產 `public/catalog/<指紋>.json` (src/data/catalog-version.ts 的
// CATALOG_ASSET_PATH, 由 scripts/emit-client-catalog.mjs 在建置時產生)。
// 線上那個檔由 Cloudflare Workers Assets 直接供應 —— wrangler.jsonc 沒設 run_worker_first,
// 命中資產時我們的 Worker 根本不會被叫起來, 那條路徑是真正的 0 CPU。
// 這條路由每被打一次就要重跑一次 JSON.stringify(整包 306KB) 再串流出去 (實測 45-65ms CPU),
// 在免費方案的 10ms 上限下是奢侈品。
//
// 那為什麼還留著: **「按了全圖鑑卻是空的」是點名過的前科**, 不能讓入口有一絲斷掉的機會。
// 靜態資產抓不到時 (dev 沒跑過 prebuild、資產漏掉沒部署上去、指紋常數與檔案不同步),
// pair-picker 會自動退到這裡, 使用者無感。它不是第二個入口, 是同一條路的降級版。
//
// 零漂移: 這裡直接呼叫 loadPairsForClient(), 與靜態資產同一支投影函式 (腳本是用 esbuild
// 打包這支 loader 來產檔的), 兩邊的欄位永遠等於 CLIENT_PAIR_FIELDS。
//
// 授權: 不放進 proxy.ts 的 PUBLIC_ROUTES — 沒登入會被導去登入頁。
// (注意靜態資產那條路徑不經過 middleware, 對外是公開的; 內容只有圖鑑, 沒有任何個人資料,
//  而 /pairs 本來就是公開頁且對訪客直送同一份投影。)

import { CATALOG_VERSION, loadPairsForClient } from "@/lib/pairs/loader";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 快取一年 + immutable: 只有在網址帶 `?v=<CATALOG_VERSION>` 的前提下才成立 —
 * catalog 換內容 → 指紋換 → 網址換, 瀏覽器自然重抓 (見 lib/pairs/loader.ts)。
 * **private 不是 public**: 這條路由要登入才過得了 middleware, 給 public 等於允許
 * 企業 proxy 之類的共用快取把它發給沒登入的人 (內容雖然只有圖鑑, 但授權會形同虛設)。
 * 對瀏覽器自己的快取來說 private 與 public 效果相同。
 */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

export async function GET(req: Request) {
  // **自己擋, 不要只靠 middleware** (2026-09-07): middleware 對「還沒到期的 cookie」
  // 改成樂觀放行 (不打網路) 了, 所以它不再是這條路由的授權關卡。
  // 這裡曾經是全站唯一「授權完全靠 middleware」的地方 —— 內容雖然只有圖鑑 (沒有個人資料,
  // 而且靜態資產那條路徑本來就對外公開), 但每打一次要 45-65ms CPU, 不該對匿名開放。
  if (!(await getSessionUser())) {
    return new Response(JSON.stringify({ error: "需要登入" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const records = await loadPairsForClient();
  const etag = `"catalog-${CATALOG_VERSION}"`;

  // 版本對不上 (舊分頁拿舊 v 來要) → 給的是新內容, 就不能讓它被鎖在舊網址底下
  const asked = new URL(req.url).searchParams.get("v");
  if (asked && asked !== CATALOG_VERSION) {
    return new Response(JSON.stringify({ version: CATALOG_VERSION, records }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // 有人帶 If-None-Match 就回 304 (immutable 下瀏覽器不會問, 但 proxy/curl 會)
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": CACHE_CONTROL },
    });
  }

  return new Response(JSON.stringify({ version: CATALOG_VERSION, records }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
    },
  });
}
