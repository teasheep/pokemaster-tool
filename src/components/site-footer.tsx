import Link from "next/link";

import { CoachBallMark } from "@/components/coach-ball-mark";
import { GithubMark } from "@/components/github-mark";
import { ShellRow } from "@/components/page-shell";
import { REPO_URL } from "@/lib/site";

/**
 * 頁尾 (root layout 渲染一次, 全站共用)。
 *
 * **收尾的那條線是大師球的接縫**: 品牌圖示的左右兩段筆畫 (`M16 100 H68` / `M132 100 H184`)
 * 直接接上兩條 hairline —— 所以這裡用「線 + 球 + 線」而不是一條 `border-t`。
 * 兩件事要一起才成立: 球要吃 muted-foreground/40 那種等級的淡 (它是分隔線不是第二顆 logo,
 * 搶過 header 的品牌就本末倒置), 兩段線要真的等長 (`flex-1`) 球才會在正中間。
 * **不要改成在 border 上蓋一塊 `bg-background` 挖空** —— body 有 34px 的格紋,
 * 蓋一塊純色會在那條線上留下一段沒有格線的疤。
 *
 * 三層由重到輕 —— 這是唯一的層次來源 (字級只有兩種):
 *   1. 致謝 —— 這站是這群人一起用出來的, 放最上面也最亮
 *   2. 連結列 —— 頁尾唯一可以按的東西, 所以是唯一有 hover 的一列
 *   3. 版權與免責 —— 讀得到就好, 不要跟上面搶
 *
 * **一個去處只放一個入口** (使用者 2026-09-08: 「底下不要有兩個原始碼 提 issue」):
 * GitHub 就是一個 icon, issues 從專案頁一步就到。同理那句「歡迎提 issue 或送 PR」
 * 也拿掉了 —— 邀請的話寫在 README 與 CONTRIBUTING 裡, 頁尾不是佈告欄。
 *
 * 隱私權政策與服務條款要**從站上連得到**: Google OAuth 審核除了要網址,
 * 也會看它們是不是真的掛在應用程式裡。頁尾在每一頁都有, 是最穩的位置。
 * 個人資料相關的聯絡信箱刻意**只放在那兩頁裡**, 不放頁尾 —— 掛在每一頁等於多送
 * 幾百個頁面給爬信箱的機器人, 而它在法遵頁上只差一次點擊。
 */
export function SiteFooter() {
  return (
    <footer className="mt-10 pb-8 text-center text-xs text-muted-foreground">
      <ShellRow>
        {/* 大師球接縫 = 這一頁的收尾線。
            線往兩端淡出 —— 收在球身上, 而不是撞到左右留白的邊界斷掉。
            `--border` 在淺色是 oklch(0.89), 打了透明度就幾乎看不見了, 所以線用滿,
            層次交給漸層。球比線亮一階才看得出是「接縫上的球」。 */}
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
          <CoachBallMark className="h-5 w-5 text-muted-foreground/40" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
        </div>

        {/* 1. 致謝 —— 頁尾最亮的一行 */}
        <p className="mt-5 text-foreground/70">
          特別感謝小鳴及跑路的所有成員, 還有麵包坊的所有教練師傅
        </p>

        {/* 2. 連結列。分隔用 1px 直線不用標點 —— 標點會跟著文字對齊基線, 高度不一致;
            直線是真的分隔物, 三個項目才讀得出是同一組。
            觸控命中區撐到 44px (pointer-coarse), 視覺高度不變 —— 內容仍然置中。 */}
        <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-3">
          <Link href="/privacy" className={LINK}>
            隱私權政策
          </Link>
          <Divider />
          <Link href="/terms" className={LINK}>
            服務條款
          </Link>
          <Divider />
          {/* 只有 icon, 所以名字寫在 aria-label (螢幕報讀) 與 title (滑鼠停留) 兩邊 */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="原始碼 (GitHub)"
            title="原始碼 (GitHub)"
            className="inline-flex items-center justify-center px-1 py-1 text-muted-foreground/80 transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            {/* 實心的品牌標記在同樣的顏色下比文字「重」—— 14px 再淡一階才與兩個文字連結
                等重 (16px 的實心塊會變成這一列的視覺重心, 而它是第三順位) */}
            <GithubMark className="h-3.5 w-3.5" />
          </a>
        </nav>

        {/* 3. 版權與免責 */}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
          © {new Date().getFullYear()} 教練休息室 ・ 非官方第三方工具, 與 The Pokemon Company
          / DeNA 無關
        </p>
      </ShellRow>
    </footer>
  );
}

/** 文字連結: 底線平常是 border 色 (在), hover 才變成文字色 —— 不加底線就只是小字 */
const LINK =
  "inline-flex items-center underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground pointer-coarse:min-h-11";

/** 連結列的分隔線 (flex-wrap 換行時仍然在兩個項目之間, 標點做不到這件事) */
function Divider() {
  return <span className="h-3 w-px shrink-0 bg-border" aria-hidden />;
}
