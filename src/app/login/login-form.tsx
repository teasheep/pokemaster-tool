"use client";

// 登入頁的 Google 按鈕。
// One Tap **不在這裡** —— 它現在掛在 root layout (components/google-one-tap-slot.tsx),
// 全站的訪客都看得到, 包含這一頁。在這裡再掛一次會變成兩次 initialize()。
//
// 按鈕與 One Tap 是**同一條路的兩種觸發**, 不是兩種登入方式:
//   GoogleSignInButton = 使用者自己按 (整頁導向 Google → /auth/callback)
//   GoogleOneTap       = 已登入 Google 的人自動浮出的捷徑 (signInWithIdToken → /auth/one-tap)
// One Tap 可能因為 FedCM embargo / 沒登入 Google / 瀏覽器設定而不出現, 而且**偵測不到**,
// 所以按鈕永遠是保底入口, 不要拿掉。
import { useSearchParams } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-signin-button";

export function LoginForm() {
  const search = useSearchParams();
  return <GoogleSignInButton redirect={search.get("redirect")} />;
}
