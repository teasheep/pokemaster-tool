// Session cookie 的**唯讀**判讀 —— 只用來決定「middleware 這一趟要不要打網路」。
//
// 背景: 每一個已登入請求原本要付兩趟 auth 往返 (middleware 一趟 + 頁面 getSessionUser()
// 一趟)。實測 middleware 那趟 77-973ms (Worker 在 SJC、Supabase 在新加坡, 每趟都跨太平洋),
// 而頁面自己的工作常常只有 63ms —— 也就是說整頁的時間有九成花在那一趟上。
//
// 做法 (lib/supabase/server.ts 的長註解裡早就寫好的方案): middleware 改成**樂觀檢查** ——
// 只看 cookie 在不在、access token 快不快過期, 不打網路; 真正的權威判斷留給頁面那一次
// getSessionUser() (它仍然是 getUser(), 會向 Supabase 驗簽)。
//
// ⚠ 這裡讀出來的東西**一律不可信**: cookie 是使用者可以任意偽造的, 這支檔案不驗簽章。
// 它只回答「要不要打網路」, 絕對不可以拿來當授權依據。安全性靠的是兩件事:
//   1. 每個受保護頁面都自己 `getSessionUser()` 後 redirect (2026-09-07 重新全數確認過,
//      連 /api/catalog 也補上了自己的檢查 —— 它原本是全站唯一純靠 middleware 當閘門的);
//   2. 所有資料查詢都帶著 cookie 裡真正的 JWT 走 RLS, 偽造的 token Supabase 會直接拒絕。
// 偽造 cookie 最多只能讓人多渲染一次「馬上又被導去 /login」的頁面, 拿不到任何資料。
//
// 解不出來的時候一律回 "authoritative" (走原本的完整流程) —— 失效方向是「慢但正確」,
// 所以哪天 @supabase/ssr 換了 cookie 格式, 最壞的情況只是回到今天的效能。

/** @supabase/ssr 的 storageKey = `sb-<project-ref>-auth-token`, 過長時切成 `.0` `.1` 分塊 */
const BASE64_PREFIX = "base64-";

/** 快到期就走完整流程, 讓 session 刷新、輪替後的 cookie 寫得回 response */
export const REFRESH_MARGIN_S = 120;

function isAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("auth-token");
}

/**
 * 有沒有 Supabase 的 session cookie。
 *
 * 判定刻意放寬 (sb- 開頭且含 auth-token): 漏判 = 當成訪客 → 非公開路由導去登入頁
 * (fail-closed, 不會放行任何東西); 誤判 = 只是多走一次原本就會走的完整流程。
 * 之後若自訂 `cookieOptions.name`, 這裡要跟著改。
 */
export function hasSupabaseAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some((c) => isAuthCookie(c.name));
}

/** 把 `<key>` 與它的 `.0` `.1` 分塊依**數字**接回一整串 (字串排序在超過 10 塊時會接錯) */
function joinChunks(cookies: { name: string; value: string }[]): string | null {
  const own = cookies.filter((c) => isAuthCookie(c.name));
  if (own.length === 0) return null;
  if (own.length === 1) return own[0]!.value;
  return own
    .map((c) => {
      const dot = c.name.lastIndexOf(".");
      const n = dot < 0 ? -1 : Number(c.name.slice(dot + 1));
      return { n: Number.isFinite(n) ? n : -1, value: c.value };
    })
    .sort((a, b) => a.n - b.n)
    .map((p) => p.value)
    .join("");
}

/** base64url → 字串。走 TextDecoder 而不是直接用 atob 的結果: session 裡有使用者名稱, 會是 UTF-8 */
function decodeBase64Url(input: string): string | null {
  try {
    const b64 = input.split("-").join("+").split("_").join("/");
    const padded = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4));
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 讀出 session 的到期時間 (epoch 秒)。讀不出來一律回 null → 呼叫端走完整流程。
 * **不驗簽章**, 只是拿來排程要不要刷新。
 */
export function readSessionExpiry(cookies: { name: string; value: string }[]): number | null {
  const raw = joinChunks(cookies);
  if (!raw) return null;
  const json = raw.startsWith(BASE64_PREFIX)
    ? decodeBase64Url(raw.slice(BASE64_PREFIX.length))
    : raw;
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "expires_at" in parsed) {
      const exp = (parsed as { expires_at: unknown }).expires_at;
      if (typeof exp === "number" && Number.isFinite(exp)) return exp;
    }
    return null;
  } catch {
    return null;
  }
}

export type ProxyMode =
  /** 完全沒有 session cookie —— 非公開路由直接導去登入頁 */
  | "guest"
  /** cookie 在、token 還很新 —— 這一趟不問 Supabase, 權威判斷交給頁面 */
  | "optimistic"
  /** 要問 Supabase: 快到期 / 已過期 / 讀不出來 / 在登入註冊頁 */
  | "authoritative";

export function proxyMode(
  cookies: { name: string; value: string }[],
  pathname: string,
  nowMs: number
): ProxyMode {
  if (!hasSupabaseAuthCookie(cookies)) return "guest";

  // 登入/註冊頁一定要權威判斷: 已登入的人要被導去 /gyms, 而壞掉的 cookie 若被樂觀放行,
  // 登入頁會把他導去 /gyms、那頁又把他導回 /login —— 兩頁之間彈跳 (前科)。
  if (pathname === "/login" || pathname === "/register") return "authoritative";

  const exp = readSessionExpiry(cookies);
  if (exp === null) return "authoritative";
  if (exp - nowMs / 1000 <= REFRESH_MARGIN_S) return "authoritative";
  return "optimistic";
}
