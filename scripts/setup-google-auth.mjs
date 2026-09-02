#!/usr/bin/env node
/**
 * 啟用 Supabase 的 Google OAuth (Management API)。
 * 前置: .env.local 加兩行 (值來自 Google Cloud Console 的 OAuth 用戶端):
 *   GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
 *   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
 * 用法: node scripts/setup-google-auth.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const token = env.SUPABASE_ACCESS_TOKEN;
const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
const secret = env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!token) {
  console.error("缺 SUPABASE_ACCESS_TOKEN (.env.local)");
  process.exit(1);
}
if (!clientId || !secret) {
  console.error("缺 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (.env.local)");
  console.error("\nGoogle Cloud Console 設定值:");
  // 「授權的 JavaScript 來源」是 **Google One Tap 的硬需求** (signInWithOAuth 的轉導流程只看
  // 重新導向 URI, 所以這一欄很可能還是空的)。少了對應的 origin, One Tap 就是**完全不顯示**,
  // 只有 console 一行 [GSI_LOGGER] The given origin is not allowed for the given client ID,
  // 畫面上零徵兆。本機開發也要加, 不然只有線上會動。
  console.error("  授權的 JavaScript 來源: https://pokemaster-tool.com");
  console.error("                          http://localhost:3030   (本機開發, One Tap 需要)");
  console.error(`  授權的重新導向 URI:   https://${ref}.supabase.co/auth/v1/callback`);
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: secret,
  }),
});
if (!res.ok) {
  console.error("設定失敗:", res.status, await res.text());
  process.exit(1);
}
console.log("✅ Google 登入已啟用 (Supabase auth config)");
console.log("驗證: 到 /login 點「使用 Google 登入」");
