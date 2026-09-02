// 用 deprecated 的 middleware 慣例而非 Next 16 的 proxy.ts — 刻意的:
// proxy.ts 只能跑 Node runtime, Cloudflare Workers (OpenNext) 只支援 edge middleware;
// 官方升級指南明示「要繼續用 edge runtime 就留在 middleware」。
// 這份邏輯只用 fetch + cookies, edge/Node 皆可跑, 本機與雲端共用。
import type { NextRequest } from "next/server";

import { proxySupabase } from "@/lib/supabase/proxy";

export async function middleware(request: NextRequest) {
  return proxySupabase(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
