// 全站唯一的頁面容器 — 解決「切分頁時內容區時寬時窄」。
// SiteHeader / 道館 tabs / 每一頁內容都吃同一個寬度, 邊界才會對齊。
// wide  = 卡片牆、看板 (預設)
// prose = 條列/表格/說明頁
// form  = 登入、個人設定這類單欄表單

import { cn } from "@/lib/utils";

const WIDTHS = {
  wide: "max-w-[1400px]",
  prose: "max-w-3xl",
  form: "max-w-lg",
} as const;

export type PageWidth = keyof typeof WIDTHS;

/** 頁面內容容器 (含左右留白與上下間距) */
export function PageShell({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  return (
    // 手機留白收窄 (px-3/py-4): 390px 螢幕上每側省 4px 就多 8px 給卡片牆,
    // 上方留白也不該吃掉「第一屏要看到內容」的額度; 桌機維持原本的 px-4/py-6。
    <div className={cn("mx-auto w-full px-3 py-4 sm:px-4 sm:py-6", WIDTHS[width], className)}>
      {children}
    </div>
  );
}

/**
 * 頁面標題 — 全站同一種寫法 (不要再各自刻「← 道館名 / h1 / 說明」三層,
 * 上一層的 tabs 與道館切換器已經交代「你在哪」了)。
 */
export function PageHeading({
  title,
  beside,
  description,
  action,
}: {
  title: string;
  /** 緊貼在標題文字後的小元件 (例: 成員頁的邀請碼) — 與 action (靠右) 不同 */
  beside?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    // 手機的標題與內容之間不需要 20px — 第一屏要盡快看到卡片牆/清單
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 sm:mb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {beside}
        </div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** 頁首列容器 (header / tabs 用) — 與 PageShell wide 同寬, 只差沒有上下間距 */
export function ShellRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // 左右留白必須與 PageShell 同一組 (px-3 / sm:px-4), 否則導覽列與內容的邊界對不齊
    <div className={cn("mx-auto w-full px-3 sm:px-4", WIDTHS.wide, className)}>{children}</div>
  );
}
