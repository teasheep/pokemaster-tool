import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-signin-button";
import { PageShell } from "@/components/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { HomeTicketBoard } from "./home-ticket-board";

export const dynamic = "force-dynamic";

/**
 * 首頁 — **對外的門面**: 讓別的道館 3 秒內看懂這是什麼, 並且一步之內動手。
 *
 * 誰會看到這一頁: **只有沒登入的訪客** —— 有登入的人 (不管有沒有道館) 一律直接進 /gyms,
 * 所以這一頁只為「別的道館的陌生人」與「第一次從 LINE 點連結進來的成員」設計。
 *
 * 設計 (2026-09-02 重做, 使用者原話: 「簡潔明瞭 CTA 清楚 對手機板使用者友善」):
 *   - **文案只講「這是什麼」**: 道館戰工具。功能細節 (挑戰券/出刀/持有率…) 一個字都不寫 ——
 *     使用者明講「產品的核心是道館戰工具, 不需要把細節描述出來」。
 *   - **用看的不用讀的**: 旁邊放一塊道館戰看板的縮影 (home-ticket-board.tsx) 當插圖,
 *     陌生人瞄一眼就知道這是個什麼樣的工具, 不用讀說明。
 *   - **只有一顆 CTA, 而且是真正的 Google 按鈕**: 按下去直接去 Google, 不是先跳 /login。
 *     不放「逛圖鑑」—— 訪客在導覽列已經看得到「拍組」, 首頁再放一顆就是第二個入口。
 *   - 沒有背景漸層、沒有卡片外框的假入口、沒有功能列表。
 *   - 手機: 直向堆疊, 看板在 h1 正下方, CTA 整條可點 (48px)。桌機: 文字在左、看板在右。
 */
export default async function HomePage() {
  // getSessionUser 是 request 級快取 — 跟 SiteHeader 共用同一次 auth 往返
  const user = await getSessionUser();

  // 有登入就直接進道館 —— 已有道館的人每天進站不需要看門面; 還沒有道館的人, /gyms 本來就是
  // 「建立道館 / 用邀請碼加入」那一頁 (空狀態), 首頁再放一顆同樣的按鈕只是重複。
  // 順帶省掉舊版那次 gyms count 查詢 (每個登入者進首頁都要多跑一趟跨太平洋, 只為了決定要不要跳)。
  if (user) redirect("/gyms");

  return (
    // 桌機把整塊垂直置中 (這頁很短, 貼著 header 會像沒排完); 手機不用 —— 第一屏要先看到內容
    <main className="flex flex-1 flex-col md:justify-center">
      <PageShell className="py-8 sm:py-14 md:py-12">
        {/* 三個區塊共用一個 grid, 看板**只渲染一次** (它是 client 元件, 渲染兩份 = 兩個 timer):
            手機 1 欄, 自然順序 文案 → 看板 → CTA (先看到東西再決定要不要按);
            桌機 2 欄, 文案與 CTA 在左欄上下兩列, 看板在右欄跨兩列置中。 */}
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[1.15fr_1fr] md:gap-x-12 md:gap-y-6">
          <div className="text-center md:col-start-1 md:row-start-1 md:self-end md:text-left">
            <p className="text-sm font-medium text-muted-foreground">Pokémon Masters EX</p>
            <h1 className="mt-2 text-[2.25rem] font-bold leading-tight tracking-tight sm:text-5xl">
              道館戰工具
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base text-balance text-muted-foreground sm:text-lg md:mx-0">
              拍組、道館戰分配，全館一目了然。
            </p>
          </div>

          <HomeTicketBoard className="mx-auto w-full max-w-sm md:col-start-2 md:row-span-2 md:row-start-1 md:self-center md:justify-self-center" />

          {/* CTA = **真正的 Google 按鈕**, 不是連到 /login 的假鈕。
              舊版是 shadcn primary Button 寫著「用 Google 登入」但只是換頁 —— 既不符合 Google
              品牌規範 (底色/尺寸/logo 全錯), 又拿 Google 的名字代表一個「其實只是跳頁」的動作。
              直接放 GoogleSignInButton: 按下去就真的去 Google, 而且外觀是官方那顆。
              這**不是第二個登入實作** —— 全站只有 google-signin-button.tsx 一份, 這裡只是多一個掛載點。
              「先逛拍組圖鑑」刻意不放: 訪客在桌機 header 與手機底部分頁列都已經看得到「拍組」。 */}
          <div className="flex justify-center md:col-start-1 md:row-start-2 md:justify-start md:self-start">
            <GoogleSignInButton />
          </div>
        </div>
      </PageShell>
    </main>
  );
}
