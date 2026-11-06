"use client";

// 重新整理之後回到原本捲到的位置 (2026-11-04 使用者:「現在點人 刷新頁面 會自動跳回去 盡量不要
// 道館戰頁面也是」)。
//
// **瀏覽器自己的捲動還原在這裡不夠用**: 它只在頁面載完的那一刻試一次, 而道館頁的內容是
// 串流進來的 (先骨架, 成員的卡牆、看板的關卡再由 client 抓) —— 那一刻頁面還不夠高,
// 捲不到原本的位置, 於是停在最上面。這裡改成「等到頁面夠高再捲過去」。
//
// 三條規則:
//   1. **只處理重新整理** (navigation type = reload)。站內換頁的捲動交給 Next, 不要插手。
//   2. **使用者一動就放手** (滾輪 / 觸控 / 按鍵 / 點擊) —— 不然他想往上捲會被拉回來。
//   3. 最多等 8 秒; 頁面夠高之後再守 0.8 秒 (上面的區塊可能晚一點才長出來), 之後就不管了。
// 一份文件只還原一次 (模組層的 `pending`): layout 重新掛載 (換到另一館再回來) 時 navigation type
// 仍然是 reload, 不擋的話會把人捲到一個早就不相干的位置。
// ⚠ **「用掉」要等還原真的結束才算, 不是 effect 一跑就算**: dev 的 StrictMode 會
// 掛載 → 清掉 → 再掛載, 第一次的清掉會把還原中斷 —— 那時候就標成「試過了」的話,
// 第二次掛載什麼都不做, 結果就是停在最上面 (2026-11-04 實測踩到)。

import { useEffect } from "react";

const KEY = "pm-gym:reload-scroll:v1";
const GIVE_UP_MS = 8000;
const SETTLE_MS = 800;
const USER_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** undefined = 還沒判斷; null = 不用還原 (或已經還原完了) */
let pending: { url: string; y: number } | null | undefined;

const here = () => window.location.pathname + window.location.search;

function readPending(): { url: string; y: number } | null {
  if (pending !== undefined) return pending;
  pending = null;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== "reload") return pending;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as { url?: unknown; y?: unknown } | null;
    if (saved && typeof saved.url === "string" && typeof saved.y === "number" && saved.y > 0) {
      pending = { url: saved.url, y: saved.y };
    }
  } catch {
    /* 讀不到就不還原 */
  }
  return pending;
}

/**
 * 一直捲到 y, 直到頁面夠高而且穩定下來。
 * 回傳的函式 = 中斷 (元件卸載用, 不算還原完); `onFinish` 只在真的結束時呼叫
 * (到位且穩定 / 逾時 / 使用者自己動了)。
 */
function restore(y: number, onFinish: () => void): () => void {
  const t0 = performance.now();
  let raf = 0;
  let stopped = false;
  let settledAt = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    for (const e of USER_EVENTS) window.removeEventListener(e, finish, true);
  };
  const finish = () => {
    if (stopped) return;
    stop();
    onFinish();
  };
  for (const e of USER_EVENTS) window.addEventListener(e, finish, { capture: true, passive: true });
  const tick = (now: number) => {
    if (stopped) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.min(y, Math.max(0, max));
    if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    if (max >= y) {
      settledAt ||= now;
      if (now - settledAt > SETTLE_MS) return finish();
    } else {
      settledAt = 0;
    }
    if (now - t0 > GIVE_UP_MS) return finish();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}

export function ReloadScrollRestore() {
  useEffect(() => {
    const save = () => {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify({ url: here(), y: Math.round(window.scrollY) }));
      } catch {
        /* 無痕 / 被擋的 site data —— 就是不還原, 跟原本一樣 */
      }
    };
    // pagehide 是重新整理前最後一個可靠的事件; 手機 Safari 偶爾不給, visibilitychange 補一次
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);

    let stop = () => {};
    const want = readPending();
    if (want) {
      // 比路徑就好: 子元件在掛載時可能已經把查詢字串正規化過一次 (useUrlState 比這裡早跑)
      if (want.url.split("?")[0] === window.location.pathname) {
        stop = restore(want.y, () => {
          pending = null;
        });
      } else {
        // 重新整理的是別頁, 這裡是之後站內走過來的 —— 不相干, 以後也不用再試
        pending = null;
      }
    }
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      stop();
    };
  }, []);
  return null;
}
