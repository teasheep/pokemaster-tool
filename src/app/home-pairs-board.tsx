"use client";

// 首頁 hero 的看板之一 —— 「拍組」(與 home-ticket-board 輪替顯示, 這塊排第一)。
//
// 這塊回答標題那句的前半:「拍組…一目了然」, 而且**演一次真正的操作**
// (2026-09-03 使用者:「太死板了, 能不能做一個 click 拍組左下就可以調整寶數的動態」):
//
//   上半 = 一張真的 `SyncPairCard`。灰卡 (寶0) → 左下角浮出點擊漣漪 → 寶1 → 寶2 → 寶3,
//          卡片同時亮起來。那就是站內 /pairs 的手勢本人 (AGENTS「點左下角 = 寶數循環」),
//          用的是同一個元件, 不是另外畫的示意圖。
//   下半 = 全館持有清單。寶數一調到 3, **第一列的持有人數跟著 +1、長條跟著長**
//          —— 演的是 `syncMemberPair` 那條雙表同步: 你改自己的練度, 全館的統計就變了。
//          「一目了然」講的就是這件事, 用看的比用寫的快。
//
// 列的是 catalog 裡**最新上架的五組 5★** (使用者指定), 由 page.tsx 在 server 端挑好傳進來;
// 持有人數隨機但照名次分區間 (越新的越少人有) —— 細節見 home-latest-pairs.ts。
//
// 視覺語彙一律沿用真的那一頁 (gyms/[id]/pairs 的 CoverageBar): h-1 長條、同一組門檻與顏色、
// `count/total` tabular-nums。看起來要像產品的一角, 不是另外畫一張示意圖。

// <img> 而不是 next/image (全站慣例, 同 candy.tsx / sync-pair-badges.tsx): 這些圖是資料管線
// 產好的 128px WebP, 由 Workers Assets 直送 (public/_headers 給 30 天快取), 尺寸與格式都已經定死,
// next/image 沒有東西可以再優化, 只會多一層 loader。
/* eslint-disable @next/next/no-img-element */

import { SyncPairCard } from "@/components/sync-pair-card";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { cn } from "@/lib/utils";
import { useDemoStep } from "./home-demo-step";
import { HOME_GYM_MEMBERS, type HomePairRow } from "./home-latest-pairs";

/**
 * 示範動作的時間軸 —— 格號**就是寶數** (0=灰卡)。
 * 第一格久一點 (讓人先看到灰卡是什麼樣), 中間兩下快 (連點的節奏), 最後一格停久一點看結果。
 */
const STEP_MS = [1100, 520, 520, 2600] as const;
/** 演到這一格 (寶3) 時, 全館持有 +1 */
const BUMP_AT = 3;

/** 卡片左下角計數的中心 = SVG 的 (19, 108) / 128 —— 漣漪要蓋在那裡 */
const CARD_PX = 96; // size="sm"
const COUNT_X = (CARD_PX * 19) / 128;
const COUNT_Y = (CARD_PX * 108) / 128;

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
 * (清單列塞不下真的 SyncPairCard —— 它最小 96px, 這裡是同一種排法的縮小版。)
 */
export function PairChip({
  trainerId,
  pokemonId,
  className,
}: {
  trainerId: string;
  pokemonId: string;
  className?: string;
}) {
  return (
    <span className={cn("relative mr-1 block h-8 w-8 shrink-0", className)}>
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
  /** 示範用的那張卡 (= rows[0] 那一組的完整 catalog 紀錄) */
  demoPair,
  /** 是不是**現在被看到**的那塊 —— 只有它在跑示範動作 */
  active = false,
  /** 長條掃到實際值 — 看板第一次進場時才播, 之後輪回來不再重來 (每次都掃會變吵) */
  revealed = false,
  className,
}: {
  rows?: HomePairRow[];
  demoPair?: ClientPairRecord | null;
  active?: boolean;
  revealed?: boolean;
  className?: string;
}) {
  const step = useDemoStep(active, STEP_MS);
  const bumped = step >= BUMP_AT;

  return (
    <div
      role="img"
      aria-label="拍組持有率示範: 點卡片左下角調寶數, 全館持有跟著更新"
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

      {/* ── 示範: 點左下角調寶數 ── */}
      {demoPair ? (
        <div className="mt-3 flex items-center gap-3 border-b border-border/60 pb-3">
          <div className="relative shrink-0">
            <SyncPairCard
              pair={demoPair}
              size="sm"
              potential={step}
              owned={step > 0}
              minimal
              showName={false}
              eager
            />
            {/* 點擊漣漪 —— key 帶著格號, 換格就重新掛載 = 重播一次。
                第 0 格 (回到灰卡) 不播: 那一下是「重來」不是使用者點的。 */}
            {step > 0 ? (
              <span
                key={step}
                aria-hidden
                className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 animate-tap-ripple motion-reduce:animate-none"
                style={{ left: COUNT_X, top: COUNT_Y }}
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{rows[0]?.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {"點左下角 · "}
              <span
                key={step}
                className="inline-block font-medium text-foreground animate-count-pop motion-reduce:animate-none"
              >
                {step === 0 ? "未持有" : `寶${step}`}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      <ul className="mt-3 flex-1 space-y-2.5">
        {rows.map((r, i) => {
          // 第一列 = 示範的那一組: 寶數調上去的同時全館持有 +1
          const owners = i === 0 && bumped ? r.owners + 1 : r.owners;
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
                        i === 0 && bumped && "animate-count-pop motion-reduce:animate-none"
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
    </div>
  );
}
