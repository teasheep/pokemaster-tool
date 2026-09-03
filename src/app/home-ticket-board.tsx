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
// 示範成員刻意用寶可夢主角的名字 (小智/小霞/小剛/小光): 一看就知道是範例, 不會被誤認成真人。
// 數字格式與真看板一致: `remaining/cap`、tabular-nums (battle-client.tsx:476)。

import { MemberAvatar } from "@/components/gym/member-card";
import { cn } from "@/lib/utils";

const CAP = 30;

// 示範成員的頭貼用他們**自己**在 Pokémon Masters 裡的訓練家立繪 —— 真的成員在 onboarding
// 就會設頭貼, 而且多半設一張自己喜歡的訓練家, 這塊看板照著演。(全走 MemberAvatar 的 avatarUrl,
// 沒有第二套頭像實作; 四位都是 2019-2022 就上市的拍組, 不會動到未公布素材。)
const ROWS = [
  { name: "小智", face: "ch0264_00_satoshi", remaining: 27 },
  { name: "小霞", face: "ch0110_01_kasumi", remaining: 13, ticks: true },
  { name: "小剛", face: "ch0015_00_takeshi", remaining: 30 },
  { name: "小光", face: "ch0116_00_hikari", remaining: 3 },
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
            <li key={r.name} className="flex items-center gap-3 py-2.5">
              {/* 用真的 MemberAvatar (沒頭貼 → 名字 hash 出固定色相的縮寫圓),
                  不要自己刻一顆 —— 這塊是產品的一角, 頭像就該長得跟看板上一模一樣。
                  密集列一律 28px (AGENTS「成員頭像尺寸」), 與 gyms/[id]/pairs 的用法同一行寫法。 */}
              <MemberAvatar
                member={{
                  id: r.name,
                  displayName: r.name,
                  avatarUrl: `/reference/trainer/${r.face}_128.webp`,
                }}
                size="sm"
                className="h-7 w-7"
              />
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
