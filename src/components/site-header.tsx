import Link from "next/link";
import { Upload, BookOpen, Candy, Shield, Sofa } from "lucide-react";

import { getSessionUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ShellRow } from "@/components/page-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <ShellRow className="flex h-14 min-w-0 items-center gap-2 sm:gap-4">
        {/* 觸控裝置把命中區撐到 44px (pointer-coarse, 與寬度無關); 視覺大小不變,
            header 本身是固定的 h-14 所以這一列高度也不受影響 */}
        {/* 已登入者直接回道館 —— 首頁對登入者是無條件 redirect, 指向 "/" 的話每次點左上角
            都會先串流出 src/app/loading.tsx 的骨架、跑完 auth 才跳去 /gyms
            (AGENTS 的「redirect + loading 老地雷」)。user 這裡本來就 await 過, 零額外成本。 */}
        <Link
          href={user ? "/gyms" : "/"}
          className="flex shrink-0 items-center gap-2 font-semibold pointer-coarse:min-h-11"
        >
          {/* 品牌 icon 用沙發 (休息室), 與導覽列「道館」的盾牌區隔 */}
          <Sofa className="h-5 w-5 text-amber-500" />
          {/* 手機的三個分頁移到底部導覽列了, 空出來的寬度拿來顯示站名 —
              只有一顆沙發圖示認不出這是什麼站。桌機 (sm~md) 維持原樣: 站名藏起來讓給分頁 */}
          <span className="inline sm:hidden md:inline">教練休息室</span>
        </Link>

        {/* 頂部只有兩個分頁: 拍組 / 道館。拍組是公開頁 (訪客也有入口);
            我的拍組/所有拍組是 /pairs 的子分頁, 道館子功能在 /gyms 的子分頁。
            手機 (< sm) 整排隱藏 — 同樣三個分頁在 MobileTabBar (底部固定列), 不做第二個入口 */}
        <nav className="hidden min-w-0 items-center gap-0.5 text-sm sm:flex sm:gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/pairs" title="拍組">
              <BookOpen className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">拍組</span>
            </Link>
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/gyms" title="道館">
                  <Shield className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">道館</span>
                </Link>
              </Button>
              {/* 糖果之類的個人資源 — 原本擠在拍組頁上方, 卡片牆被壓得很難看 */}
              <Button asChild variant="ghost" size="sm">
                <Link href="/resources" title="我的資源">
                  <Candy className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">我的資源</span>
                </Link>
              </Button>
            </>
          ) : null}
          {/* 截圖辨識僅本機開發啟用 (NEXT_PUBLIC_ENABLE_RECOGNITION=1), 線上版隱藏 */}
          {user && process.env.NEXT_PUBLIC_ENABLE_RECOGNITION === "1" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/upload" title="上傳截圖">
                <Upload className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">上傳截圖</span>
              </Link>
            </Button>
          ) : null}
        </nav>

        {/* 主題鈕 / 頭像 / 登入的觸控命中區不在這裡處理 — ui/button.tsx 的 base 已經
            帶 pointer-coarse 的隱形命中區, ThemeToggle 與 UserMenu 自己再各長到 44px。
            這裡再加一層等於同一件事兩個來源, 反而會打架。 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 手機 (<sm): 已登入者的主題切換在頭像選單裡 (user-menu.tsx 那一項是 sm:hidden),
              這裡再放一顆就是同一個設定兩個入口 → 藏起來, 那一列只剩「品牌 | 頭像」。
              **訪客沒有頭像選單**, 所以訪客這顆一定要留著, 不能無條件 hidden。
              用 sm:inline-flex 不是 sm:flex — Button base 是 inline-flex, 寫 flex 會被
              tailwind-merge 拿去改掉桌機的 display。 */}
          <ThemeToggle className={user ? "hidden sm:inline-flex" : undefined} />
          {user ? (
            <UserMenu email={user.email ?? ""} />
          ) : (
            <>
              <Button asChild size="sm">
                <Link href="/login">登入</Link>
              </Button>
            </>
          )}
        </div>
      </ShellRow>
    </header>
  );
}
