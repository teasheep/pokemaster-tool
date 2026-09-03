# 更新日誌

本檔遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號採 [語意化版本](https://semver.org/lang/zh-TW/)。

發布方式：推一個 `v*` tag，GitHub Actions 才會部署到線上。push 到 `main` 只跑檢查。

## [未發布]

預計要做的事見 [ROADMAP.md](ROADMAP.md)。

---

## [1.1.0] — 2026-09-02

網域搬遷、Google 登入合規化、首頁重做。

### 新增

- **自訂網域 `pokemaster-tool.com`** 取代 `*.workers.dev`。Worker Custom Domain 由
  `wrangler.jsonc` 宣告（`custom_domain: true`），同時 `workers_dev: false` 關掉舊入口。
- **Google One Tap** 登入（`signInWithIdToken`），**沒登入時全站都有**（`GoogleOneTapSlot` 掛在
  root layout）。已登入者整個不渲染，連 GIS script 都不載。
  代價是知情接受的：GIS script 的載入本身就是一個帶 Google cookie 的請求，每頁都掛等於每頁都把
  「有人來過」告訴 Google；而使用者關掉 One Tap 會讓瀏覽器對整站進入 FedCM embargo。
- **首頁的看板縮影** — 取代原本三段功能介紹文字。全館拍組持有（20 人中幾人有）與道館戰
  （誰還剩幾張券）兩塊輪替，正好對上標題那句「拍組、道館戰分配」的兩件事。
  兩塊一直都掛著、只是輪流淡入，所以切換時版面不動；點圓點就停止自動輪替。
  `prefers-reduced-motion` 照樣輪，只是換場不淡入不上浮 —— 那個偏好要擋的是會動的東西，
  換一塊內容本身不是動態，整個停掉等於讓人少看到一半的內容。
- **首頁看得出是哪一款遊戲**：拍組看板每一列的圖是**一組拍組**（訓練家立繪當本體、寶可夢壓右下角，
  官方卡面的排法），道館戰看板的示範成員用他們自己的訓練家立繪當頭貼。
  背後再擺七張**真的 `SyncPairCard`**（站內 /pairs 同一個元件、同一份 catalog 紀錄），
  各自有遠近（scale／透明度／景深模糊）、各自慢慢浮動，**滑鼠一動整個空間跟著微微轉** ——
  近的卡位移大、遠的小，那個差就是空間感。中央挖空，字與 CTA 上面永遠不會有東西。
  進場時文案 → 看板 → CTA 依序淡入上浮，長條從 0 掃到實際值。
  `prefers-reduced-motion` 分兩種處理：自己會動的（呼吸、滑入的位移）關掉或換成純淡入，
  但**跟著指標走的視差照做、幅度砍半** —— 那是直接操作不是自動播放，規範叫 reduced 不是 removed。
  手機/觸控整層不掛載（一張圖都不會下載）。
  只吃既有的 WebP：手機 14 張 / 75KB，桌機 42 張 / 179KB。
- **首頁拍組看板列的是最新上架的五組 5★**（吃 catalog，會自己跟著改版更新），持有人數隨機。
  4★ 不列 —— 每一波改版 5★ 與 4★ 一起上，不濾的話首頁一半是 4★。
- 登入後導向的閘門抽成 `lib/auth/post-login-destination.ts`，由 `/auth/callback` 與
  新的 `/auth/one-tap` Route Handler 共用。

### 變更

- **登入按鈕改為符合 Google 官方品牌規範**：官方漸層版 super G（取自官方素材包）、
  Google Sans Medium（`next/font/google` 自我託管）、官方尺寸與雙主題配色、
  官方繁中字串「使用 Google 帳戶登入」。規範原文寫明「遵守本指南是 app verification 的條件」。
  刻意**不用** `google.accounts.id.renderButton()` —— 它是 `accounts.google.com` 的 iframe，
  GIS 被擋（Brave Shields、擋腳本的擴充）時整個登入入口會消失。
- **首頁只服務訪客**：已登入者一律直接進 `/gyms`（那頁本來就有「建立／加入道館」的空狀態），
  順帶省掉一次跨太平洋的 gyms count 查詢。CTA 從兩顆（都連 `/login`）收成一顆。
- 手機版 header 只剩「品牌｜頭像」，主題切換移進頭像選單。
- **右上角的「登入」鈕在首頁與登入頁不再渲染**：這兩頁畫面裡已經有一顆真的 Google 按鈕，
  再放一顆等於同一個動作兩個入口、而且兩顆長得不一樣。其他訪客看得到的頁（`/pairs`、分享頁）
  一定要留著 —— One Tap 偵測不到有沒有跳出來，那顆是唯一的保底入口。
- 已登入者打 `/login` 的落點由 `/pairs` 改為 `/gyms`，與 `safeNextPath` 的預設值對齊。

### 修正

- **未公布拍組外洩**（安全性）。Fandom roster 會收錄 datamine 先行列，reconcile 因此給了它們
  `verifiedSources: ["wiki"]`，原本「無來源且無上架日」的判準一筆都擋不到 ——
  7 筆官方尚未公布的拍組進了對外的 catalog 靜態檔，而該檔由 Workers Assets 直送、
  訪客不用登入就抓得到。判準補上第二條：上架日晚於今天（台北）也擋。
- wiki 上架日的比對改走 `pomaPairId` by-id join。原本純名稱比對對不上帶形態後綴的列
  （wiki 的 `Palkia (Origin Forme)` vs datamine 的 `Palkia`），6 筆拍組因此沒有上架日。
- 4 筆已上市的大師／EX 大師拍組因 pomatools 未收錄而 `pairKind = "none"`，
  卡片沒有大師徽章、系列篩選按哪個 chip 都找不到。
- `update-catalog` 的變動追蹤欄位從 13 個補到 20 個。`releaseDate` / `series` / `pairKind` /
  `hasAwakening` 原本都不在名單裡，那幾欄的靜默退化永遠不會被印進報告。

### 資料

- 新增 19 組拍組（含銀河隊三幹部、2026 週年慶青綠／莎莉娜、冠軍小光／明輝）。
- 補收「主角 & 毒貝比」。主角拍組清單是手寫的，每年 8/28 多一隻就會落後；
  現在會拿 datamine 的數量對照並警告。

---

## [1.0.0] — 2026-08-21

第一個穩定版本：資訊架構收斂完成，安全性與效能的實測整批處理完。

### 新增

- **道館戰看板**：每關每輪的出刀登記（主力／補刀／降抗），自動扣挑戰券。
- **挑戰券**「剩餘 / 上限」制（預設 30/30），寫入一律走 `adjust_member_ticket` 原子 RPC。
- **賽事狀態由賽期日期推導**（台北時區），沒有手動狀態下拉。
- **隊伍庫**：每個屬性用哪三隻，看板選隊吃同一份。
- **資料連線** `/api/export`：唯讀金鑰跟著人走，範圍是這個人加入的每一個道館 + 自己的收藏。
- **分享連結** `/share/<token>`：把收藏分享給沒有帳號的人。

### 變更

- **資訊架構收斂**成頂部兩個分頁（拍組／道館）+ 我的資源；道館底下三個分頁。
  移除沒有分頁的「道館總覽」孤兒頁，內容拆回各頁。
- **權限模型**改為 管理員／成員／顧問，移除「館主」概念（`gyms.owner_id` 已刪）。
  最後一位管理員動不了（DB trigger 保護）。
- **練度欄位只留遊戲裡真的有的**：寶數與超覺醒合併成 0–10 的單一軸。
- 加入道館只填邀請碼，名字跟人走（存在 profiles）。

### 效能

- 「全圖鑑」從每次重算的 API route 改成指紋化的靜態資產，該路徑變成 0 CPU
  （Workers Assets 直送，Worker 不執行）。
- 卡片重圖延遲載入：一個 root 共用一顆 IntersectionObserver。
  /pairs 全圖鑑實測 981 個請求 / 14.7 MB → 桌機 208 個 / 2.75 MB、手機 93 個 / 1.04 MB。
- 圖片全面轉 WebP，部署 payload 6573 檔 / 109.68 MB → 1053 檔 / 5.08 MB。
- 等待畫面全部改成與真實版面同構的骨架。

### 安全性

- 收回 `log_activity` 等 `security definer` 函式的公開 EXECUTE。
  Postgres 對函式的 EXECUTE 預設 grant 給 PUBLIC，而 Supabase 另外明授給 `anon`/`authenticated`
  —— 只寫 `revoke ... from public` 是無效的。
- 修掉 PostgREST「一次最多 1000 列」的三處靜默截斷（跨賽事查詢、單場對戰紀錄、`/api/export`）。
  實測推算：20 人辦到第 4 場就會少算約 330 張券，而且不會報錯。
- 安全標頭改寫在 `next.config.ts` 的 `headers()`（`public/_headers` 只作用在靜態資產命中的回應）。

---

## [0.1.0] — 2026-08-11

初版。原本的目標是「上傳遊戲截圖自動辨識拍組」（DINOv2 embedding 兩階段比對），
2026-08 中轉向道館賽協作功能，辨識管線暫緩但程式碼保留。

[未發布]: https://github.com/teasheep/pokemaster-tool/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/teasheep/pokemaster-tool/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/teasheep/pokemaster-tool/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/teasheep/pokemaster-tool/releases/tag/v0.1.0
