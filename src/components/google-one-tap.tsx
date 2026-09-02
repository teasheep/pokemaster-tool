"use client";

// Google One Tap —— 桌機右上角浮出、手機底部彈出的「用這個 Google 帳號登入」提示。
//
// 它**不是第二種登入方式**, 是同一條路 (Google) 的捷徑版: 省掉「整頁跳去 Google 再跳回來」。
// 旁邊那顆「使用 Google 登入」永遠要留著 —— FedCM 生效後我們**偵測不到 One Tap 有沒有跳出來**
// (見下面 prompt() 的註解), 沒有保底入口就會變成「入口還在但功能斷掉」。
//
// **掛載範圍 = 全站的訪客** (2026-09-02 使用者指定: 「我希望在沒登入的時候 哪裡都有 one tap」)。
// 由 root layout 的 GoogleOneTapSlot 掛載, 那個 slot 只在**沒登入**時才渲染這個元件,
// 所以已登入的人完全不會載入 GIS。
//
// 取捨要知道: GIS script 的載入本身就是一個帶 Google cookie 的請求, 掛全站等於讓每一位
// 訪客 (包含只是來逛圖鑑的路人) 都被 Google 看見一次; 而且使用者關掉 One Tap 會讓瀏覽器
// 對整站進入 FedCM embargo (我們偵測不到)。原本只掛 /login 就是為了省下這兩件事 ——
// 現在改成全站是使用者權衡後的決定, 不是疏漏。

import { useEffect, useRef } from "react";
import Script from "next/script";
import { toast } from "sonner";

import { generateOneTapNonce } from "@/lib/auth/one-tap-nonce";
import { safeNextPath } from "@/lib/auth/post-login-destination";
import { createClient } from "@/lib/supabase/client";

const GIS_SRC = "https://accounts.google.com/gsi/client";
/** 每個分頁最多自動彈一次 (值不重要, 有沒有這個 key 才重要) */
const PROMPTED_KEY = "pm-gym:one-tap-prompted";

type CredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: Record<string, unknown>): void;
          prompt(): void;
          cancel(): void;
        };
      };
    };
  }
}

/** sessionStorage 在無痕/封鎖 cookie 的瀏覽器會直接丟例外 — 一律包起來 */
function alreadyPrompted(): boolean {
  try {
    if (sessionStorage.getItem(PROMPTED_KEY)) return true;
    sessionStorage.setItem(PROMPTED_KEY, "1");
    return false;
  } catch {
    // 讀不到就當作沒彈過: 最壞情況是同一個分頁多彈一次, 比完全不彈好
    return false;
  }
}

export function GoogleOneTap({ clientId }: { clientId: string | null }) {
  const started = useRef(false);

  useEffect(
    () => () => {
      try {
        window.google?.accounts.id.cancel();
      } catch {
        // GIS 沒載進來就沒什麼要收的
      }
      // ⚠ **一定要歸零**: React StrictMode (Next 16 開發模式強制開啟) 會做
      // mount → cleanup → mount。少了這一行, 第二次 mount 會被 started 擋掉,
      // 結果開發時 One Tap 永遠不出現, 還會被誤判成「Google Console 的 JS 來源沒設好」。
      started.current = false;
    },
    []
  );

  // 沒有 client id (例如換一台沒有 .env.local 的機器建置) → 連 script 都不要載,
  // 登入頁其餘部分照常運作。這是「優雅退化」而不是壞掉。
  if (!clientId) return null;

  async function onCredential(response: CredentialResponse, rawNonce: string) {
    const token = response?.credential;
    if (!token) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token,
        nonce: rawNonce, // Supabase 收 raw, Google 收 hashed (見 one-tap-nonce.ts)
      });
      if (error) {
        toast.error("Google 登入失敗", { description: error.message });
        return;
      }

      // session 真的落地了嗎? @supabase/ssr 的 browser client 只寫 document.cookie,
      // **沒有記憶體備援** —— 瀏覽器封鎖 cookie 時 signInWithIdToken 仍然會成功 resolve。
      // 不確認就導頁的話: /auth/one-tap 看不到 session → 退回 /login → 又自動彈, 變成迴圈。
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("登入沒有完成", {
          description: "瀏覽器可能封鎖了 Cookie — 請改按頁面上的「使用 Google 登入」。",
        });
        return;
      }

      // 整頁導向 (不是 router.push/refresh) 是**刻意的**, 兩個理由:
      //   1. /auth/one-tap 是 Route Handler 不是頁面 —— App Router 的 client 導航送不過去。
      //   2. 新 session 要讓 middleware 與 server component 從頭判斷一次; router.refresh()
      //      只清當前頁的 client cache, 而 /login 上的 RSC 請求會撞到 proxy 的
      //      「已登入 → 307 /gyms」, 反而繞掉 onboarding 閘門。
      //
      // 目的地 = **登入完留在原地**: 在圖鑑按下去就回圖鑑, 不要把人丟到別頁去。
      // 只有 /login 例外 —— 那頁本身不是目的地, 要看 ?redirect= (proxy 攔截時帶上的原路徑)。
      // 這裡直接讀 window.location 而不用 useSearchParams: 後者會把整個 root layout
      // 拖進 client 渲染, 而我們只在 callback 當下需要這個值。
      const here = new URL(window.location.href);
      const next =
        here.pathname === "/login"
          ? safeNextPath(here.searchParams.get("redirect"))
          : safeNextPath(here.pathname + here.search);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 見上面兩點: 這裡要的就是整頁導向到 Route Handler
      window.location.assign(`/auth/one-tap?next=${encodeURIComponent(next)}`);
    } catch (e) {
      toast.error("Google 登入失敗", {
        description: e instanceof Error ? e.message : "請改按頁面上的「使用 Google 登入」。",
      });
    }
  }

  async function start() {
    if (started.current) return;
    started.current = true;
    // 保險絲在「要彈的當下」就燒 —— 不是等登入成功才燒。訪客在站內用 <Link> 走來走去時
    // 元件會重掛, 不先燒的話每次都會再自動彈一次。
    if (alreadyPrompted()) return;

    const google = window.google;
    if (!google) return;

    const { raw, hashed } = await generateOneTapNonce();
    google.accounts.id.initialize({
      client_id: clientId,
      nonce: hashed,
      // 不要自動選帳號 —— 使用者要看到自己在登入哪一個帳號並自己按下去
      auto_select: false,
      // 點旁邊可以關掉 (預設值)。刻意不設 false: 手機上 One Tap 是底部彈出,
      // 關不掉會一直壓在畫面上。
      cancel_on_tap_outside: true,
      context: "signin",
      callback: (response: CredentialResponse) => void onCredential(response, raw),
      // 刻意不傳 `use_fedcm_for_prompt` —— Google 已標記 deprecated 且會忽略
      // (FedCM 自 2025-08 起強制)。Supabase 文件上那份範例是舊的。
    });
    // prompt() 刻意**不傳 callback**: FedCM 之後 isDisplayed()/isNotDisplayed()/
    // getNotDisplayedReason() 這些「有沒有顯示」的回呼全部不再觸發, 傳了只會在 console
    // 噴棄用警告。也因此不要寫任何「沒跳出來就改做別的」補償邏輯 —— 保底就是旁邊那顆按鈕。
    google.accounts.id.prompt();
  }

  // onReady 在 script 載完以及每次元件重新掛載時都會觸發 (Next 16 的 next/script 行為),
  // 去重交給 started ref。
  return <Script src={GIS_SRC} strategy="afterInteractive" onReady={() => void start()} />;
}
