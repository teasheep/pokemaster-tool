"use client";

// 首頁 hero 的第二塊看板 —— 「全館拍組持有」(與 home-ticket-board 輪替顯示)。
//
// 為什麼要有第二塊: 首頁的一句話是「拍組、道館戰分配，全館一目了然」, 但插圖只有道館戰那半邊,
// 「拍組」那半邊沒有畫面。這塊補上 —— 一份道館拍組名單 + 每一組「20 人中幾人有」的長條。
//
// 視覺語彙一律沿用真的那一頁 (gyms/[id]/pairs 的 CoverageBar): h-1 長條、同一組門檻與顏色、
// `count/total` tabular-nums。看起來要像產品的一角, 不是另外畫一張示意圖。
//
// 拍組名字用真的 (`pairName()` 的「人名 & 寶可夢名」格式), 因為讀者就是玩這款遊戲的人 ——
// 認得出「丹帝 & 噴火龍」比任何說明都快。示範成員仍是主角名 (小茂), 與道館戰看板同一座假道館。
//
// 圖檔刻意不放: 首頁是陌生人的第一個請求, 拍組立繪一張就 20-40KB, 而這塊的資訊 (誰有、幾人有)
// 純文字就講得完; 兩塊看板長得像姊妹, 輪替時也才不會在版面上跳一下。

import { cn } from "@/lib/utils";

/** 假道館的人數 —— 與 home-ticket-board 的 4 位示範成員屬同一座館 (那邊只列了 4 位) */
const MEMBERS = 20;

const ROWS = [
  { name: "丹帝 & 噴火龍", owners: 20 },
  { name: "水梧桐 & 蓋歐卡", owners: 15 },
  { name: "大吾 & 巨金怪", owners: 11 },
  { name: "露璃娜 & 暴噬龜", owners: 4, ticks: true },
  // 0 人 = 剛上架、全館還沒人抽到 —— 這一頁最常被拿來看的其實是「我們缺什麼」
  { name: "神代 & 急凍鳥", owners: 0 },
] as const;

/** 門檻與顏色 = gyms/[id]/pairs 的 CoverageBar (全滿綠 / 過半藍 / 有人黃) */
function toneOf(ratio: number) {
  if (ratio === 1) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-sky-500";
  if (ratio > 0) return "bg-amber-500";
  return "bg-muted-foreground/30";
}

export function HomePairsBoard({
  /** 由 HomeHeroBoards 統一掌控: 進場約一秒後播那一下變化 (持有 4 → 5) */
  ticked = false,
  className,
}: {
  ticked?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label="全館拍組持有率示範"
      // flex-col + flex-1 的 ul —— 與 home-ticket-board 同一招: 兩塊疊在一起時, 矮的那塊
      // 把多出來的高度吃在清單上, 底部分隔線兩塊對齊 (見那邊的註解)。
      className={cn("flex flex-col rounded-2xl border bg-card p-4 text-left shadow-sm sm:p-5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">拍組</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          20 人
        </span>
      </div>

      <ul className="mt-3 flex-1 space-y-3">
        {ROWS.map((r) => {
          const owners = "ticks" in r && ticked ? r.owners + 1 : r.owners;
          const ratio = owners / MEMBERS;
          return (
            <li key={r.name}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  <span
                    key={owners}
                    className={cn(
                      "inline-block text-foreground",
                      "ticks" in r && ticked && "animate-count-pop"
                    )}
                  >
                    {owners}
                  </span>
                  /{MEMBERS}
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
                    toneOf(ratio)
                  )}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {/* 剛更新的那一筆 —— 出現的同時上面的持有數才加, 兩者是同一件事 */}
      <p
        className={cn(
          "mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground",
          "transition-opacity duration-300 motion-reduce:transition-none",
          ticked ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-foreground">小茂</span> 更新練度 · 持有{" "}
        <span className="font-mono tabular-nums">4 → 5</span>
      </p>
    </div>
  );
}
