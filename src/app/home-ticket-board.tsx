"use client";

// 首頁的「道館戰看板」縮影 —— 這一頁的簽名元素 (插圖, 不是說明)。
//
// 為什麼放一塊假看板而不是說明文字: 首頁只講「這是道館戰工具」, 功能細節一個字都不寫
// (使用者明講不要描述細節)。那「它長什麼樣」就用一塊看板的一角給人看 ——
// 四個示範成員 + 一筆剛登記的出刀, 陌生道館的人瞄一眼就有概念, 不用讀。
//
// 只有一個動作: 頁面載入後約一秒, 「小霞」的券數 13 → 12 (沿用 sync-pair-card 那顆
// animate-count-pop, 與真看板同一種動作語彙), 同時底下浮出那一行出刀紀錄 ——
// 示範「登記時自動扣券」這件事本身。prefers-reduced-motion 直接呈現最終狀態。
//
// 示範成員刻意用寶可夢主角的名字 (小智/小霞/小剛/小茂): 一看就知道是範例, 不會被誤認成真人。
// 數字格式與真看板一致: `remaining/cap`、tabular-nums (battle-client.tsx:476)。

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const CAP = 30;
const ROWS = [
  { name: "小智", remaining: 27 },
  { name: "小霞", remaining: 13, ticks: true },
  { name: "小剛", remaining: 30 },
  { name: "小茂", remaining: 3 },
] as const;

export function HomeTicketBoard({ className }: { className?: string }) {
  // server 與 client 首次 render 都是 false → 沒有 hydration mismatch
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    // reduced-motion 不等那一秒, 但仍走 timeout (effect 本體同步 setState 會被 react-hooks 規則擋)
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const t = window.setTimeout(() => setTicked(true), reduce ? 0 : 1100);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="img"
      aria-label="道館戰看板示範"
      className={cn(
        "rounded-2xl border bg-card p-4 text-left shadow-sm sm:p-5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">道館戰</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          R2
        </span>
      </div>

      <ul className="mt-3 divide-y divide-border/60">
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
