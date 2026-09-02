import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { SyncPairDefs } from "@/components/sync-pair-defs";
import { getSessionUser } from "@/lib/supabase/server";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * viewport-fit=cover 是 env(safe-area-inset-*) 生效的前提 —— 沒有它, iOS Safari
 * 一律回 0, 底部導覽列/出刀列/bottom sheet 那三處 calc 全都是空話。
 * (cover 之後內容會延伸到瀏海與 home indicator 區, 所以那三處的留白才真的需要。)
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "教練休息室",
  description:
    "Pokemon Masters EX 道館賽協作: 成員拍組持有、挑戰隊伍庫、挑戰券即時看板與對戰紀錄, 一個地方即時同步。",
};

/**
 * 底部導覽列要知道有沒有登入 (未登入只有「拍組」)。
 * 包成獨立的 async 元件 + Suspense: RootLayout 自己**不准** await —
 * layout 一 await, 整站導覽跟 loading.tsx 的骨架就會被 block 住 (AGENTS 的老地雷)。
 * getSessionUser 是 request 級 cache, 與 SiteHeader 共用同一次 auth 往返。
 */
async function MobileTabBarSlot() {
  let signedIn = false;
  try {
    signedIn = Boolean(await getSessionUser());
  } catch {
    // 未設定 Supabase / auth 失敗: 當訪客處理 (仍有「拍組」入口)
  }
  return <MobileTabBar signedIn={signedIn} />;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* 手機底部導覽列是 fixed 的 — body 補一段底部留白 (含 iPhone 安全區),
          否則頁尾與每頁最後一個元素會被那一列蓋住。3.5rem = 那一列的 56px,
          +1px = 它的 border-t (少算這 1px, 頁尾最後一列會被壓到)。桌機沒有那列, sm 以上歸零。 */}
      <body
        className="min-h-full flex flex-col pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] sm:pb-0"
        suppressHydrationWarning
      >
        {/* OpenNext(Cloudflare) 用 esbuild 的 keepNames 打包 server, 會把 `__name(fn, "fn")`
            注進 next-themes 那段「序列化成字串塞進 HTML」的防閃爍 script — 但 __name 只存在
            bundle 作用域, 瀏覽器一執行就 ReferenceError, 主題於是要等 hydration 才套上
            (深色模式使用者第一眼會閃一下淺色)。這裡先補一個等價的 no-op。
            必須排在 ThemeProvider **前面** (那段 script 由它渲染, 誰先出現誰先跑)。
            純 `next build` 沒有這個問題 — 實測本機產物 __name 出現 0 次、線上 1 次,
            是 Cloudflare 打包那一步造成的, 不是專案程式碼。OpenNext 修掉後可以拿掉這段。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: "globalThis.__name=globalThis.__name||function(f){return f}",
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* 拍組卡的 <defs> 全站只畫一份 (每張卡自己畫 = /pairs 一頁多 8,385 個 DOM 節點)。
              放這裡是因為只有 root layout 涵蓋得到所有情境 — 側板會 portal 到 document.body,
              放在個別消費端既蓋不到、又會長出重複 id。 */}
          <SyncPairDefs />
          {/* 導覽列/頁尾統一在這裡 — 子頁不要各自渲染, 否則 loading/error 頁會整條消失再長回來 */}
          <SiteHeader />
          {children}
          <SiteFooter />
          {/* 手機的三個全站分頁在螢幕底部 (桌機 sm 以上不渲染任何東西) */}
          <Suspense fallback={null}>
            <MobileTabBarSlot />
          </Suspense>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
