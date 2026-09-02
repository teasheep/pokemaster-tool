import { Suspense } from "react";
import { Sofa } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * 登入 — 只提供 Google 登入 (帳密登入已移除)。
 *
 * 版面 (2026-09-02 重做, 使用者回報「按鈕跟位置感覺都怪怪的」):
 * 舊版是 max-w-lg 容器 + 靠左的 h1 + w-full 按鈕, 貼在頁面左上角, 下面留大半個螢幕空白,
 * 而且 512px 寬的 Google 按鈕本身就違反規範 (上限 400px)。
 * 現在: 整頁垂直置中的單欄 (max-w-sm), 品牌在上、一句說明、官方尺寸的按鈕置中、小字在下 ——
 * 主流登入頁 (Linear / Notion / Supabase) 都是這個形狀, 使用者一看就知道自己在登入頁。
 *
 * One Tap 不在這一頁掛載 —— 它在 root layout 的 GoogleOneTapSlot, 全站訪客都有。
 */
export default function LoginPage() {
  return (
    // 垂直置中: main 是 body flex-col 裡的 flex-1, 這裡再把內容推到中間。
    // 手機上內容很短 (沒有輸入框, 不會有鍵盤把版面頂開), 置中同樣成立。
    <main className="flex flex-1 flex-col justify-center">
      <PageShell width="form" className="py-10 sm:py-16">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          {/* 品牌 —— 跟 SiteHeader 同一組圖示 + 名稱, 讓人確定沒走錯站 */}
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Sofa className="h-5 w-5 text-amber-500" aria-hidden />
            教練休息室
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight">登入</h1>
          <p className="mt-2 text-sm text-balance text-muted-foreground">
            用 Google 帳戶登入即可。第一次登入會請你設定名稱與頭貼。
          </p>

          <div className="mt-8 flex w-full justify-center">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            道館成員：用你平常的 Google 帳戶登入，資料會自動接上。
          </p>
        </div>
      </PageShell>
    </main>
  );
}
