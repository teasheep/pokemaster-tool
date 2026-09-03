"use client";

// 首頁 hero 的看板之一 —— 「全館拍組持有」(與 home-ticket-board 輪替顯示, 這塊排第一)。
//
// 這塊回答標題那句的前半:「拍組…全館一目了然」—— 一份道館拍組名單 + 每一組「20 人中幾人有」。
//
// 視覺語彙一律沿用真的那一頁 (gyms/[id]/pairs 的 CoverageBar): h-1 長條、同一組門檻與顏色、
// `count/total` tabular-nums。看起來要像產品的一角, 不是另外畫一張示意圖。
//
// **每一列帶真的拍組頭像** (2026-09-03, 使用者:「完全看不出來跟遊戲有關」): 訓練家在前、
// 寶可夢在後的兩顆疊圓 —— 那就是「拍組」這個詞在畫面上的樣子。圖檔路徑格式與 sync-pair-card
// 同一套 (`/reference/{trainer,pokemon}/<id>_128.webp`, 線上一律 .webp)。
// 拍組全部是**已上市**的 (對過 catalog 的 releaseDate); 名字用 `pairName()` 的「人名 & 寶可夢名」格式。
// 讀者就是玩這款遊戲的人 —— 認得出「丹帝 & 噴火龍」比任何說明都快。
// 示範成員仍是主角名 (小光), 與道館戰看板同一座假道館。
//
// 長條在看板進場時從 0 掃到實際值 (`revealed`, 每列錯開 60ms): 那不是裝飾 ——
// 它演的就是「資料填進來」這件事本身, 也是這塊看板唯一的開場動作。

// <img> 而不是 next/image (全站慣例, 同 candy.tsx / sync-pair-badges.tsx): 這些圖是資料管線
// 產好的 128px WebP, 由 Workers Assets 直送 (public/_headers 給 30 天快取), 尺寸與格式都已經定死,
// next/image 沒有東西可以再優化, 只會多一層 loader。
/* eslint-disable @next/next/no-img-element */

import { cn } from "@/lib/utils";

/** 假道館的人數 —— 與 home-ticket-board 的 4 位示範成員屬同一座館 (那邊只列了 4 位) */
const MEMBERS = 20;

const ROWS = [
  { t: "ch0247_00_dande", p: "pm0006_00_lizardon", name: "丹帝 & 噴火龍", owners: 20 },
  { t: "ch0193_00_aogiri", p: "pm0382_00_kyogre", name: "水梧桐 & 蓋歐卡", owners: 15 },
  { t: "ch0090_00_daigo", p: "pm0376_00_metagross", name: "大吾 & 巨金怪", owners: 11 },
  { t: "ch0249_00_rulina", p: "pm0834_00_00_kajirigame", name: "露璃娜 & 暴噬龜", owners: 4, ticks: true },
  // 0 人 = 剛上架、全館還沒人抽到 —— 這一頁最常被拿來看的其實是「我們缺什麼」
  { t: "ch0201_00_jindai", p: "pm0144_00_freezer", name: "神代 & 急凍鳥", owners: 0 },
] as const;

/** 門檻與顏色 = gyms/[id]/pairs 的 CoverageBar (全滿綠 / 過半藍 / 有人黃) */
function toneOf(ratio: number) {
  if (ratio === 1) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-sky-500";
  if (ratio > 0) return "bg-amber-500";
  return "bg-muted-foreground/30";
}

/** 訓練家在前、寶可夢在後的兩顆疊圓 —— 「拍組」在畫面上的樣子 */
function PairChip({ t, p }: { t: string; p: string }) {
  return (
    <span className="relative block h-7 w-11 shrink-0">
      <img
        src={`/reference/pokemon/${p}_128.webp`}
        alt=""
        width={24}
        height={24}
        draggable={false}
        decoding="async"
        className="absolute top-0.5 right-0 h-6 w-6 rounded-full bg-muted object-cover ring-1 ring-border/60"
      />
      <img
        src={`/reference/trainer/${t}_128.webp`}
        alt=""
        width={28}
        height={28}
        draggable={false}
        decoding="async"
        className="absolute top-0 left-0 h-7 w-7 rounded-full bg-muted object-cover ring-2 ring-card"
      />
    </span>
  );
}

export function HomePairsBoard({
  /** 由 HomeHeroBoards 統一掌控: 進場約一秒後播那一下變化 (持有 4 → 5) */
  ticked = false,
  /** 長條掃到實際值 — 看板第一次進場時才播, 之後輪回來不再重來 (每次都掃會變吵) */
  revealed = false,
  className,
}: {
  ticked?: boolean;
  revealed?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label="全館拍組持有率示範"
      // flex-col + 下面那個 flex-1 的 ul: 兩塊看板疊在同一格 (高度取最高的那塊), 比較矮的那塊
      // 把多出來的高度留給清單, 底部那條分隔線與最後一行就會停在**同一個位置** —— 輪替時
      // 只有內容換掉, 卡片的骨架不動。
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-4 text-left shadow-sm sm:p-5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">拍組</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          20 人
        </span>
      </div>

      <ul className="mt-3 flex-1 space-y-2.5">
        {ROWS.map((r, i) => {
          const owners = "ticks" in r && ticked ? r.owners + 1 : r.owners;
          const ratio = owners / MEMBERS;
          return (
            <li key={r.name} className="flex items-center gap-2.5">
              <PairChip t={r.t} p={r.p} />
              <div className="min-w-0 flex-1">
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
                      "h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
                      toneOf(ratio)
                    )}
                    style={{
                      width: revealed ? `${ratio * 100}%` : 0,
                      transitionDelay: `${i * 60}ms`,
                    }}
                  />
                </div>
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
        <span className="text-foreground">小光</span> 更新練度 · 持有{" "}
        <span className="font-mono tabular-nums">4 → 5</span>
      </p>
    </div>
  );
}
