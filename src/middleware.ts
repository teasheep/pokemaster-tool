// 用 deprecated 的 middleware 慣例而非 Next 16 的 proxy.ts — 刻意的:
// proxy.ts 只能跑 Node runtime, Cloudflare Workers (OpenNext) 只支援 edge middleware;
// 官方升級指南明示「要繼續用 edge runtime 就留在 middleware」。
// 這份邏輯只用 fetch + cookies, edge/Node 皆可跑, 本機與雲端共用。
import type { NextRequest } from "next/server";

import { proxySupabase } from "@/lib/supabase/proxy";

export async function middleware(request: NextRequest) {
  return proxySupabase(request);
}

/**
 * robots.txt / sitemap.xml 一定要排除 —— 它們是 `app/robots.ts` 與 `app/sitemap.ts` 產的
 * **路由**, 不是靜態檔, 所以不會被下面的副檔名規則擋掉。忘了排除的症狀是:
 * 爬蟲拿到的不是 robots.txt 而是 `302 → /login?redirect=%2Frobots.txt`
 * (2026-09-03 實測到才發現)。這兩個網址對誰都一樣, 本來也沒有理由跑一次登入判定。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
