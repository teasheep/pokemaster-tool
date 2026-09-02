# 參與開發

歡迎 issue 與 PR。這份文件只寫「你需要知道才不會白做工」的部分。

## 動手之前：先讀 AGENTS.md

[`AGENTS.md`](AGENTS.md) 是這個 repo 的硬性慣例。它不是風格指南 ——
**裡面每一條都是踩過才寫的**，違反了就是 bug，而且多半是那種「本機看不出來、線上才炸」的 bug。

幾條最容易誤觸的：

- **不要新增分頁。** 資訊架構是使用者指定的（頂部兩個分頁 + 我的資源，道館底下三個）。
  想加東西先問「現有哪一頁的職責涵蓋它」。
- **同一件事只能有一條路徑。** 有前科：隊伍庫被收進看板側板，結果分頁消失、看板裡的連結指向轉導頁。
- **讀 Supabase 全量資料一定要分頁。** PostgREST 一次最多回 1000 列，超過會**靜默截斷**成「剛好 1000 列」
  而不報錯。用 `fetchAll` / `fetchAllRows`，而且要有穩定排序。
- **使用者看得到的值一律繁體中文。** 資料層的英文值顯示前必須過對照表。

## 環境

Node.js 22+、一個 Supabase 專案。設定步驟見 [README](README.md#開始開發)。

## 送 PR 之前

```bash
npx tsc --noEmit
npm run lint
npm test
```

CI 會跑同樣三項。PR 不會觸發部署 —— 部署只在推 `v*` tag 時發生。

## Commit 訊息

用 [Conventional Commits](https://www.conventionalcommits.org/zh-hant/)：
`feat:` `fix:` `perf:` `refactor:` `docs:` `chore:`。

內文請寫**為什麼**，不要只寫做了什麼 —— diff 本身已經說了做了什麼。
如果這個改動是因為踩到某個坑，把那個坑寫進去（並考慮同時補一條進 `AGENTS.md`）。
這個 repo 的 commit 訊息偏長，那是刻意的：三個月後回來看，你會慶幸當時寫了。

## 改到資料管線

`scripts/` 底下的 10 個階段有順序相依，全部寫在 [`scripts/update-catalog.mjs`](scripts/update-catalog.mjs)
的註解裡。**改比對邏輯前先讀 [`AGENTS.md`](AGENTS.md) 的「資料管線」那一節** ——
名稱比對的地雷（變體拍組撞名、劇情版同名、化名角色、形態修飾詞前後都可能出現）
每一條都害過一次資料，防護已經內建，不要繞過去。

管線全部冪等，可以重跑。

## 改到權限

任何 `security definer` 函式都要問「PostgREST 會不會把它當 RPC 曝出來」。
Postgres 對函式的 EXECUTE **預設 grant 給 PUBLIC**，而 Supabase 另外明授給 `anon` / `authenticated`
—— 只寫 `revoke ... from public` 是**無效的**，必須三個角色都收。

## 回報安全性問題

**不要開公開 issue。** 見 [SECURITY.md](SECURITY.md)。
