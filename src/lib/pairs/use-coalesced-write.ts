"use client";

// 連點的寫入合併成一次 —— 「按到寶5 要按 5 下, 就打了 5 次 API」的解法。
// (2026-09-10 使用者:「比方說寶數+1 就要等一下下, 要按到寶5 按5下, 要打5次API」)
//
// 卡片左下角的寶數循環一次只 +1, 所以「寶0 → 寶5」在使用者眼裡是**一個動作**,
// 但在網路上是五趟跨太平洋的往返。畫面本來就是樂觀更新 (點下去立刻變),
// 真正拖慢的是那五趟往返互相排隊 —— 而且中間四趟的值馬上就被下一趟蓋掉, 全是白工。
//
// 這支 hook 只做一件事: **同一個 key 在安靜 delay 毫秒之後才送出最後一次的值**。
//   - 送出的一律是最新值 (中間的過程狀態不需要進資料庫)
//   - payload 用 merge 合併不是覆蓋 —— 側板改等級、左下角改寶數可能落在同一個視窗裡,
//     覆蓋的話先改的那個欄位會被吃掉
//   - 元件卸載、分頁被藏起來、關掉分頁之前一律**立刻沖出去**, 不然使用者點完就切走會掉資料
//
// ⚠ 這不是「延後儲存」的通用機制, 只給**連點同一顆按鈕**這種手勢用。
//   一次性的動作 (按下「一鍵升滿」、切道館拍組) 不要走這裡, 直接寫就好。

import { useCallback, useEffect, useRef } from "react";

/** 安靜多久才送出。太短等於沒合併, 太長會讓「改完馬上重整」看到舊值。 */
export const COALESCE_MS = 450;

type Pending<T> = { payload: T; timer: ReturnType<typeof setTimeout> | null };

/**
 * 所有還在等的佇列 —— 給「使用教學結束時把它們丟掉」用。
 *
 * ⚠ 為什麼非有這個不可 (2026-09-10, 差點破了教學的紅線):
 * 教學開著時所有寫入都會被 `lib/supabase/tour-writes.ts` 在 fetch 那一層吞掉。
 * 但**合併之後那一趟 fetch 是延後才發的** —— 使用者在教學裡點了左下角加寶數,
 * 450ms 還沒到就按了結束, `closeTour()` 已經把攔截關掉, 計時器才醒過來,
 * 那一筆就**真的寫進資料庫**了。而且 `swallowedWrites()` 是 0 (那趟 fetch 從來沒發生過),
 * 所以連「重新載入清掉樂觀更新」都不會做。
 *
 * 修法是丟掉不是沖出去: 教學裡的寫入本來就不該進資料庫, 沖出去只是換一個時間點被吞掉,
 * 而且 flush 是 async 的, 沖到一半攔截就被關掉的競態還在。
 */
const queues = new Set<{ drop: () => number }>();

/** 丟掉所有還在等的寫入, 回傳丟掉幾筆 (教學結束時呼叫) */
export function dropPendingCoalescedWrites(): number {
  let n = 0;
  for (const q of queues) n += q.drop();
  return n;
}

export function useCoalescedWrite<T>(
  flush: (key: string, payload: T) => Promise<void> | void,
  /** 兩次 schedule 落在同一個視窗時怎麼合 (預設淺層合併, 後者優先) */
  merge: (prev: T, next: T) => T = (prev, next) => ({ ...prev, ...next }),
  delay: number = COALESCE_MS
): (key: string, payload: T) => void {
  const pending = useRef(new Map<string, Pending<T>>());
  // flush / merge 每次 render 都是新函式 —— 放進 ref, schedule 的身分才穩得住
  // (它會被傳進卡牆的 handler; 身分一變整牆 SyncPairCard 的 memo 就全失效)。
  // **在 effect 裡寫 ref 不要在 render 裡寫** —— react-hooks/refs 會擋, 而且那條規則是對的:
  // render 階段寫 ref 在 concurrent 下不保證跑得到 (可能被丟棄重跑)。
  const flushRef = useRef(flush);
  const mergeRef = useRef(merge);
  useEffect(() => {
    flushRef.current = flush;
    mergeRef.current = merge;
  });

  const send = useCallback((key: string) => {
    const p = pending.current.get(key);
    if (!p) return;
    pending.current.delete(key);
    if (p.timer) clearTimeout(p.timer);
    void flushRef.current(key, p.payload);
  }, []);

  const sendAll = useCallback(() => {
    for (const key of [...pending.current.keys()]) send(key);
  }, [send]);

  // 教學結束時要丟掉還在等的那些 (見上面 queues 的註解)
  useEffect(() => {
    const entry = {
      drop: () => {
        let n = 0;
        for (const [, p] of pending.current) {
          if (p.timer) clearTimeout(p.timer);
          n += 1;
        }
        pending.current.clear();
        return n;
      },
    };
    queues.add(entry);
    return () => {
      queues.delete(entry);
    };
  }, []);

  useEffect(() => {
    // 切走 / 關分頁前把還沒送的沖出去 —— visibilitychange 是行動裝置唯一可靠的那個
    const onHide = () => {
      if (document.visibilityState === "hidden") sendAll();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", sendAll);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", sendAll);
      sendAll(); // 元件卸載 (換頁) 也要沖
    };
  }, [sendAll]);

  return useCallback(
    (key: string, payload: T) => {
      const prev = pending.current.get(key);
      if (prev?.timer) clearTimeout(prev.timer);
      const next = prev ? mergeRef.current(prev.payload, payload) : payload;
      pending.current.set(key, {
        payload: next,
        timer: setTimeout(() => send(key), delay),
      });
    },
    [delay, send]
  );
}
