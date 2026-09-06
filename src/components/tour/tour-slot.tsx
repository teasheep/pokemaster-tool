import { getSessionUser } from "@/lib/supabase/server";

import { TourRunner } from "./tour-runner";

/**
 * 使用教學的掛載點 —— 與 GoogleOneTapSlot 同一個做法:
 * async server 元件, **訪客直接 return null** (連 client 程式碼都不送)。
 * 教學講的是道館與拍組練度, 那些頁本來就要登入。
 *
 * RootLayout 要用 <Suspense> 包它 (layout 自己不准 await, AGENTS 的老地雷)。
 * getSessionUser 是 request 級 cache, 與 SiteHeader / MobileTabBarSlot 共用同一次往返。
 */
export async function TourSlot() {
  let userId: string | null = null;
  try {
    userId = (await getSessionUser())?.id ?? null;
  } catch {
    // Supabase 沒設定 / auth 失敗: 當訪客處理
  }
  if (!userId) return null;
  return <TourRunner userId={userId} />;
}
