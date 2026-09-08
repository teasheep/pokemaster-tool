"use client";

// 「重新整理要留在原本的畫面」—— 把決定畫面長相的 client 狀態 (在哪個子分頁、
// 看哪一位成員、有沒有開只看持有的) 同步進網址的查詢字串。
// (2026-09-08 使用者:「重新整理會固定帶到道館重點拍組的 tab, 但應該要留在使用者
//  目前的畫面才對, 這個整體都需要調整一下」)
//
// **為什麼是網址而不是 localStorage**: 網址同時解決重新整理、上一頁/下一頁、
// 把連結貼給別人三件事; localStorage 只解決第一件, 而且會讓「同一個網址兩個人看到
// 不一樣的東西」。站內已經有這個慣例了 (`/pairs?tab=`、`/gyms?list=1`)。
//
// **為什麼用原生的 history.replaceState 而不是 router.replace**:
// `router.replace` 會走一次 Next 的導覽 → 這些頁都是 `force-dynamic`, 等於每點一次
// 分頁就多付一趟伺服器往返 (那正是 middleware 樂觀檢查在省的東西)。
// Next 16 明文支援原生 History API 並且會與路由同步
// (node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md
//  「Shallow routing on the client」: pushState/replaceState calls integrate into
//  the Next.js Router)。
//
// **replaceState 不是 pushState**: 切分頁不該塞進上一頁的歷史 —— 使用者按上一頁時
// 想回到的是上一個**頁面**, 不是上一個分頁狀態 (連按五次才離開這頁會很煩)。
//
// **初始值一律由 server 端的 page.tsx 從 searchParams 讀了往下傳**, 不要在這裡用
// `useSearchParams` 當初始值 —— 那會讓 server render 出來的 HTML 與 client 首次
// render 不一致 (hydration mismatch)。這支 hook **只負責寫**。

import { useEffect, useRef } from "react";

/**
 * 把一組值同步進網址。`null` / `undefined` = 從網址移除 (等於預設值就不要留在網址上,
 * 網址才不會長出一串沒有意義的參數)。
 *
 * 只動自己列出來的 key, 其餘參數原封不動 —— 同一頁可以有多個元件各自同步自己那幾個。
 */
export function useUrlState(values: Record<string, string | null | undefined>): void {
  // 物件每次 render 都是新的, 用序列化後的內容當相依 (值沒變就不要動網址)
  const serialized = JSON.stringify(values);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(JSON.parse(serialized) as Record<string, string | null>)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    // 內容一樣就不要呼叫 —— 每次 replaceState 都會讓 Next 重算一次路由狀態
    if (url === last.current) return;
    last.current = url;
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", url);
    }
  }, [serialized]);
}

/** 把查詢字串的值收斂成允許的選項之一; 不認得就回預設 (使用者可以手改網址) */
export function pickParam<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(v as T) ? (v as T) : fallback;
}
