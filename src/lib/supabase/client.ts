import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/types";
import { shouldSwallow, swallowResponse } from "@/lib/supabase/practice-mode";

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
  return createBrowserClient<Database>(url, anonKey, { global: { fetch: practiceAwareFetch } });
}

/**
 * 使用教學的「練習模式」在這裡把寫入吞掉 (見 practice-mode.ts)。
 * 判斷寫在**每一次 request 當下**, 不是建 client 的時候 —— 呼叫端普遍
 * `useMemo(() => createClient(), [])`, 教學開始前就建好的 client 也必須攔得到。
 * 平常 (沒在教學) 這裡就是原生 fetch, 一個判斷的成本。
 */
function practiceAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (shouldSwallow(url, method)) return Promise.resolve(swallowResponse());
  return fetch(input, init);
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
