import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { GoogleOneTapSlot } from "@/components/google-one-tap-slot";
import { TourSlot } from "@/components/tour/tour-slot";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
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

/**
 * 站台層級的 metadata。子頁只覆寫自己那幾個欄位, 其餘由這裡繼承。
 *
 * 幾個刻意的選擇:
 *  - **`metadataBase` 一定要給**: 沒有它, `openGraph.images` 與 `alternates.canonical`
 *    這種相對路徑會被解成 localhost, 而那個錯只有在別人分享連結時才看得到。
 *  - **`title.template`**: 子頁只寫自己的名字 (例如「拍組圖鑑」), 後綴自動接上。
 *  - **預設 `index: true`, 私密頁自己關掉**。全站可索引的其實只有 `/` 與 `/pairs`,
 *    其餘 (道館、個人設定、分享頁、onboarding) 一律在各自的頁面/layout 設 `index: false` ——
 *    尤其 `/share/<token>`: token 是半秘密, 被搜尋引擎收錄等於把別人的收藏攤出來。
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Pokémon Masters EX 道館戰工具`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: SITE_NAME,
    url: "/",
    title: `${SITE_NAME} — Pokémon Masters EX 道館戰工具`,
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — 道館戰工具` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Pokémon Masters EX 道館戰工具`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
  // 站上的數字 (券數 27/30、持有 4/20) 會被 iOS Safari 當成電話號碼加上撥號連結
  formatDetection: { telephone: false },
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
          {/* 導覽列/頁尾統一在這裡 — 子頁不要各自渲染, 否則 loading/error 頁會整條消失再長回來 */}
          <SiteHeader />
          {children}
          <SiteFooter />
          {/* 手機的三個全站分頁在螢幕底部 (桌機 sm 以上不渲染任何東西) */}
          <Suspense fallback={null}>
            <MobileTabBarSlot />
          </Suspense>
          {/* 訪客的 Google One Tap (沒有可見 DOM — 提示由 Google 畫在視窗角落)。
              已登入就整個不渲染, 連 GIS script 都不載。 */}
          <Suspense fallback={null}>
            <GoogleOneTapSlot />
          </Suspense>
          {/* 使用教學 (只給已登入者; 訪客連 client 程式碼都不送)。
              第一次登入落地時自己跳一次, 之後從頭像選單再叫。 */}
          <Suspense fallback={null}>
            <TourSlot />
          </Suspense>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
