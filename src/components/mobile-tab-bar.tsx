"use client";

// 手機底部導覽列 — 全站三個分頁 (拍組 / 道館 / 我的資源) 放到拇指構得到的位置。
// 桌機不出現 (sm:hidden), 桌機的入口仍是 SiteHeader 那一排 — 分頁名稱、href、
// 未登入只顯示「拍組」的規則都與 SiteHeader 一模一樣 (資訊架構固定, 不新增分頁)。
//
// z-index = z-40 (與 sticky 的 SiteHeader 同層, 兩者一上一下不會重疊)。
// 手機側板 (ui/side-panel.tsx 的 bottom sheet) 是 z-50, 從底部升起時整片蓋過這一列 —
// 側板開著的時候導覽列點不到, 正是我們要的 (不會讓人以為兩者可以同時操作)。
// Radix 的 dialog/dropdown 也都是 z-50, 一樣壓得過。

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Candy, Shield, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** 訪客 (未登入) 也看得到 */
  guest?: boolean;
};

const TABS: Tab[] = [
  { href: "/pairs", label: "拍組", Icon: BookOpen, guest: true },
  { href: "/gyms", label: "道館", Icon: Shield },
  { href: "/resources", label: "我的資源", Icon: Candy },
];

/**
 * 一格的內容 — 拆成子元件是因為 useLinkStatus 必須是 <Link> 的後代才拿得到 pending。
 * 頂端那條線同時兼任「目前分頁」與「導覽中」的提示 (手機上點了沒反應最容易被當成沒點到)。
 */
function TabInner({ tab, active }: { tab: Tab; active: boolean }) {
  const { pending } = useLinkStatus();
  const Icon = tab.Icon;
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary",
          "transition-opacity duration-150 motion-reduce:transition-none",
          active ? "opacity-100" : pending ? "opacity-60 delay-100" : "opacity-0"
        )}
      />
      <Icon className="h-5 w-5 shrink-0" />
      <span className="leading-tight">{tab.label}</span>
    </>
  );
}

export function MobileTabBar({ signedIn }: { signedIn: boolean }): React.ReactElement | null {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => signedIn || t.guest);

  return (
    <nav
      aria-label="主導覽"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 sm:hidden",
        "border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        // iPhone 的底部橫條 — 少了這行, 最後一格會被系統手勢區蓋住
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <ul className="flex items-stretch">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 整格可點: 56px 高 (> 44px 觸控下限), 文字 12px (手機字級下限)
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs",
                  "transition-colors active:bg-muted/60",
                  active ? "font-medium text-primary" : "text-muted-foreground"
                )}
              >
                <TabInner tab={t} active={active} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
