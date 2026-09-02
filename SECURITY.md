# 安全性政策

## 回報漏洞

**不要開公開 issue。** 請走 GitHub 的
[Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
（repo 的 Security 分頁 → Report a vulnerability）。

這個站有真實使用者的資料（道館成員的遊戲名、社群名、收藏內容），
在修好之前公開細節會直接傷到他們。

回報時請包含：重現步驟、影響範圍、以及你認為誰會受影響。
我會在合理時間內回覆並在修好後說明處理方式。

## 支援的版本

只維護線上跑的那一版（`main` 的最新 tag）。舊 tag 不回補。

## 這個專案的安全模型

寫在這裡是為了讓回報者知道哪些是**已知且刻意**的設計：

- **權限一律走 Postgres RLS**，不靠應用層判斷。`getSessionUser()` 是權威驗證，
  middleware 只做提前攔截 —— 頁面不信任 middleware 傳下來的身分
  （Next.js 出過 CVE-2025-29927，特製標頭可整個略過 middleware）。
- **Session cookie 是 `httpOnly: false`**（Supabase 的 browser client 需要讀它），
  而本站刻意沒有 `script-src` CSP。任何在本站執行的 script 都讀得走 session ——
  所以第三方 script 只有 Google Identity Services 一支，且只在 `/login` 載入。
- **網址本身就是祕密的兩條路徑**：`/share/<token>` 與 `/api/export?key=`。
  兩者都送 `Referrer-Policy: no-referrer` 或 `strict-origin-when-cross-origin` 並標 `noindex`。
- **`/api/export` 不輸出 email 或 auth uid**，範圍是金鑰持有人自己加入的道館。
- **`security definer` 函式的 EXECUTE 一律收到 `public, anon, authenticated` 三個角色**
  —— Postgres 預設 grant 給 PUBLIC，Supabase 另外明授給 anon/authenticated，
  只 revoke public 是無效的。
- **未公布的遊戲拍組不對外送**。過濾點只有一個（`loadPairsForClient()`），
  因為靜態資產由 Workers Assets 直送、不經過 Worker，登入檢查對它們無效。

## 不算漏洞的

- 拍組圖鑑不用登入就能看 —— 那是刻意的公開資料。
- Supabase anon key 出現在瀏覽器 —— 它本來就是公開的，權限由 RLS 決定。
- Google OAuth client ID 出現在頁面原始碼 —— 同上，它不是祕密。
