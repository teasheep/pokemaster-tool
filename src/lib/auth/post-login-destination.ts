import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * 登入之後要去哪 —— **全站唯一一份實作**。
 *
 * 原本這段只寫在 `src/app/auth/callback/route.ts` 裡 (signInWithOAuth 的回呼)。
 * Google One Tap 走的是 `signInWithIdToken`, 根本不經過那條路由 —— 少了這個閘門,
 * 第一次登入的成員會直接落地, 永遠不會被要求設定遊戲名/社群名/頭貼。
 * 所以把它抽出來給兩條路徑共用, 而不是在 One Tap 那邊複製一份 (複製 = 兩份規則走鐘)。
 */

/**
 * 站內路徑檢查 (擋 open redirect: 外部網址 / 協定相對 `//host`)。
 * 與 `proxy.ts` 的 loginUrl()、`google-signin-button.tsx` 是同一條規則。
 *
 * 預設值是 `/gyms` —— 與登入頁那顆「使用 Google 登入」按鈕一致
 * (同一頁的兩個入口登入完要去同一個地方, 否則就是同一件事兩種結果)。
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/gyms"): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

/**
 * 首次登入 (profiles.onboarded_at 還是空的) → 先走 `/welcome` 設定引導;
 * 設定過的人直接去目的地。
 *
 * `next` 請先過 safeNextPath()。
 */
export async function resolvePostLoginPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  next: string
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.onboarded_at) return `/welcome?next=${encodeURIComponent(next)}`;
  return next;
}
