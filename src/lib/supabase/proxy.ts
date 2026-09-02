import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/types";

// /api/export 自己用個人金鑰授權 (給外部 AI 讀), 不能被導去登入頁
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/auth/callback",
  // One Tap 的落地點 — 它自己會檢查 session, 沒有就導回 /login?error=onetap_no_session。
  // 交給 middleware 擋的話只會靜默導回登入頁, 分不出「沒登入」還是「cookie 被瀏覽器擋掉」。
  "/auth/one-tap",
  "/share",
  "/pairs",
  "/welcome",
  "/api/export",
];

/**
 * 有沒有 Supabase 的 session cookie。
 *
 * @supabase/ssr 的 cookie 名 = storageKey = `sb-<project-ref>-auth-token`,
 * 內容太長時會切成 `.0` `.1` 分塊。這裡只看「在不在」, 不解析也不信任內容 —
 * 真正的驗證仍然是 `supabase.auth.getUser()` (下面) 與各頁自己的 `getSessionUser()`。
 *
 * 判定刻意放寬 (sb- 開頭且含 auth-token): 漏判 = 當成訪客 → 非公開路由導去登入頁
 * (fail-closed, 不會放行任何東西); 誤判 = 只是多走一次原本就會走的完整流程。
 * 之後若自訂 `cookieOptions.name`, 這裡要跟著改。
 */
export function hasSupabaseAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

let warnedMissingEnv = false;

export async function proxySupabase(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 根路徑不做前綴比對 —— `"/" + "/"` 會讓所有 `//foo` 開頭的路徑都算公開
  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`))
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // 開發階段 (.env.local 還沒填) 照舊放行, 站台才能空跑。
    // 生產環境不行: 少了環境變數等於整面登入牆靜默消失, 而且沒有任何徵兆 —
    // 這種一定要明確壞掉 (503), 不能 fail-open。
    if (process.env.NODE_ENV === "production") {
      if (!warnedMissingEnv) {
        warnedMissingEnv = true;
        console.error(
          "[proxy] 缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — 生產環境一律回 503, 不放行任何路由"
        );
      }
      return new NextResponse(
        "伺服器未設定 Supabase, 暫時無法服務。請確認部署時有帶 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY。",
        {
          status: 503,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }
    return NextResponse.next({ request });
  }

  // 完全沒有 session cookie = 訪客: 不必建 Supabase client, 也不必問 Supabase。
  // (Worker 在 SJC、Supabase 在新加坡, 每一趟都是跨太平洋; 訪客本來就沒東西可刷新。)
  // 已登入的人 (帶著 cookie) 仍然走下面的完整流程 —— getUser() 會刷新並輪替 session cookie,
  // 少了它就是官方 SSR guide 點名的登出迴圈。
  if (!hasSupabaseAuthCookie(request.cookies.getAll())) {
    if (isPublic) return NextResponse.next({ request });
    // 沒有 cookie 就沒有「剛輪替的 session」要保留, 直接導向即可
    return NextResponse.redirect(loginUrl(request, pathname));
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    return redirectWithSession(loginUrl(request, pathname), supabaseResponse);
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    // 與 safeNextPath 的預設落點、首頁對登入者的 redirect 一致 (都是 /gyms) ——
    // 同一個概念三個落點, 使用者誤點「登入」會落在圖鑑而不是道館
    url.pathname = "/gyms";
    url.search = "";
    return redirectWithSession(url, supabaseResponse);
  }

  return supabaseResponse;
}

/**
 * 登入頁網址 (帶原路徑當 redirect)。
 * redirect 只放站內路徑 — `//host` 會被瀏覽器當成外站 (open redirect),
 * 這裡就不要產生, 讓登入頁那邊的同款檢查當第二道關。
 */
function loginUrl(request: NextRequest, pathname: string): URL {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (pathname.startsWith("/") && !pathname.startsWith("//")) {
    url.searchParams.set("redirect", pathname);
  } else {
    url.searchParams.delete("redirect");
  }
  return url;
}

/**
 * 建 redirect response, 並把 getUser() 可能剛輪替 (refresh) 的 auth cookie
 * 從工作用 response 複製過去。否則 token 在「正好要 redirect 時」刷新會遺失,
 * 造成 server/瀏覽器 session 脫鉤 → 官方 SSR guide 點名的登出迴圈。
 */
function redirectWithSession(url: URL, supabaseResponse: NextResponse): NextResponse {
  const redirectRes = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectRes.cookies.set(cookie);
  });
  return redirectRes;
}
