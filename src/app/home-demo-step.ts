"use client";

import { useEffect, useState } from "react";

/**
 * 首頁兩塊看板各自的「示範動作」時間軸。
 *
 * 每塊看板演的是它在產品裡真正的操作 (點卡片左下角調寶數 / 選拍組出刀), 一輪演完再從頭。
 * 時間軸放在這裡而不是各自寫 timer, 是因為兩塊有同一組規矩:
 *
 *  - **只有被看到的那塊在跑** (`active`): 兩塊看板一直都掛著 (輪替靠淡入), 各自算 timer 的話
 *    背面那塊的動作會在沒人看的時候演完, 輪到它時已經停在最後一格 (這個坑踩過)。
 *  - **不 active 就回到第 0 格**, 所以每次輪回來都是從頭演。
 *  - setState 一律在 `setTimeout` 裡呼叫, 不在 effect 本體 —— react-hooks 的規則會擋
 *    (同樣的坑在 home-ticket-board 踩過一次)。
 *
 * `durations[i]` = 第 i 格停留幾毫秒。陣列要是模組層級的常數 (穩定的參考),
 * 不然每次 render 都會重掛 effect。
 */
export function useDemoStep(active: boolean, durations: readonly number[]): number {
  const [step, setStep] = useState(0);

  useEffect(() => {
    let timer = 0;
    const show = (n: number) => {
      setStep(n);
      if (!active) return; // 收在第 0 格
      timer = window.setTimeout(() => show((n + 1) % durations.length), durations[n]);
    };
    // 走 setTimeout(0) 而不是直接呼叫: effect 本體不能同步 setState
    timer = window.setTimeout(() => show(0), 0);
    return () => window.clearTimeout(timer);
  }, [active, durations]);

  return step;
}
