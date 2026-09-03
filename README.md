<div align="center">

# 教練休息室 · pokemaster-tool

**Pokémon Masters EX 道館戰協作工具**

挑戰券、出刀紀錄、拍組持有度 —— 全館同一個地方，即時同步。

[![CI](https://img.shields.io/badge/CI-tsc%20%C2%B7%20lint%20%C2%B7%20vitest-2ea44f)](.github/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E)](https://supabase.com/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[線上站台](https://pokemaster-tool.com) · [開發藍圖](ROADMAP.md) · [更新日誌](CHANGELOG.md)

</div>

> **English summary** — A collaboration tool for *Pokémon Masters EX* gym battles, built for a 20-person
> Taiwanese guild and open to any guild. Tracks per-member sync-pair ownership, challenge-ticket budgets
> and battle logs, synced live across members. Next.js 16 on Cloudflare Workers, Supabase Postgres with
> row-level security. UI and code comments are in Traditional Chinese — that is deliberate: the users are
> Taiwanese players, and the domain vocabulary (拍組 / 挑戰券 / 出刀) has no natural English equivalent.

---

## 這個工具在解決什麼

道館戰期間，一場賽事有 8 個關卡、每人 30 張挑戰券，20 個人要協調誰打哪一關、還剩幾張券。
原本的做法是 LINE 群開一串，管理員一個一個 `@` 人問「你還剩幾張」，然後手動抄進 Google 試算表。

這個工具把那件事變成：**出刀時在看板上點一下，券自動扣，所有人即時看到。**

| | |
| --- | --- |
| **道館戰看板** | 每關每輪誰挑戰過、用掉幾張券；直接在看板登記（主力／補刀／降抗），自動扣券 |
| **挑戰券** | 每人「剩餘 / 上限」即時同步（Supabase Realtime），不用翻聊天紀錄對帳 |
| **成員與拍組** | 全館持有率、★ 重點名單、每位成員的練度，成員自己維護 |
| **隊伍庫** | 每個屬性用哪三隻，看板選隊直接吃同一份 |
| **拍組圖鑑** | 664 組拍組，**不用登入就能逛**；登入後按屬性一鍵點亮持有 |
| **資料連線** | `/api/export` 唯讀金鑰，讓外部 AI 助理讀自己的收藏 |

---

## 技術面值得一看的地方

這個專案有幾個決策是量測出來的，不是憑感覺選的：

**多來源交叉驗證的資料管線** — 遊戲沒有官方 API。拍組資料由四個來源交叉比對產生：
datamine（權威，決定有哪些拍組與 ID）、pomatools（日期／徽章／系列）、Fandom Wiki（6★EX／EX role）、
Serebii（太晶化／超覺醒）。每筆記錄帶 `verifiedSources` 標記誰證實過它，矛盾欄位會另外列進報告。
全管線冪等可重跑，10 個階段的順序相依都寫在 [`scripts/update-catalog.mjs`](scripts/update-catalog.mjs) 的註解裡。

**「尚未公布的拍組不對外送」的單一收口** — datamine 會比官方早幾週撈到未發表的拍組。
過濾點只有一個函式（`loadPairsForClient()`），因為頁面 SSR、API、建置時產的靜態檔全部經過它；
判準是兩條 OR（無來源且無日期 **或** 上架日還沒到），兩條都有[迴歸測試](tests/unreleased-pairs.test.ts)守著。
第二條是實際外洩過才補上的 —— 詳見 [CHANGELOG](CHANGELOG.md) 的 `1.1.0`。

**效能是量出來的** — Cloudflare Workers 免費方案每請求 CPU 上限 10 ms，而本站中位數是 286 ms。
處理的結果：
「全圖鑑」從每次 45–65 ms CPU 的 API 改成 0 CPU 的指紋化靜態資產、
一個 IntersectionObserver 服務整面卡牆的延遲載圖（981 個請求 / 14.7 MB → 手機 93 個 / 1.04 MB）、
部署 payload 從 109 MB 降到 5 MB。也記了**失敗的假設**：接自訂網域並沒有像推論的那樣改善 colo 路由。

**RLS policy 的 34 倍** — `member_pairs` 的逐列相關子查詢讓 2,055 列查詢跑 30 ms / 2,107 buffers；
改寫成不相關子查詢後是 0.88 ms / 53 buffers。同一份文件算過：這一條 policy 在 2 萬 MAU 時值 92 美元/月，
比三家平台的最大價差還大一倍。

**踩過的坑都寫下來了** — [`AGENTS.md`](AGENTS.md) 是這個 repo 的行為守則，
每一條規則後面都附「為什麼」與前科（PostgREST 1000 列靜默截斷、
`security definer` 函式的 EXECUTE 預設 grant 給 PUBLIC、`redirect()` + `loading.tsx` 的串流陷阱…）。

---

## 技術棧

| 層 | 選擇 |
| --- | --- |
| 框架 | Next.js 16 App Router · React 19 · TypeScript |
| 樣式 | Tailwind CSS v4 · shadcn/ui |
| 資料 | Supabase — Postgres + Auth + Realtime，權限一律走 RLS |
| 託管 | Cloudflare Workers（`@opennextjs/cloudflare`）+ Workers Assets |
| 登入 | Google OAuth（`signInWithOAuth`）+ Google One Tap（`signInWithIdToken`） |
| 測試 | Vitest |

---

## 開始開發

需要 Node.js 22+ 與一個 Supabase 專案。

```bash
git clone git@github.com:teasheep/pokemaster-tool.git
cd pokemaster-tool
npm install
cp .env.local.example .env.local   # 填入下面那四個值
node scripts/setup-supabase.mjs    # 套用 supabase/migrations/*.sql（冪等）
npm run data:update                # 產生拍組 catalog 與圖檔（約 10 分鐘）
npm run dev                        # http://localhost:3030
```

`.env.local` 需要的值：

| 變數 | 從哪拿 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上（只有 `/api/export` 用得到） |
| `DATABASE_URL` | Supabase → Database（只有 migration 腳本用） |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials |

Google 登入還需要在 Cloud Console 的 **「已授權的 JavaScript 來源」** 加上你的網域與
`http://localhost:3030`（漏了的話 One Tap 會**完全不顯示且沒有任何錯誤訊息**）。
`node scripts/setup-google-auth.mjs` 會把 Supabase 那端設好。

### 常用指令

```bash
npm run dev            # 開發伺服器 (port 3030)
npm test               # vitest
npx tsc --noEmit       # 型別檢查
npm run lint           # ESLint
npm run data:update    # 更新拍組 catalog（新拍組推出時跑）
npm run deploy:cf      # 建置 + 部署到 Cloudflare
```

### 部署

推一個 `v*` tag 就會部署（見 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）：

```bash
git tag v1.2.0 && git push origin v1.2.0
```

push 到 `main` 只跑檢查，不會動到線上。

---

## 專案結構

```
src/
  app/            Next.js App Router — 頁面與 API route
  components/     共用元件（卡片、側板、看板…）
  lib/
    pairs/        拍組 catalog 的載入、投影、篩選（loadPairsForClient 是對外的唯一收口）
    gym/          道館領域邏輯（挑戰券、對戰紀錄、隊伍）
    supabase/     client / server / middleware 三種 client
  data/           產生出來的 catalog 與交叉驗證報告
scripts/          資料管線（10 個階段，冪等可重跑）+ 部署 + migration
supabase/migrations/   依序編號的 SQL，由 setup-supabase.mjs 直接對雲端套用
AGENTS.md         這個 repo 的硬性慣例與踩過的坑
```

---

## 遊戲素材與資料

本專案是**非官方第三方工具**，與 The Pokémon Company / DeNA / Nintendo / Game Freak 無關。

拍組名稱、屬性、立繪等遊戲資料與素材的權利屬於原權利人，本專案僅為與遊戲互通而引用。
版控中**只保留網站實際供應的 WebP**；PNG 原檔與影像 embedding 是由 `npm run data:update`
從公開來源重新產生的衍生檔，不進版控（見 [`.gitignore`](.gitignore)）。

本專案自己的程式碼採 [MIT](LICENSE)；素材與資料的權利歸屬見 [NOTICE](NOTICE)。

---

## 參與

歡迎 issue 與 PR，請先讀 [CONTRIBUTING.md](CONTRIBUTING.md)。
安全性問題請走 [SECURITY.md](SECURITY.md) 的私下回報流程，不要開公開 issue。
