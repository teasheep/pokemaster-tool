import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { hasSupabaseAuthCookie } from "@/lib/supabase/proxy";
import type { Database } from "@/lib/supabase/types";

/**
 * 取得 server-side Supabase client。
 *
 * 若 env vars 還沒設定 (例如本地 dev 還沒填), 會回傳一個 stub client,
 * 它的 auth.getUser() 永遠回傳 null user, 其它呼叫會回傳錯誤。
 * 這讓站台在 Supabase 還沒設定的情況下也能編譯/啟動, 而不會整站爛掉。
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return createStubClient();
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // 從 Server Component 呼叫時可能會失敗, 由 src/proxy.ts 處理 session 刷新即可。
        }
      },
    },
  });
}

function createStubClient() {
  const notConfigured = {
    data: null,
    error: { message: "Supabase 尚未設定 (.env.local 還沒填)" },
  } as const;

  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
    },
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        single: () => Promise.resolve(notConfigured),
        async then(resolve: (v: typeof notConfigured) => void) {
          resolve(notConfigured);
        },
      };
      return chain as never;
    },
    rpc() {
      return Promise.resolve(notConfigured);
    },
  } as never;
}

/**
 * 這次請求的登入使用者 — 用 React cache 去重。
 *
 * 一次頁面渲染裡 SiteHeader、layout、page 各自呼叫 auth.getUser(),
 * 每次都是一趟 Supabase 往返 (~150-270ms, Worker 在 SJC / Supabase 在新加坡);
 * 包成 cache 之後同一個請求只打一次。
 *
 * 沒有 session cookie 就直接是 null — 不建 client、不進 auth 流程。
 * (auth-js 現在剛好也會在沒有 session 時就地回 null, 但那是它的內部行為;
 * 訪客免費這件事太重要, 這裡自己講清楚, 不要哪天升版就悄悄變成一趟跨太平洋。)
 *
 * 這支就是「權威」的那一次驗證 — 每個受保護的頁面都自己呼叫它並在 null 時 redirect,
 * middleware 只是提前擋掉而已。**不要**改成信任 middleware 傳下來的身分 (見下方註記)。
 */
export const getSessionUser = cache(async () => {
  const cookieStore = await cookies();
  if (!hasSupabaseAuthCookie(cookieStore.getAll())) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// 為什麼不讓頁面重用 middleware 已經驗過的結果 (例如 middleware 塞 x-user-id header)?
//
// 那確實可以省掉每個已登入請求的第二趟 auth 往返, 但代價是「身分」變成一個請求標頭 ——
// 只要 middleware 有一次沒跑到, 頁面就會直接相信外部送進來的值。middleware 沒跑到不是
// 假設性問題: matcher 例外 (.png/.svg 之類的路徑) 會跳過, Next.js 自己也出過
// CVE-2025-29927 (特製標頭可整個略過 middleware)。Next 官方文件同樣寫明 middleware
// 只適合做樂觀檢查, 真正的驗證要在資料層。
//
// 目前的實際損害會被 RLS 擋住 (資料查詢用的是 cookie 裡真正的 JWT, 偽造的身分查不到
// 任何東西), 但只要哪天有人寫一個「用 service role + getSessionUser().id 判權限」的
// server action, 就會從「多打一趟」升級成越權。省 250ms 不值得押這個。
//
// 想省那一趟的話, 該做的是另一件事: 讓 middleware 改成樂觀檢查 (只看 cookie 在不在與
// 快不快過期, 不打網路), 由頁面那一次 getSessionUser() 當唯一權威。前提是
// (1) 每個受保護頁面都已經自己 redirect —— 這點目前成立 (2026-08 全數確認過),
// (2) token 接近到期時仍然要走 getUser(), 讓輪替後的 cookie 寫得回 response,
// (3) /login 與 /register 仍要權威判斷, 否則壞掉的 cookie 會在 /login ↔ /pairs 之間彈跳。
