"use client";

// 首頁 hero 的插圖 —— 兩塊看板輪替 (拍組持有 → 道館戰 → …)。
//
// 為什麼是兩塊: 標題那句是「拍組、道館戰分配，全館一目了然」, 只放一塊的話另外半句沒有畫面。
// **拍組排第一** (2026-09-03 使用者指定) —— 它也是句子的前半, 而且有頭像, 第一眼就看得出是這款遊戲。
//
// 四件刻意的設計:
//  1. **兩塊一直都掛著**, 只是輪流淡入 —— 用 grid 把兩者疊在同一格 (col/row-start-1),
//     所以容器高度 = 比較高的那塊, 切換時版面**一個像素都不動**。兩塊也都吃 `h-full`,
//     卡片外框因此一樣高, 不會一下高一下矮。交換時帶 8px 的上浮 (距離小、收得慢 = 沉穩)。
//  2. **那一下變化 (券 13→12 / 持有 4→5) 由這裡統一計時**: 看板自己算 timer 的話, 兩顆
//     timer 都在頁面載入時跑完, 輪到第二塊時它的動作早就播完了。`tickedFor` 記「哪一格的
//     動作已經播過」, index 一換就自動回到未播狀態, 每次輪回來都會重播一次。
//  3. **長條的掃入只播第一次** (`revealed` 是累積的, 不像 ticked 會重置): 第一印象要有
//     「資料填進來」那一下, 但每輪回來都掃一次就變成吵。
//  4. **點過圓點就停止自動輪替** (WCAG 2.2.2: 自動變動的內容要有辦法停下來)。
//     滑鼠移上去 / 鍵盤 focus 進來也暫停 —— 有人正在看的時候不要抽換他在看的東西。
//     `prefers-reduced-motion` 則一開始就不自動輪, 只留圓點讓人自己切。

import { useEffect, useState, useSyncExternalStore } from "react";

import { COARSE_HIT_AREA } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HomePairsBoard } from "./home-pairs-board";
import { HomeTicketBoard } from "./home-ticket-board";

type BoardProps = { ticked?: boolean; revealed?: boolean; className?: string };

const BOARDS: { key: string; label: string; Board: React.ComponentType<BoardProps> }[] = [
  { key: "pairs", label: "全館拍組持有", Board: HomePairsBoard },
  { key: "battle", label: "道館戰看板", Board: HomeTicketBoard },
];

/** 每塊看板停留多久 (含開場那一秒的動作, 剩下約 5 秒讓人看完五列) */
const HOLD_MS = 6000;
/** 進場後多久播那一下變化 (券 13→12 / 持有 4→5) */
const TICK_MS = 1100;
/** 進場後多久開始掃長條 —— 要等淡入起了頭才掃, 同時發生會糊成一團 */
const REVEAL_MS = 220;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const getReduce = () =>
  typeof window.matchMedia === "function" ? window.matchMedia(REDUCE_QUERY).matches : false;

export function HomeHeroBoards({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const [index, setIndex] = useState(0);
  // 「已經播過動作的是哪一格」— 存 index 而不是 boolean, 換格時 `ticked` 自動回 false,
  // 不必在 effect 裡同步 setState (那會被 react-hooks 的規則擋下)
  const [tickedFor, setTickedFor] = useState(-1);
  // 長條掃過的格子 (累積, 不重置)
  const [revealed, setRevealed] = useState<number[]>([]);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  // SSR 一律當作「不需要減少動態」→ 首次 render 兩端一致, 沒有 hydration mismatch
  const reduce = useSyncExternalStore(subscribeReduce, getReduce, () => false);

  const ticked = tickedFor === index;

  useEffect(() => {
    const t = window.setTimeout(() => setTickedFor(index), reduce ? 0 : TICK_MS);
    return () => window.clearTimeout(t);
  }, [index, reduce]);

  useEffect(() => {
    const t = window.setTimeout(
      () => setRevealed((prev) => (prev.includes(index) ? prev : [...prev, index])),
      reduce ? 0 : REVEAL_MS
    );
    return () => window.clearTimeout(t);
  }, [index, reduce]);

  useEffect(() => {
    if (!auto || paused || reduce) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % BOARDS.length), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [auto, paused, reduce, index]);

  return (
    <div
      className={className}
      style={style}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* 兩塊疊在同一格 → 容器高度取最高的那塊, 切換時不會有版面跳動 */}
      <div className="grid">
        {BOARDS.map(({ key, Board }, i) => (
          <div
            key={key}
            aria-hidden={i !== index}
            className={cn(
              "col-start-1 row-start-1 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
              i === index ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
            )}
          >
            <Board ticked={ticked} revealed={revealed.includes(i)} className="h-full" />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {BOARDS.map(({ key, label }, i) => (
          <button
            key={key}
            type="button"
            aria-label={`顯示${label}`}
            aria-current={i === index}
            onClick={() => {
              setAuto(false);
              setIndex(i);
            }}
            className={cn(
              // 圓點本體就是按鈕; 觸控裝置的 44px 命中區由 COARSE_HIT_AREA 用隱形覆蓋層補,
              // 不佔版面 (與全站其他小型控制項同一套做法, 需自帶 relative)
              "relative h-1.5 rounded-full outline-none transition-all",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              i === index ? "w-6 bg-foreground/70" : "w-1.5 bg-foreground/25 hover:bg-foreground/50",
              COARSE_HIT_AREA
            )}
          />
        ))}
      </div>
    </div>
  );
}
