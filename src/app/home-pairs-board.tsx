"use client";

// 首頁 hero 的看板之一 —— 「全館拍組持有」(與 home-ticket-board 輪替顯示, 這塊排第一)。
//
// 這塊回答標題那句的前半:「拍組…全館一目了然」—— 一份拍組名單 + 每一組「20 人中幾人有」。
//
// **列的是 catalog 裡最新上架的五組** (2026-09-03 使用者指定), 由 page.tsx 在 server 端挑好傳進來:
// 首頁因此會自己跟著改版更新, 不用有人記得回來改死字串。持有人數是**隨機**的 (使用者:「隨機就可以了」),
// 但在 server 端擲一次再傳下來 —— 在 client 擲會 SSR 與 hydration 對不起來。
// 越新的組人越少有 (擲骰的區間是照名次分的), 所以長條的顏色一定有層次, 不會五條一樣長。
//
// 視覺語彙一律沿用真的那一頁 (gyms/[id]/pairs 的 CoverageBar): h-1 長條、同一組門檻與顏色、
// `count/total` tabular-nums。看起來要像產品的一角, 不是另外畫一張示意圖。
//
// 每一列的圖是**一組拍組, 不是兩張圖**: 訓練家立繪當本體、寶可夢壓在右下角 ——
// 官方卡面與站內 SyncPairCard 就是這個排法 (使用者:「不要把拍組的人跟寶可夢分開 不合理」)。
//
// 長條在看板進場時從 0 掃到實際值 (`revealed`, 每列錯開 60ms): 那不是裝飾 ——
// 它演的就是「資料填進來」這件事本身, 也是這塊看板唯一的開場動作。

// <img> 而不是 next/image (全站慣例, 同 candy.tsx / sync-pair-badges.tsx): 這些圖是資料管線
// 產好的 128px WebP, 由 Workers Assets 直送 (public/_headers 給 30 天快取), 尺寸與格式都已經定死,
// next/image 沒有東西可以再優化, 只會多一層 loader。
/* eslint-disable @next/next/no-img-element */

import { cn } from "@/lib/utils";
// 名單與人數怎麼來的 (最新五組 + 隨機持有數) 在這裡, 由 page.tsx 在 server 端算好傳進來
import { HOME_GYM_MEMBERS, type HomePairRow } from "./home-latest-pairs";

/** 門檻與顏色 = gyms/[id]/pairs 的 CoverageBar (全滿綠 / 過半藍 / 有人黃 / 沒人灰) */
function toneOf(ratio: number) {
  if (ratio === 1) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-sky-500";
  if (ratio > 0) return "bg-amber-500";
  return "bg-muted-foreground/30";
}

/**
 * 一組拍組 = **一個東西**, 不是兩顆並排的圓 (使用者:「不要把拍組的人跟寶可夢分開 不合理」)。
 * 排法照官方卡面與站內 SyncPairCard: 訓練家立繪當本體, 寶可夢在右下角壓著邊。
 * (這裡不能直接用 SyncPairCard —— 它最小 96px, 塞不進 32px 的清單列。)
 */
function PairChip({ trainerId, pokemonId }: { trainerId: string; pokemonId: string }) {
  return (
    <span className="relative mr-1 block h-8 w-8 shrink-0">
      <img
        src={`/reference/trainer/${trainerId}_128.webp`}
        alt=""
        width={32}
        height={32}
        draggable={false}
        decoding="async"
        className="h-8 w-8 rounded-lg bg-muted object-cover ring-1 ring-border/60"
      />
      <img
        src={`/reference/pokemon/${pokemonId}_128.webp`}
        alt=""
        width={18}
        height={18}
        draggable={false}
        decoding="async"
        // ring 用卡片底色而不是邊框色: 壓在立繪上要有一圈「挖空」才分得出來, 跟官方卡面一樣
        className="absolute -right-1 -bottom-1 h-[18px] w-[18px] rounded-full bg-muted object-cover ring-2 ring-card"
      />
    </span>
  );
}

export function HomePairsBoard({
  rows = [],
  /** 由 HomeHeroBoards 統一掌控: 進場約一秒後播那一下變化 (第一列 +1 人) */
  ticked = false,
  /** 長條掃到實際值 — 看板第一次進場時才播, 之後輪回來不再重來 (每次都掃會變吵) */
  revealed = false,
  className,
}: {
  rows?: HomePairRow[];
  ticked?: boolean;
  revealed?: boolean;
  className?: string;
}) {
  // 第一列 = 最新上架的那組, 那一列演「剛剛有人抽到」
  const bumped = rows[0]?.owners ?? 0;

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
          {HOME_GYM_MEMBERS} 人
        </span>
      </div>

      <ul className="mt-3 flex-1 space-y-2.5">
        {rows.map((r, i) => {
          const owners = i === 0 && ticked ? r.owners + 1 : r.owners;
          const ratio = owners / HOME_GYM_MEMBERS;
          return (
            <li key={r.pairId} className="flex items-center gap-2.5">
              <PairChip trainerId={r.trainerId} pokemonId={r.pokemonId} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <span
                      key={owners}
                      className={cn(
                        "inline-block text-foreground",
                        i === 0 && ticked && "animate-count-pop"
                      )}
                    >
                      {owners}
                    </span>
                    /{HOME_GYM_MEMBERS}
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
        <span className="font-mono tabular-nums">
          {bumped} → {bumped + 1}
        </span>
      </p>
    </div>
  );
}
