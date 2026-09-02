/**
 * Google One Tap 用的 nonce —— **兩個值不能給反**。
 *
 *   hashed → Google (`google.accounts.id.initialize({ nonce })`)
 *   raw    → Supabase (`supabase.auth.signInWithIdToken({ nonce })`)
 *
 * Google 會把我們給它的字串原封不動放進 ID token 的 `nonce` claim; Supabase (gotrue)
 * 收到 token 後算 `sha256(傳進來的 nonce)` 再跟 claim 比對 ——
 * 所以「先雜湊的那份給 Google, 原文那份給 Supabase」。給反了會拿到 401 `Nonces mismatch`,
 * 這是社群最常踩的一個坑 (Supabase 官方文件的 Google One Tap 段落就是這樣寫的)。
 *
 * 編碼格式不能自己挑: gotrue 的實作是
 *   `hash := fmt.Sprintf("%x", sha256.Sum256([]byte(params.Nonce)))`
 * `%x` = **小寫十六進位字串**, 不是 base64 也不是 base64url。
 *
 * 另外 gotrue 要求「兩邊都給或兩邊都不給」—— 只給一邊會拿到
 * 「Passed nonce and nonce in id_token should either both be empty or both be provided」。
 * 所以呼叫端拿到這個物件之後, 兩個欄位都一定要用上。
 *
 * 用 Web Crypto 而不是 node:crypto: 這支會被 client component 匯入, 而 `crypto.subtle`
 * 在瀏覽器與 Node 18+ 都是全域可用的 (測試在 node 環境跑也一樣)。
 */

/** SHA-256 → 小寫 hex (gotrue 的 `%x` 格式) */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 產一組 One Tap 用的 nonce。
 * 每次登入嘗試都要重產 (nonce 的意義就是一次性), 不要快取。
 */
export async function generateOneTapNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  // base64 只是為了讓它是可放進 URL/JSON 的純文字, 值本身是那 32 bytes 的隨機性
  const raw = btoa(String.fromCharCode(...bytes));
  return { raw, hashed: await sha256Hex(raw) };
}
