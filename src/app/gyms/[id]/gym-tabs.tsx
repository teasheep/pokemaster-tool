"use client";

// 道館子導覽 tabs — 所有 /gyms/[id]/** 頁共用, 解決「隊伍庫/攻略庫只能從賽事頁按鈕進」
// 的孤島問題。usePathname 高亮目前分頁。

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * 導覽中的細線 — 點了到換頁之間什麼都不動, 使用者會以為沒點到。
 * useLinkStatus 必須是 <Link> 的後代才拿得到 pending (Next 16 的 next/link 匯出)。
 * delay-100 是去抖動: 預取命中的快導覽在 100ms 內就結束, 線根本不會浮出來。
 * -bottom-0.5 = 貼齊 border-b-2 那條帶 (仍在 border box 內, 不會被 nav 的
 * overflow-x-auto 裁掉); active tab 底下本來就是同一個 primary, 疊上去看不出差別。
 */
function TabPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-primary",
        "opacity-0 transition-opacity delay-100 duration-150 motion-reduce:transition-none",
        pending && "opacity-100"
      )}
    />
  );
}

export function GymTabs({ gymId }: { gymId: string }) {
  const pathname = usePathname();
  const base = `/gyms/${gymId}`;
  // 分頁名稱 = 頁面 h1 = 該頁唯一職責, 三者必須一致 (改任一個就三個一起改):
  //   成員與拍組 — 誰是誰、誰有什麼 (名冊/角色/邀請碼 + 全館拍組總覽 + 個人練度/糖果)
  //     ↑ 排最前 = 道館根路徑的預設頁 (使用者指定)
  //   道館戰 — 這次要打什麼、我打哪一關 (賽事一覽/建立賽事/單場看板)
  //   隊伍庫 — 每個屬性用哪三隻 (看板側板選隊用的是同一份 TeamLibrary)
  // (道館攻略 / 紀錄 2026-08-17 暫時下架 — 只拔入口, 頁面與資料留著, 之後重做;
  //  next.config 也把 /guides /activity 轉導回 members, 直接輸入網址也進不去)
  // (AI 串接改成個人的「資料連線」, 在頭像選單底下 — 金鑰跟人走不跟道館走)
  const tabs = [
    { href: `${base}/members`, label: "成員與拍組", match: [`${base}/pairs`] },
    { href: `${base}/battles`, label: "道館戰" },
    { href: `${base}/teams`, label: "隊伍庫" },
  ];

  const isActive = (t: { href: string; match?: string[] }) =>
    pathname.startsWith(t.href) || (t.match ?? []).some((m) => pathname.startsWith(m));

  return (
    // 手機: 三格等寬填滿整列 (grid-cols-3), 不橫捲 — 之前擠在切換器旁邊橫捲,
    //       「隊伍庫」永遠在畫面外而且沒有可捲提示 (使用者實測抓包)。
    // 桌機: 維持原本的 flex + 橫捲。
    <nav className="scrollbar-none grid grid-cols-3 sm:flex sm:flex-1 sm:gap-1 sm:overflow-x-auto">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            // 等寬之後文字置中; 觸控裝置把每格撐到 44px (pointer-coarse, 與寬度無關)
            "relative flex items-center justify-center whitespace-nowrap border-b-2 px-2 py-2 text-sm transition-colors",
            "pointer-coarse:min-h-11 sm:shrink-0 sm:px-3",
            isActive(t)
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          {t.label}
          <TabPending />
        </Link>
      ))}
    </nav>
  );
}
