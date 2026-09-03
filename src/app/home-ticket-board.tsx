"use client";

// 首頁 hero 的看板之一 —— 「道館戰」(與 home-pairs-board 輪替顯示)。
//
// 這塊回答標題那句的後半:「道館、分配…一目了然」, 而且**演一次真正的操作**
// (2026-09-03 使用者:「道館戰出刀選擇, 選擇完會跳到統計的動態」):
//
//   上半 = 出刀。挑一組拍組 → 回報 → 券自動扣。那就是站內看板 `reportBattleLog` 的流程
//          (AGENTS「新增對戰紀錄只有一條路」), 這裡只是把它演一遍。
//   下半 = 全館剩餘挑戰券。回報的同一瞬間, **小霞那一列 13 → 12 並且亮一下** ——
//          「選完就跳到統計」講的就是這件事: 登記與統計是同一個動作, 不用有人另外記帳。
//
// 示範成員刻意用寶可夢主角的名字 (小智/小霞/小剛/小光/小遙): 一看就知道是範例, 不會被誤認成真人。
// 頭貼用他們**自己**在遊戲裡的訓練家立繪 —— 真的成員在 onboarding 就會設頭貼, 這塊照著演
// (全走 MemberAvatar 的 avatarUrl, 沒有第二套頭像實作; 五位都是 2019-2022 就上市的拍組)。
// 數字格式與真看板一致: `remaining/cap`、tabular-nums (battle-client.tsx:476)。

import { MemberAvatar } from "@/components/gym/member-card";
import { cn } from "@/lib/utils";
import { useDemoStep } from "./home-demo-step";
import type { HomePairRow } from "./home-latest-pairs";
import { PairChip } from "./home-pairs-board";

const CAP = 30;

const ROWS = [
  { name: "小智", face: "ch0264_00_satoshi", remaining: 27 },
  { name: "小霞", face: "ch0110_01_kasumi", remaining: 13, ticks: true },
  { name: "小剛", face: "ch0015_00_takeshi", remaining: 30 },
  { name: "小光", face: "ch0116_00_hikari", remaining: 3 },
  { name: "小遙", face: "ch0126_00_haruka", remaining: 21 },
] as const;

/**
 * 示範動作的時間軸:
 *   0 = 三組可選, 都沒選   1 = 選中中間那組   2 =「回報」亮起   3 = 券扣掉 + 那一列亮一下
 * 第 0 格久一點 (先看清楚在選什麼), 最後一格停久一點看結果。
 */
const STEP_MS = [1200, 700, 650, 2450] as const;
/** 選中第幾個 (中間那個, 視覺上最自然) */
const PICKED = 1;
const REPORT_AT = 2;
const DONE_AT = 3;

export function HomeTicketBoard({
  /** 出刀選單裡的三組拍組 (共用拍組看板那份最新五組, 不另外多抓圖) */
  rows = [],
  /** 是不是**現在被看到**的那塊 —— 只有它在跑示範動作 */
  active = false,
  className,
}: {
  rows?: HomePairRow[];
  active?: boolean;
  className?: string;
}) {
  const step = useDemoStep(active, STEP_MS);
  const options = rows.slice(0, 3);
  const done = step >= DONE_AT;

  return (
    <div
      role="img"
      aria-label="道館戰看板示範: 選拍組出刀, 回報後挑戰券自動扣"
      // flex-col + 下面那個 flex-1 的 ul —— 與 home-pairs-board 同一招: 兩塊疊在一起時,
      // 矮的那塊把多出來的高度吃在清單上, 底部分隔線兩塊對齊 (見那邊的註解)。
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-4 text-left shadow-sm sm:p-5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">道館戰</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          R2
        </span>
      </div>

      {/* ── 示範: 選一組出刀 → 回報 ── */}
      {options.length === 3 ? (
        <div className="mt-3 flex items-center gap-2 border-b border-border/60 pb-3">
          <span className="shrink-0 text-xs text-muted-foreground">第 3 關</span>
          <div className="flex items-center gap-1.5">
            {options.map((o, i) => {
              const picked = step >= 1 && i === PICKED;
              return (
                <span key={o.pairId} className="relative">
                  <PairChip
                    trainerId={o.trainerId}
                    pokemonId={o.pokemonId}
                    className={cn(
                      "mr-0 rounded-lg transition-all duration-300 motion-reduce:transition-none",
                      picked && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                      step >= 1 && !picked && "opacity-40"
                    )}
                  />
                  {/* 被選中的那一下: 漣漪蓋在頭像上 (key 換 = 重播) */}
                  {picked && step === 1 ? (
                    <span
                      key={step}
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-tap-ripple rounded-full bg-primary opacity-0 motion-reduce:animate-none"
                    />
                  ) : null}
                </span>
              );
            })}
          </div>
          <span
            className={cn(
              "relative ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-300 motion-reduce:transition-none",
              step >= REPORT_AT
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {done ? "已回報" : "回報"}
            {step === REPORT_AT ? (
              <span
                key={step}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-tap-ripple rounded-full bg-primary opacity-0 motion-reduce:animate-none"
              />
            ) : null}
          </span>
        </div>
      ) : null}

      <ul className="mt-3 flex-1 divide-y divide-border/60">
        {ROWS.map((r) => {
          const ticks = "ticks" in r;
          const value = ticks && done ? r.remaining - 1 : r.remaining;
          const low = value <= 5;
          return (
            <li
              key={r.name}
              className={cn(
                "-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-300 motion-reduce:transition-none",
                // 剛被扣券的那一列亮一下 —— 「選完就跳到統計」的落點在哪, 一眼看得到
                ticks && done && "bg-primary/10"
              )}
            >
              {/* 密集列一律 28px (AGENTS「成員頭像尺寸」), 與 gyms/[id]/pairs 同一行寫法 */}
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
                  className={cn(
                    "inline-block",
                    ticks && done && "animate-count-pop motion-reduce:animate-none"
                  )}
                >
                  {value}
                </span>
                <span className="text-muted-foreground">/{CAP}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
