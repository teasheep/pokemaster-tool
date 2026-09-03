"use client";

// 首頁 hero 的第一塊看板 —— 「道館戰看板」縮影 (與 home-pairs-board 輪替顯示)。
//
// 為什麼放一塊假看板而不是說明文字: 首頁只講「這是道館戰工具」, 功能細節一個字都不寫
// (使用者明講不要描述細節)。那「它長什麼樣」就用一塊看板的一角給人看 ——
// 四個示範成員 + 一筆剛登記的出刀, 陌生道館的人瞄一眼就有概念, 不用讀。
//
// 只有一個動作: 進場後約一秒,「小霞」的券數 13 → 12 (沿用 sync-pair-card 那顆
// animate-count-pop, 與真看板同一種動作語彙), 同時底下浮出那一行出刀紀錄 ——
// 示範「登記時自動扣券」這件事本身。**時間由 HomeHeroBoards 統一掌控** (`ticked` prop):
// 兩塊看板都是一直掛著只是輪流淡入, 自己算 timer 的話輪到自己時那一下早就播完了。
//
// 示範成員刻意用寶可夢主角的名字 (小智/小霞/小剛/小茂): 一看就知道是範例, 不會被誤認成真人。
// 數字格式與真看板一致: `remaining/cap`、tabular-nums (battle-client.tsx:476)。

import { cn } from "@/lib/utils";

const CAP = 30;
const ROWS = [
  { name: "小智", remaining: 27 },
  { name: "小霞", remaining: 13, ticks: true },
  { name: "小剛", remaining: 30 },
  { name: "小茂", remaining: 3 },
] as const;

export function HomeTicketBoard({
  ticked = false,
  className,
}: {
  ticked?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label="道館戰看板示範"
      // flex-col + 下面那個 flex-1 的 ul: 兩塊看板疊在同一格 (高度取最高的那塊), 比較矮的那塊
      // 把多出來的高度留給清單, 底部那條分隔線與最後一行就會停在**同一個位置** —— 輪替時
      // 只有內容換掉, 卡片的骨架不動。
      className={cn("flex flex-col rounded-2xl border bg-card p-4 text-left shadow-sm sm:p-5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">道館戰</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          R2
        </span>
      </div>

      <ul className="mt-3 flex-1 divide-y divide-border/60">
        {ROWS.map((r) => {
          const value = "ticks" in r && ticked ? r.remaining - 1 : r.remaining;
          const low = value <= 5;
          return (
            <li key={r.name} className="flex items-center gap-3 py-2">
              <span
                aria-hidden
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary"
              >
                {r.name.slice(-1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  low ? "font-semibold text-primary" : "text-foreground"
                )}
              >
                <span
                  key={value}
                  className={cn("inline-block", "ticks" in r && ticked && "animate-count-pop")}
                >
                  {value}
                </span>
                <span className="text-muted-foreground">/{CAP}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {/* 剛登記的那一筆 —— 出現的同時上面的券數才扣, 兩者是同一件事 */}
      <p
        className={cn(
          "mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground",
          "transition-opacity duration-300 motion-reduce:transition-none",
          ticked ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-foreground">小霞</span> 出刀 · 券{" "}
        <span className="font-mono tabular-nums">13 → 12</span>
      </p>
    </div>
  );
}
