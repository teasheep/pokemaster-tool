import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/types";

/**
 * 取得 browser-side Supabase client。
 *
 * 若 env vars 還沒設定, 回傳一個 stub 讓 form 渲染不會直接爆炸,
 * 任何 auth/db 操作會回錯誤訊息提示使用者去設定 Supabase。
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return createStubClient();
  }
  return createBrowserClient<Database>(url, anonKey);
}

function createStubClient() {
  const err = { message: "Supabase 尚未設定 (.env.local 還沒填)" };
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async signInWithPassword() {
        return { data: { user: null, session: null }, error: err };
      },
      async signUp() {
        return { data: { user: null, session: null }, error: err };
      },
      async signOut() {
        return { error: null };
      },
    },
    from() {
      const promise = Promise.resolve({ data: null, error: err });
      const chain = {
        select: () => chain,
        insert: () => chain,
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        single: () => promise,
        then: (resolve: (v: { data: null; error: typeof err }) => void) => promise.then(resolve),
      };
      return chain as never;
    },
    rpc() {
      return Promise.resolve({ data: null, error: err });
    },
  } as never;
}
