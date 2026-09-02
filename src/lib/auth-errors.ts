// 把 Supabase Auth 的英文錯誤訊息對應成繁中 (UI 全繁中, 不該吐原始英文給使用者)。
// 找不到對應時回傳通用訊息, 不直接洩漏原始字串。
export function authErrorMessage(raw: string | undefined | null): string {
  const msg = (raw ?? "").toLowerCase();
  if (!msg) return "發生未知錯誤, 請稍後再試";
  if (msg.includes("invalid login credentials")) return "Email 或密碼錯誤";
  if (msg.includes("email not confirmed")) return "Email 尚未驗證, 請先到信箱點確認連結";
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "此 Email 已經註冊過了";
  }
  if (msg.includes("rate limit")) return "嘗試次數過多, 請稍後再試";
  if (msg.includes("password")) return "密碼不符合要求 (至少 6 個字元)";
  if (msg.includes("signups not allowed") || msg.includes("signup is disabled")) {
    return "目前未開放註冊";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "網路連線失敗, 請稍後再試";
  }
  return "操作失敗, 請稍後再試";
}
