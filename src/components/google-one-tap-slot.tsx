import { GoogleOneTap } from "@/components/google-one-tap";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * 全站的 Google One Tap 掛載點 —— 由 root layout 用 `<Suspense>` 包起來串流。
 *
 * 使用者指定「沒登入的時候, 哪裡都有 One Tap」(2026-09-02), 所以掛在 root layout 而不是單一頁。
 *
 * 為什麼要包成獨立的 async 元件: RootLayout 自己**不准** await ——
 * layout 一 await, 整站導覽跟 loading.tsx 的骨架就會被 block 住 (AGENTS.md 的老地雷)。
 * 這裡與 MobileTabBarSlot 是同一個模式, 而 `getSessionUser` 是 request 級 cache,
 * 所以不會多打一趟 auth (與 SiteHeader / MobileTabBarSlot 共用同一次)。
 *
 * **已登入就整個不渲染** —— 連 GIS script 都不會載。這很重要:
 * 20 位成員平常都是登入狀態, 他們不該為了一個他們永遠看不到的提示付出一支第三方 script。
 *
 * client id 讀執行期的 `process.env`, 不需要 `NEXT_PUBLIC_`
 * (opennextjs-cloudflare 會把 .env.local 灌回 Worker 的 process.env; 見 login/page.tsx 的註解)。
 * 沒設的話 GoogleOneTap 自己會回 null, 不會爆炸。
 */
export async function GoogleOneTapSlot() {
  let signedIn = false;
  try {
    signedIn = Boolean(await getSessionUser());
  } catch {
    // 未設定 Supabase / auth 失敗: 當訪客處理 (最壞情況是多彈一次提示)
  }
  if (signedIn) return null;

  return <GoogleOneTap clientId={process.env.GOOGLE_OAUTH_CLIENT_ID ?? null} />;
}
