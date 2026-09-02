"use client";

// 登入 — 只有 Google (帳密登入已移除, 見 /login page)。
// 兩個東西是**同一條路的兩種觸發**, 不是兩種登入方式:
//   GoogleSignInButton = 使用者自己按 (整頁導向 Google → /auth/callback)
//   GoogleOneTap       = 已登入 Google 的人自動浮出的捷徑 (signInWithIdToken → /auth/one-tap)
// One Tap 可能因為 FedCM embargo / 沒登入 Google / 瀏覽器設定而不出現, 而且**偵測不到**,
// 所以按鈕永遠是保底入口, 不要拿掉。
import { useSearchParams } from "next/navigation";

import { GoogleOneTap } from "@/components/google-one-tap";
import { GoogleSignInButton } from "@/components/google-signin-button";

export function LoginForm({ googleClientId }: { googleClientId: string | null }) {
  const search = useSearchParams();
  const redirect = search.get("redirect");
  return (
    <>
      <GoogleSignInButton redirect={redirect} />
      {/* 沒有可見 DOM — 提示由 Google 自己畫在視窗角落 */}
      <GoogleOneTap clientId={googleClientId} redirect={redirect} />
    </>
  );
}
