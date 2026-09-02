# DevOps 決策筆記

> 這份文件是**給自己看的工程筆記**, 不是給使用者的說明, 也不是教學文。
> 目的是把「線上跑在哪、貴在哪、被鎖在哪、什麼時候該動」一次寫清楚, 之後回來查不用重推一遍。
>
> **最後更新**: 2026-08-21 · **對應 commit**: `03dd1c4` (§8 的改動已全部提交; migration 0050-0053 已套用到正式庫)
>
> **數字標記約定** —— 每個數字都標來源, 不要混:
> - 【實測】= 對線上環境或線上正式庫量過的, 有輸出可複現
> - 【估算】= 模型算出來的, 算式與假設都寫在旁邊, 參數可以自己調
> - 【推論】= 有根據但**沒驗證**, 標出來就是提醒不要當結論用
> - 【外部】= Cloudflare / Supabase / Zeabur 官方文件或價目表的說法, 會過期
>
> **怎麼讀**: §0 是一頁式現況; 有空再往下看。§10 是操作手冊 (指令可直接複製)。

---

## 目錄

| § | 標題 | 什麼時候看 |
|---|---|---|
| 0 | 現在該做什麼 (一頁式) | 每次回來先看這個 |
| 1 | 現況快照 | 想知道「線上到底長怎樣」 |
| 2 | 最貴的一條: RLS policy 的 34 倍 | 想省錢的時候 |
| 3 | 三個效能瓶頸 (CPU / colo / 往返) | 站台變慢、有人回報卡 |
| 4 | 平台比較與成本模型 | 想換平台、想估未來帳單 |
| 5 | 鎖定風險與搬家成本 | 擔心「被綁死」的時候 |
| 6 | 圖片辨識後端要放哪 | 要重啟辨識功能時 |
| 7 | 階段式路線圖 (訊號驅動) | 使用者數變了、有陌生人來了 |
| 8 | 已經做了什麼 | 想知道現況是怎麼來的 |
| 9 | 待辦池 (有訊號才做) | 找事做 / 排優先序 |
| 10 | 操作手冊 | 手放在鍵盤上的時候 |
| 11 | 不確定清單 | 引用本文的數字之前 |

---

## §0 現在該做什麼 (一頁式)

按「現在就在傷害使用者」→「還沒發生但便宜」排序。**沒有一條需要換平台。**

| # | 動作 | 為什麼是現在 | 成本 | 詳見 |
|---|---|---|---|---|
| 1 | ~~**升 Workers Paid ($5/月)**~~ **✅ 2026-09-02 已升** | 【實測】CPU 中位 286ms, 免費方案上限 10ms/請求, wrangler tail 對 20 個並行請求抓到 5 筆 `outcome=exceededCpu` (使用者看到 Error 1102 白頁)。付費後上限 30 秒。 | $5/月 | §3.1 |
| 2 | ~~**套 0050–0053 四支 migration**~~ **✅ 已套用** (線上 `_migrations` 查證到 0053) | `log_activity` 的 EXECUTE 曾經 anon 叫得動 = 繞過 RLS 的任意寫入原語。 | 0 元 | §8, §10.2 |
| 3 | ~~**接自訂網域**~~ **✅ 2026-09-02 完成** (pokemaster-tool.com) | 原本的理由是「可能換回 TPE, 砍掉 ~400ms 地板」—— **實測否證了** (§3.2), colo 仍是 SJC。仍然換到: zone 的快取清除能力、單一入口、正式網址。 | 網域費 | §3.2 |
| 4 | **改寫 `member_pairs` 的 RLS policy** | 【實測】2,055 列查詢 30.0ms / 2,107 buffers → 改寫後 0.88ms / 53 buffers, **34 倍**。今天是「頁面慢一點」, 到 2 萬 MAU 時這一條值 **$92/月** —— 比三家平台的最大價差 ($48.76) 還大一倍。 | 一支 migration | §2 |
| 5 | **第 3 個道館出現前先有隱私政策** | 第一個「不是朋友」的人註冊那一刻, 個資法的個人／家庭活動豁免消失。**這是法務問題不是工程問題**, 而且是唯一一條「工程做得再好也擋不住」的風險。 | 半天 | §7 階段 1 |

**不用做的事** (常見的誤判, 先寫在這裡省得每次重想):

- ❌ 換掉 Cloudflare —— 每個階段 Supabase 都是應用託管的 **5–9 倍**費用 (§4.3), 換託管省的錢永遠小於 Supabase 升級一階。
- ❌ 現在就重構成「可搬」—— 【實測】production 相依 **0 個** Cloudflare 套件, 搬家 0.5–1 人日**且與規模無關** (§5)。晚點搬不會變貴, 提早抽象只會變複雜。
- ❌ 為了辨識功能換平台 —— Workers 跑不了辨識, 但 **Cloudflare Containers 可以**, 而且在免費額度內邊際成本 US$0 (§6)。

---

## §1 現況快照

```
   使用者 (台灣, 20 人)
        │  HTTPS
        ▼
  ┌─────────────────────────────────────────────┐
  │ Cloudflare 邊緣                              │
  │  【實測】colo=SJC (加州) ← workers.dev 子網域 │
  │                                              │
  │  ├─ 靜態資產命中 → ASSET_WORKER (0 CPU)      │
  │  │    /_next/static/*  immutable 1 年        │
  │  │    /catalog/<指紋>.json  immutable 1 年   │
  │  │    /reference/*  30 天 (刻意不 immutable) │
  │  │    ↑ public/_headers 管這一半              │
  │  │                                            │
  │  └─ 沒命中 → USER_WORKER (.open-next/worker.js)
  │       Next.js 16 App Router / OpenNext        │
  │       【實測】CPU 中位 286ms                   │
  │       安全標頭走 next.config.ts headers()      │
  └──────────────────┬──────────────────────────┘
                     │ PostgREST over HTTPS
                     │ 【實測】每趟往返 150–270ms (跨太平洋)
                     ▼
             Supabase (aws-1-ap-southeast-1, 新加坡)
             Postgres + RLS + Auth + Storage(avatars)
```

### 1.1 基本事實

| 項目 | 值 | 來源 |
|---|---|---|
| 線上網址 | `https://pokemaster-tool.com` | — |
| 執行環境 | Cloudflare Workers + Workers Assets, adapter = `@opennextjs/cloudflare` ^1.20.2 | `wrangler.jsonc` / `open-next.config.ts` |
| Worker 名稱 | `pm-gym` | `wrangler.jsonc` |
| 相容性日期 | `2025-05-05`, flags `["nodejs_compat"]` | `wrangler.jsonc` |
| 框架 | Next.js ^16.3.0 App Router / React 19.2.4 | `package.json` |
| 資料庫 | Supabase, **新加坡** `aws-1-ap-southeast-1` | `.env.local` 的 DATABASE_URL |
| 快取層 | **沒有** —— 沒接 R2/KV, 頁面全動態 | `open-next.config.ts` 註解 |
| 觀測 | `observability.enabled = true` (Workers Logs) | `wrangler.jsonc` |
| 使用者 | 1 個道館 / 21 筆名冊 / 20 位真人 | 【實測】線上唯讀 SELECT |
| 資料量 | `member_pairs` 2,055 列 · `battle_logs` 290 列 · `gym_activity` 35 列 | 【實測】同上 |
| 程式規模 | `src/` 20,746 行 (.ts/.tsx) | `wc -l` |

### 1.2 效能地板 (全部【實測】, 2026-08-21)

| 指標 | 值 | 註 |
|---|---|---|
| Worker CPU 中位 | **286 ms** | 免費方案上限是 10ms/請求 → §3.1 |
| 20 並行的失敗數 | **5 / 20 筆 `exceededCpu`** | wrangler tail 觀察, 使用者看到 Error 1102 |
| colo (workers.dev 時期) | **SJC** (加州) | connect 132ms / TLS 270ms |
| colo (自訂網域, 2026-09-02) | **SJC** —— 沒變 | connect 127ms / TLS 262ms → 見 §3.2 |
| 同一條線路的 cloudflare.com | **TPE** (台北) | connect 7ms —— 差 19 倍, 不是網路的問題 |
| 靜態檔 `CF-Cache-Status: HIT` 的 TTFB | **426 ms** | 邊緣快取命中、Worker 完全沒執行, 還要 426ms → **這是本站的地板** |
| Worker → Supabase 單趟往返 | **150–270 ms** | 見 `src/lib/supabase/fetch-all.ts` 檔頭 |

> **這三個數字要一起看**: 426ms 的地板 + 286ms 的 CPU + 每次查資料 150–270ms 的往返。
> 「頁面感覺慢」不是單一原因, 是這三層疊起來的; 而且**第一層 (426ms) 完全不是程式寫得好不好的問題**。

---

## §2 最貴的一條: RLS policy 的 34 倍

**如果這份文件只有一段值得記住, 是這一段。**

### 2.1 現象

【實測】對線上正式庫讀 `member_pairs` (2,055 列):

| | 耗時 | shared buffers |
|---|---|---|
| 現行 policy | **30.0 ms** | **2,107** |
| 改寫後 | **0.88 ms** | **53** |
| 倍數 | **34×** | **40×** |

### 2.2 原因

`supabase/migrations/0005_gyms.sql:381`:

```sql
create policy "member_pairs_select" on public.member_pairs
  for select using (public.is_gym_member(gym_id));
```

`is_gym_member(p_gym uuid)` 是 `security definer` 函式, 內容是 `exists (select 1 from gym_members where gym_id = p_gym and user_id = auth.uid())`。

問題在於**它吃了 `gym_id` 這個逐列變動的參數** → Postgres 無法把它提出迴圈外, 只能**每一列各呼叫一次**。
2,055 列 = 2,055 次函式呼叫 + 2,055 次 `gym_members` 查表, 於是 buffers 從 53 膨脹到 2,107。

`auth.uid()` 沒有包在 `(select ...)` 裡也是同一類問題 (Supabase 官方 RLS 效能指南點名的第一條)。

### 2.3 修法

把「逐列相關」改成「整批不相關」—— 先算出「我在哪些道館」這一個集合, 再拿它比對:

```sql
-- 概念 (實際 migration 要對每張表/每個動作各寫一次, 並保留 admin/self 的分支)
create policy "member_pairs_select" on public.member_pairs
  for select using (
    gym_id in (
      select gym_id from public.gym_members
      where user_id = (select auth.uid())     -- 包 select = 只求值一次
    )
  );
```

要點:
- `(select auth.uid())` 讓 planner 把它當 **InitPlan** 求值一次, 而不是每列一次。
- `gym_id in (select ...)` 是**不相關子查詢**, 整個集合算一次然後做 semi-join。
- 同一個病灶散在 `0005_gyms.sql` 的一整批 policy 裡 (`gyms` / `gym_members` / `gym_pairs` / `battle_logs` …), 但**只有列數大的那幾張表值得改** —— `member_pairs` (2,055) 是唯一已經痛的; `battle_logs` (290) 是下一個。
- ⚠ 改 policy 是安全邊界的改動, 必須逐條確認語意等價 (`is_gym_member` 在 0041 已經拿掉 owner 分支, 現在就只剩 `gym_members` 一條, 等價改寫是安全的)。改完要對「非成員讀不到」寫測試。

### 2.4 為什麼這是「花錢繞過一個 bug」

【估算】2 萬 MAU 時的月費拆解 (算式在 §4):

| | 不修 | 修了 |
|---|---|---|
| Cloudflare Workers | $15.84 | $15.84 |
| Supabase Pro 底價 | $25 | $25 |
| Supabase 運算加購 | **Large $110** | **Small $15** |
| 出站 / 儲存 | ~$6 | ~$6 |
| **合計** | **$156.84 ≈ $157/月** | **$61.84 ≈ $62/月** |
| **差額** | | **$95/月 (≈ NT$3,000)** |

> 差額寫成 **$92–95** 都對 —— 差別只在「修完之後掉到 Small 還是 Small 上面一點」。
> 本文其他地方用 **$92** 這個保守值。

推理: 40 倍的 buffers = 40 倍的 shared-buffer 流量, 直接決定「working set 塞不塞得進實例的 RAM」;
34 倍的 CPU 決定同一台機器能扛幾個並行查詢。這兩個一起變好 = **運算階梯可以往下掉好幾階**。

> 【估算】的部分是「Large vs Small」這個階梯落點 —— 真正該掉幾階要到那個量級再量。
> 但**方向與量級是實測撐起來的**: $92 比 Cloudflare 與 Zeabur 在 2 萬 MAU 的價差 ($48.76) 還大一倍。
>
> **結論的形狀**: 平台選擇能省的錢 < 一條 policy 能省的錢。先修 bug 再談換平台。

---

## §3 三個效能瓶頸

### 3.1 CPU 10ms 上限 (免費方案) —— 已經在壞

- 【外部】Cloudflare Workers **免費方案**: 每請求 CPU 時間上限 **10 ms**。超過 → 請求被殺, `outcome=exceededCpu`, 使用者看到 **Error 1102**。
- 【實測】本站 CPU **中位 286 ms**。也就是**中位數就超標 28 倍**。
- 【實測】wrangler tail 對 20 個並行請求 → **5 筆 exceededCpu**。

為什麼「中位超標 28 倍」卻只有 25% 失敗、不是 100%? —— 因為 CPU 時間的計費/計量會被邊緣的排程與快取命中稀釋 (靜態資產不經 Worker = 0 CPU)。**不要把 25% 當成安全邊際**, 它會隨並行度上升。

**動作**: 升 Workers Paid $5/月 → 【外部】上限變 **30 秒** CPU/請求, 並含 10M 請求 + 30M CPU-ms/月。
這一條沒有替代方案, 也不需要思考 —— 286ms 的中位不可能壓進 10ms。

**順帶**: 已經做過的 CPU 削減 (§8) 是有效的, `/api/catalog` 每次 45–65ms CPU → 改走 Workers Assets 靜態檔 = **0 CPU**。但那只是把「最貴的單一路徑」搬走, SSR 頁面本身的 286ms 動不了。

### 3.2 colo = SJC 【已驗證: 與 workers.dev 無關】

【實測】:

| 目標 | colo | connect | TLS |
|---|---|---|---|
| `pm-gym...workers.dev` | **SJC** (加州) | 132 ms | 270 ms |
| `cloudflare.com` (同一條線路, 同一時間) | **TPE** (台北) | 7 ms | — |

同一條網路、同一家 CDN, 一個走台北一個走加州 → **不是網路問題, 是路由問題**。
一個 `CF-Cache-Status: HIT` 的靜態檔 TTFB 仍然 **426ms**, 就是這個原因 (Worker 根本沒跑)。

**推論 (2026-08-21 提出)**: `*.workers.dev` 子網域不享有完整的 anycast 就近路由, 接上**自訂網域**後會回到 TPE。

> ## ❌ 2026-09-02 實測: 這個推論**不成立**
>
> 接上自訂網域 `pokemaster-tool.com` (Free 方案 zone, Worker Custom Domain) 後從同一條線路量:
>
> | 目標 | colo | connect | TLS | 靜態檔 HIT TTFB |
> |---|---|---|---|---|
> | workers.dev (舊基準) | SJC | 132 ms | 270 ms | 426 ms |
> | **pokemaster-tool.com** | **SJC** (連量 4 次全是) | **127–129 ms** | **262–270 ms** | **411–600 ms** |
>
> 兩者**在誤差內完全相同**。`/cdn-cgi/trace` 回 `colo=SJC / loc=TW` —— Cloudflare 認得出用戶端在台灣,
> 但仍然把它送到加州。
>
> **結論**: 426ms 的地板**不是** workers.dev 造成的, 換網域拿不回來。剩下的解釋是用戶端 ISP 到
> Cloudflare 的 peering/路由 (這條線路打 cloudflare.com 會到 TPE, 但那是 Cloudflare 自己的網域,
> 走的不是同一套 anycast 宣告)。**這條要重新開一輪調查, 不要再拿「接網域就會好」當前提。**
>
> 接網域**仍然值得** —— 只是理由要換成: 拿到 zone 才有的快取清除能力 (§8.3)、單一可控的入口、
> 以及 workers.dev 這種公共後綴之外的正式網址。**效能不在理由裡了。**

⚠ **這是推論不是結論**。Cloudflare 官方文件**沒有明講** colo 選擇與 workers.dev 子網域的關係。
但驗證成本近乎零: 接一個網域上去, 打一次 `/cdn-cgi/trace` 看 `colo=`, 30 秒就知道 (指令見 §10.4)。

**上限**: 如果推論成立, 砍掉的是 **~400ms 的每請求地板**, 對 20 個台灣使用者來說是全站最大的單一改善, 而且**一行程式碼都不用改**。
如果推論不成立, 損失是一個網域的年費, 而且仍然換到「可以清快取」這個能力 (§8 殘留風險)。

### 3.3 跨太平洋往返 (Worker SJC ↔ Supabase 新加坡)

【實測】每趟 150–270ms。這是**已經處理過的一條**, 記錄一下做法免得之後又踩:

`src/lib/supabase/fetch-all.ts` 的分頁改成**一批平行發 3 頁** (`FIRST_BATCH_PAGES = 3`), 只有「這批最後一頁還是滿的」才發下一批。
`member_pairs` 2,055 列 = 3 頁 → **從 3 趟序列往返變成 1 趟**, 省 300–540ms。
小表 (`gym_pairs` 144 列) 會多發 2 個回空陣列的請求, 但它們平行發不佔時間 —— 用 2 個空請求換一趟跨太平洋往返, 划算。

**還沒做的**: 把「賽事一覽」那種「拉全部列回來在 JS 裡數」改成資料庫端聚合 RPC (§9)。
那是同一個病灶的另一半 —— 分頁解決了「會不會少算」, 聚合才解決「要不要搬這麼多資料過太平洋」。

**如果 colo 推論成立**, 這條會**變糟**: Worker 從 SJC 移到 TPE, 但 Supabase 還在新加坡。
TPE↔SIN 大約是 40–70ms 【推論】, 仍然遠比 SJC↔SIN 好。不需要因此動 Supabase 區域。

---

## §4 平台比較與成本模型

### 4.1 模型與假設 (可以自己調參數)

三家全部用同一組假設算, 才比得出差別:

```
每個 MAU 每月產生:
  r = 100 個「動態請求」(會執行 Worker / 伺服器的那種, 不含靜態資產)
  c = 286 ms CPU / 請求        ← 【實測】本站 CPU 中位
  b = 21.5 MB 出站流量          ← 反推自「2 萬 MAU = 430GB」

於是:
  總請求  R   = MAU × 100
  總 CPU  CPU = MAU × 100 × 286 ms
  總出站  B   = MAU × 21.5 MB
```

> 想調參數就改 `r` / `c` / `b` 三個數。`c` 是唯一實測的, `r` 與 `b` 是拍的 ——
> `r = 100` 大約等於「每人每月開 100 次頁」, 對一個「打道館賽的時候才會用」的站算寬鬆。

**Cloudflare Workers Paid** 【外部, 價目表會變】:
```
$5/月 底價, 含 1,000 萬請求 + 3,000 萬 CPU-ms
超出: 請求 $0.30 / 百萬 · CPU $0.02 / 百萬 CPU-ms
靜態資產請求「free and unlimited」(官方原文) ← 本站 /_next/static、/catalog、/reference 全在這裡
```

**Zeabur** 【外部】:
```
$5/月 底價 + 常駐實例費用 + 出站 $0.10/GB
付費層不會 scale-to-zero (只有免費層休眠) ← 這條很重要, 見 4.4
```

### 4.2 結果

| MAU | Cloudflare | Zeabur | 差距來源 |
|---|---:|---:|---|
| 20 (現在) | **$5.00** | $5.44 | — |
| 200 | **$5.00** | $5.83 | — |
| 2,000 | **$5.54** | $15.10 | 出站流量開始咬人 |
| 20,000 | **$15.84** | $64.60 | **430GB × $0.10 = $43, 佔 Zeabur 帳單 67%** |

驗算 (Cloudflare, 2 萬 MAU):
```
R   = 20,000 × 100        = 200 萬請求          → 含在 1,000 萬內, $0
CPU = 200 萬 × 286ms      = 5.72 億 CPU-ms      → 超出 (572 - 30) = 542 百萬
超額費 = 542 × $0.02      = $10.84
合計 = $5.00 + $10.84     = $15.84  ✓
```
(2,000 MAU: CPU = 5,720 萬 → 超出 27.2 百萬 × $0.02 = **$0.54** → $5.54 ✓
 200 MAU: CPU = 572 萬 → 沒超過 3,000 萬 → **$5.00** ✓)

驗算 (Zeabur, 拆三段):
```
          底價    實例【估算】  出站
20 MAU  = $5.00 + $0.40   +  $0.04  = $5.44
200     = $5.00 + $0.40   +  $0.43  = $5.83
2,000   = $5.00 + $5.80   +  $4.30  = $15.10
20,000  = $5.00 + $16.60  + $43.00  = $64.60
```
> 「實例」那一欄是**反推值**【估算】: 低流量假設一個最小常駐實例 ≈ $0.40/月;
> 2,000 MAU 需要一個常駐 1GB 實例 ≈ $5.80/月; 2 萬 MAU 約需 3 份 ≈ $16.60/月。
> **要拿這欄做決定之前, 去 Zeabur 現在的價目表核對實例單價** —— 它是三欄裡最不可靠的。
> 出站那一欄 ($0.10/GB) 是官方牌價, 也是 2 萬 MAU 時真正的差距來源, 那欄比較可信。

**為什麼 Cloudflare 在流量端幾乎免費**: 【外部】官方對 Workers Assets 的說法是
"Requests to static assets are free and unlimited"。本站 109MB 的 public/ 已經瘦身到 5.08MB 上部署 (§8),
而那 5MB 裡絕大多數是圖 —— 全部走靜態資產 = 不計費也不算 CPU。**Zeabur 那 430GB 有很大一部分就是這些圖**。

### 4.3 Vercel 為什麼不在表上

- 【外部】**Hobby 方案明文禁止商業使用**。這個站只要「一開放註冊」就進入模糊地帶, 而模糊地帶不是可以拿來放 20 個真人資料的地方 → 一到階段 2 (§7) 直接出局。
- 【外部】**Pro 的 $20 是「開發者席次」不是終端使用者**。常見的誤讀是「$20 可以服務多少人」, 不是 —— 那是每個會登入 Vercel 後台的人每月 $20, 再加上用量。
- 結論: Vercel 不是「比較貴」, 是**在階段 2 之後根本不能用**。不用再比。

### 4.4 最重要的一條: Supabase 才是帳單本體

| MAU | 應用託管 (CF) | Supabase【估算】 | Supabase 佔比 |
|---|---:|---:|---:|
| 20 | $5.00 | $0 (Free) | — |
| 200 | $5.00 | $25 (Pro) | 83% |
| 2,000 | $5.54 | $25–40 | 82–88% |
| 20,000 | $15.84 | ~$141 | **89%** |

**每個階段 Supabase 都是應用託管的 5–9 倍。**

推論出來的兩件事:
1. **換託管平台省的錢, 永遠小於 Supabase 升級一階的錢。** 花時間比 CF/Zeabur/Fly/Railway 的 CP 值是在優化 11% 的那一欄。
2. **省 Supabase 的錢 = 讓資料庫少做事**, 也就是 §2 的 policy 改寫、§9 的聚合 RPC。這兩件事的報酬率遠高於任何平台遷移。

---

## §5 鎖定風險與搬家成本

使用者關心「會不會被鎖死」。答案是【實測】: **沒有被鎖死, 而且搬家成本與規模無關。**

### 5.1 耦合面盤點 (2026-08-21 實測)

| 類別 | 數量 | 內容 |
|---|---|---|
| **production 相依** | **0 個** | `dependencies` 裡沒有任何 `@cloudflare/*` 或 workers 專用套件 |
| devDependency | 2 個 | `@opennextjs/cloudflare` ^1.20.2 · `wrangler` ^4.120.1 |
| 設定面 | 5 處 | `wrangler.jsonc` · `open-next.config.ts` · `next.config.ts` 的 `isCloudflare` 分支 · `public/_headers` · `public/.assetsignore` |
| 部署腳本 | 1 支 | `scripts/deploy-cloudflare.mjs` |
| **`src/` 裡的 Cloudflare API 呼叫** | **0 處** | `grep getCloudflareContext` → 0 · `grep runtime="edge"` → 0 |

也就是 **20,746 行 `src/` 裡, 沒有一行知道自己跑在 Cloudflare 上。**

### 5.2 搬家會發生什麼

搬到任何跑得動 Node 的地方 (Zeabur / Fly / Railway / 自租 VPS):

| 步驟 | 內容 | 估時 |
|---|---|---|
| 1 | 刪 `wrangler.jsonc` / `open-next.config.ts`, 換部署腳本 | 1 小時 |
| 2 | `next.config.ts` 拿掉 `isCloudflare` 分支 | 15 分 |
| 3 | `public/_headers` 的三條快取規則改寫成該平台的形式 (或直接進 `next.config` 的 `headers()`) | 1 小時 |
| 4 | `public/.assetsignore` 改成該平台的 build 排除 (或不需要 —— 只影響映像檔大小) | 30 分 |
| 5 | 環境變數搬家 + 冒煙測試 | 2 小時 |
| **合計** | | **0.5–1 人日** |

**而且與規模無關** —— 這 5 個檔案不會因為使用者從 20 變成 2 萬而變多。
所以「等到需要再搬」是**嚴格優於**「現在先抽象化」的策略: 現在抽象要付複雜度, 未來搬家的價格不會漲。

### 5.3 反向的一個好處

`next.config.ts` 的 `pageExtensions` 分支:

```ts
const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";
pageExtensions: isCloudflare ? ["tsx", "ts"] : ["node.tsx", "node.ts", "tsx", "ts"]
```

辨識功能的頁面/路由用 `*.node.tsx` / `*.node.ts` 命名, cloudflare build 時**不算路由** (它們頂層 import `onnxruntime` / `sharp`, Workers 載不動)。

意思是: **搬到任何 Node 型託管, 辨識功能會自動回來** —— 那個分支本來就是為了「這裡跑得動、那裡跑不動」寫的, 不是死路。這也是 §6 的伏筆。

---

## §6 圖片辨識後端要放哪

### 6.1 Workers 為什麼不行

三個各自獨立的硬牆 (任一條就足以出局):

1. **沒有原生模組** —— `onnxruntime-node` / `sharp` 是 native binding, Workers 執行環境沒有。
2. **bundle 3MB 上限** —— 模型檔本身就 85MiB。
3. **記憶體 128MB** —— 【實測】辨識峰值 **537MB**。

> ⚠ **這是 Workers 的限制, 不是 Cloudflare 的限制。** 這句話很重要, 因為它決定了下一節。
> 把「辨識在 Workers 上跑不了」誤讀成「所以要離開 Cloudflare」, 會做出錯誤的平台決策。

### 6.2 Cloudflare Containers

【外部】Workers Paid ($5/月) **內含**:

| 資源 | 每月額度 |
|---|---|
| 記憶體 | **25 GiB-hours** |
| CPU | **375 vCPU-分鐘** (= 6.25 vCPU-小時) |
| 磁碟 | **200 GB-hours** |

而且**會 scale to zero** —— 官方原文: *"Charges stop after the container instance goes to sleep"*。

【估算】能醒著多久:
```
配 2 GiB 記憶體:  25 GiB-h ÷ 2 GiB   = 12.5 小時/月
配 1 GiB 記憶體:  25 GiB-h ÷ 1 GiB   = 25 小時/月     ← 峰值實測 537MB, 1 GiB 夠
CPU 側 (0.5 vCPU): 6.25 vCPU-h ÷ 0.5 = 12.5 小時/月   ← 兩邊都是 12.5h, 剛好平衡
磁碟 (4 GB):      200 GB-h ÷ 4 GB    = 50 小時/月     ← 不是瓶頸
```

換算成「可以辨識幾次」:
```
12.5 小時 = 750 分鐘/月
每次辨識醒著 T 秒 → 可跑 45,000 / T 次
  T = 20 秒 (含冷啟動載模型) → 約 2,250 次/月
  T = 60 秒 (保守)            → 約 750 次/月
```
20 個成員、每人每月傳幾張截圖 —— **邊際成本 US$0**。

⚠ **最大的不確定性: 休眠前的閒置時間。** 如果每次請求後要閒置 N 分鐘才睡, 那 12.5 小時會被閒置吃掉
(閒置 5 分鐘 → 12.5h ÷ 5min = **只剩 150 次喚醒/月**)。這個參數決定整個估算成不成立, 要在真的要做的時候查清楚 / 實測。
另外 Containers 的 GA 狀態與價格細節官方文件**沒有明講**穩定性承諾, 要做之前重讀一次價目表。

### 6.3 但真正的可搬性不是平台給的, 是程式碼給的

【實測】`src/lib/server/` 四個檔:

| 檔案 | 行數 |
|---|---|
| `embed-matcher.ts` | 411 |
| `grid-detect.ts` | 159 |
| `metadata-extract.ts` | 921 |
| `_math.ts` | 142 |
| **合計** | **1,633 行** |

這 1,633 行**零 Supabase / 零 `next/*` / 零 React** —— 純函式, 吃影像出結果。

而 `/api/match-grid` 對 Supabase 的唯一用途是 `auth.getUser()` 當 401 閘門。

**推論出來的結論**: 這套辨識要搬去 Cloudflare Containers、Fly Machine、一台 VPS、還是使用者自己的桌機,
都是 **0.5–1 天, 而且程式碼一行不改** —— 只要在外面包一層 HTTP handler 跟一個 401 檢查。

> 這才是「不被鎖死」的真正來源: **不是選了哪個平台, 是這 1,633 行沒有沾到任何平台。**
> 維持這個性質的規則很簡單 —— `src/lib/server/` 底下不准 import Supabase、不准 import `next/*`。

### 6.4 更正一個之前記錯的數字

之前說「辨識相依 640MB」是**錯的**。實際【實測】:

```
node_modules 相關體積 427MB
  其中 331MB = dinov2-base 的死快取   ← 程式只用 dinov2-small, 這 331MB 從來沒被載過
  真正要進映像檔的:
    套件   ≈ 12 MB
    模型   ≈ 85 MiB (dinov2-small)
  執行期峰值記憶體 537MB 【實測】
```

也就是映像檔大約 **100MB 等級**, 不是 640MB。這個差別會影響「值不值得做容器」的判斷, 所以特別記下來。

### 6.5 Zeabur 在這一題上的劣勢

【外部】Zeabur **付費層不會 scale-to-zero** (只有免費層會休眠)。

辨識是典型的「一個月用幾次、每次幾十秒」負載 —— 不能 scale-to-zero 就是**為了每月幾次的辨識付一整個月的常駐實例**。
這正好是 §4.2 表中 Zeabur「實例」那一欄的成因。

---

## §7 階段式路線圖 (訊號驅動)

**不用時間定義階段, 用可觀察的訊號定義。** 因為時間會過, 訊號才代表事情真的變了。

---

### 階段 0 — 封閉測試 (現在)

**訊號**: 使用者全部是認識的人, 1 個道館, 20 人。

**這個階段的性質**: 個資法上屬於「單純個人或家庭活動之目的」, 大部分義務不適用。工程上可以容忍粗糙。

**要做什麼**:
1. ✅ 升 Workers Paid $5/月 (§3.1) —— **現在就在壞, 這條不能等**
2. ✅ 套 0050–0053 (§8)
3. ⬜ 接自訂網域, 驗證 colo 推論 (§3.2)
4. ⬜ 改寫 `member_pairs` policy (§2) —— 這裡做最便宜, 因為出事只影響認識的人

**月費**: $5 (Workers Paid) + $0 (Supabase Free) = **$5**

**最容易死在哪**:
> **不是技術, 是「Supabase Free 專案閒置會被暫停」**。【外部】Free 方案的專案在一段時間無活動後會 pause。
> 道館賽是「一個月熱鬧幾天」的節奏, 中間的空窗期正好是危險期。
> 真的在用的東西不要放 Free —— 這是「$25/月買掉一整類意外」的典型情境。

---

### 階段 1 — 第一個陌生人

**訊號 (任一出現即進入)**:
- **第 3 個道館出現** (第 2 個還可能是自己或朋友開的; 第 3 個通常代表口碑外溢)
- 有人透過你不認識的管道拿到邀請碼
- 有人問「我的資料你們會怎麼用」

**這個階段的核心: 法務先於工程。**

> 【外部, 需自行核對條文】個人資料保護法 §51 的「單純個人或家庭活動之目的」豁免,
> 在第一個**陌生人**註冊的那一刻消失。之後就是完整的告知義務 (§8)、特定目的、當事人權利行使管道。
> 未備隱私政策的罰鍰量級是 **NT$2 萬至 50 萬**。
>
> ⚠ 這個罰鍰數字與條號是**引用自先前討論、我沒有逐字核對法條**。要當真之前請直接查全國法規資料庫,
> 或問一次法務。但**「豁免會在第一個陌生人出現時消失」這個結構是確定的**, 那才是要記住的部分。

**要做什麼** (依序):
1. **隱私政策頁** —— 蒐集了什麼 (email、遊戲名、社群名、頭像、拍組練度、對戰紀錄)、為什麼、存在哪 (Supabase 新加坡)、放多久、怎麼刪除、聯絡方式
2. **服務條款 / 免責** —— 這是 Pokémon Masters EX 的非官方協作工具, 與 The Pokémon Company / DeNA 無關
3. **帳號刪除路徑** —— 當事人權利不是「寫信給你然後你手動改 DB」就好, 要有可指的流程 (先做成「寄信 + 你在 N 天內處理」也算, 但要寫出來)
4. **資料落地位置寫進政策** —— Supabase 在新加坡 = 國際傳輸, 政策裡要講
5. 工程面: 升 Supabase Pro ($25/月, 買到自動備份 + 不會被 pause)

**月費**: $5 + $25 = **$30**

**最容易死在哪**:
> **工程師會先去優化效能, 因為那個看得見。** 但這個階段唯一「一次就毀掉整件事」的風險是法務,
> 而它不會有任何監控告警。**訊號出現時, 第一件事是寫隱私政策, 不是改 policy。**
>
> 第二個死法: 邀請碼。0053 之前的碼是 `md5(random())` —— PRNG, 48-bit 狀態, 可推算。
> 而 0040 之後 `join_gym` **只吃碼**, 猜中就等於拿到全館資料的讀取權。這在階段 0 無所謂 (都是朋友),
> 在階段 1 就是實質的資料外洩管道。→ **0053 必須在進入階段 1 前套用完畢。**

---

### 階段 2 — 開放註冊

**訊號 (任一出現)**:
- 決定不再用邀請碼控制入口, 任何人可以自己註冊建館
- 道館數 > 10
- 有人在公開場合 (社群、論壇) 推薦這個站

**要做什麼**:
1. **濫用防護** —— 建館速率限制、邀請碼嘗試次數限制、`avatars` bucket 已由 0052 收緊 (512KB / MIME 白名單), 但要再看一次「一個人能生出多少資料」
2. **配額** —— 一個帳號能建幾個館? 一個館多少人? 沒有上限的東西最後都會被撐爆
3. **監控與告警** —— 現在只有 `observability.enabled`, 要有人看。至少: 錯誤率、Supabase 連線數、DB 大小
4. **備份驗證** —— 有備份不等於能還原, 要真的還原一次到另一個專案
5. **§2 的 policy 改寫此時變成必要** (不再只是省錢)
6. **§9 的聚合 RPC** —— 賽事數會開始成長, `.in(battle_id, [...])` 的 URL 長度是下一顆未爆彈

**月費**【估算】: $5 + $25–40 = **$30–45** (200–2,000 MAU 區間)

**最容易死在哪**:
> **成本不會殺死你, 濫用會。** 從 §4 的表看, 2,000 MAU 只要 $40/月 —— 錢完全不是問題。
> 真正的風險是「一個公開 bucket + 一個沒有速率限制的建館 API」被當成免費的檔案託管 / 灌水目標,
> 那會在帳單上以「Supabase 儲存與流量暴增」的形式出現, 而且**你會先看到帳單才看到原因**。
>
> 第二個死法: 這時候才發現 §2 沒修 —— 因為到這裡資料庫已經是熱的, 改 RLS policy 要更小心。

---

### 階段 3 — 規模化

**訊號 (任一出現)**:
- Supabase 運算實例需要升到 Medium 以上
- 單日活躍 > 1,000
- 開始有人問「可以贊助嗎 / 有付費版嗎」

**要做什麼**:
1. **快取層** —— 現在 `open-next.config.ts` 註解明寫「沒有用到 R2/KV 快取 (頁面全動態 + Supabase)」。到這裡圖鑑類的唯讀資料該進 KV / R2
2. **讀寫分離或 read replica** (Supabase 有, 但要錢)
3. **辨識搬進 Containers** (§6) —— 到這個量級才值得為它花時間
4. **重新量一次 §4 的三個參數** (`r` / `c` / `b`) —— 到這時候實際值一定跟今天拍的不一樣, 用實際值重算平台比較
5. 這裡**才是**該認真考慮「換平台」的時候, 而且要用重量後的數字, 不是這份文件的估算

**月費**【估算】: **$62–157** (取決於 §2 修了沒 —— 這就是那 $92 的來源)

**最容易死在哪**:
> **在錯誤的地方省錢。** 到這個量級, 應用託管佔帳單 11%、Supabase 佔 89% (§4.4)。
> 花一週搬到「比較便宜的平台」省下 $10, 不如花一天讓資料庫少做 34 倍的事省下 $92。
>
> 第二個死法: 沒有快取層。頁面全動態 + 每頁跨太平洋查 Supabase, 在 20 人的時候是「慢一點」,
> 在 1,000 人同時的時候是「資料庫連線耗盡」。

---

### 階段轉換一覽

| | 訊號 | 第一件事 | 月費 | 死法 |
|---|---|---|---|---|
| **0 封閉** | 現在 | 升 Workers Paid | $5 | Supabase Free 被 pause |
| **1 陌生人** | 第 3 個道館 | **寫隱私政策** | $30 | 以為這是工程問題 |
| **2 開放** | 公開推薦 / >10 館 | 速率限制與配額 | $30–45 | 被當免費圖床 |
| **3 規模** | Supabase 要升 Medium | 快取層 | $62–157 | 在 11% 的那欄省錢 |

---

## §8 已經做了什麼 (2026-08 這幾輪)

現況是這樣來的。**這一節寫的是「已完成」, 不是計畫。**

### 8.1 效能

| 項目 | 內容 | 效果 |
|---|---|---|
| **圖鑑改走靜態資產** | `/api/catalog` → `public/catalog/<指紋>.json` (Workers Assets 直送) | 每次命中從 **45–65ms CPU → 0 CPU**【實測】; `immutable` 一年 |
| **catalog 子集投影** | teams / battle 頁只送「道館名單 ∪ 已在隊伍裡」 | **464KB → 約 50KB** |
| **靜態資產快取** | `public/_headers`: `/_next/static/*` immutable · `/catalog/*` immutable · `/reference/*` 30 天不 immutable | Workers Assets 預設是 `max-age=0, must-revalidate` —— 沒這個檔, 每個 JS chunk 每次回訪都要重驗 |
| **部署瘦身** | `public/.assetsignore` 排除 opencv/、5 個零引用參考圖目錄、trainer-ex/、已有 webp 的 PNG | **6,573 檔 / 109.68MB → 1,053 檔 / 5.08MB**【實測】 |
| **圖片全面 webp** | q90 立繪/寶可夢、q92 UI, `alphaQuality:100` | 卡框內不會出現白邊 |
| **卡片重圖延遲載入** | `lib/pairs/use-near-viewport.ts`, 一個 root 共用一顆 IntersectionObserver | /pairs 全圖鑑 **981 請求 / 14.7MB → 桌機 208 / 2.75MB, 手機 93 / 1.04MB**【實測】 |
| **往返削減** | `fetch-all.ts` 分頁改成一批平行 3 頁 | `member_pairs` 2,055 列 **從 3 趟往返變 1 趟**, 省 300–540ms |
| **等待畫面骨架化** | `components/skeletons.tsx` + `loading.tsx`; layout 不 await 執行期資料, 導覽列用 `<Suspense>` 串流 | layout 一 await 就會 block 住 `loading.tsx` 的 fallback |

### 8.2 安全

| 項目 | 內容 |
|---|---|
| **安全標頭** | `next.config.ts` 的 `headers()`: Referrer-Policy / X-Content-Type-Options / X-Frame-Options / Permissions-Policy / HSTS / CSP (frame-ancestors, base-uri, form-action, object-src)。**最急的是 Referrer-Policy** —— 這個站把祕密放在網址裡 (`/share/<token>`、`/api/export?key=`), 沒有它, 使用者從那些頁點外部連結會把整條網址連金鑰送給對方。`/share/*` 另外給 `no-referrer` + `noindex`。 |
| | ⚠ **標頭只能寫在 `next.config.ts`, 寫進 `public/_headers` 是白工** —— 已三路驗證 (原始碼 / 線上 / 本機 workerd): `_headers` 只作用在「靜態資產命中」的回應, 頁面 HTML 與 `/api/*` 永遠碰不到。 |
| | CSP **刻意沒有 `script-src`** —— 本站有三種 inline script (Next 的 flight 資料、next-themes 防閃爍、layout 的 `__name` 補丁), 嚴格 script-src 要靠 middleware 逐次發 nonce, 那是獨立的一件事。 |
| **0050** | 收回 `log_activity` 的公開 EXECUTE。【實測】ACL 是 `{=X, postgres=X, anon=X, authenticated=X, service_role=X}` → 任何拿得到 anon key 的人 (它本來就印在瀏覽器裡) 都能對**任意 gym_id** 插 `gym_activity` —— 完全繞過 RLS 的寫入原語。**要寫 `from public, anon, authenticated` 三個**, 只 revoke public 在 Supabase 上是無效的 (0030 對 `set_member_pair` 就是這樣失效的)。 |
| **0051** | 把 0030/0037/0005 「本來就打算 revoke 卻沒 revoke 成功」的 6 支 RPC 補齊 (`join_gym` / `create_gym` / `set_member_pair` / `adjust_member_ticket` / `get_`/`rotate_my_export_token`)。兩個成因: (a) revoke 寫法無效 (b) 0040 換簽章時 revoke 沒跟著搬。 |
| **0052** | `avatars` bucket 補 MIME 白名單 (webp/png/jpeg) + 512KB 上限。原本是 public bucket + 無限制 + 只比檔名前綴 = 免費圖床。【實測】線上 `storage.objects` 一列都沒有, 收緊不影響任何既有檔案。 |
| **0053** | 邀請碼 / 顧問碼從 `md5(random())` 改 `gen_random_uuid()` (走 OS CSPRNG)。格式維持 12 碼大寫十六進位, **現有的碼一律不變** (只改 DEFAULT, 沒 update 任何列)。 |

### 8.3 未公布拍組外洩 (這一輪修掉)

**問題**: catalog 有 **10 筆**資料管線從 datamine 先撈到、官方還沒宣布的拍組, 正在公開供應中
(`public/catalog/<指紋>.json` 走 Workers Assets 直送, **不經 Worker, 未登入就抓得到**)。

**修法**: 在唯一收口 `loadPairsForClient()` 用具名判準過濾:

```ts
// src/lib/pairs/loader.ts
isUnreleasedPair(rec)  =  verifiedSources 為空  AND  releaseDate 為 null
```

**兩個條件缺一不可** (兩個「只用單一條件」的陷阱都已寫進註解與測試):
- 只看 `releaseDate == null` → 會多殺 **4 筆早就上市**的 (小悠&木守宮 / 麗姿&鬃岩狼人 / 默丹&貓老大 / 哈烏&雷丘)
- 只看 `series === "upcoming"` → 會多殺 **11 筆已上市新拍組** (upcoming 是上架時間標記不是系列)

**結果**: 645 → **635 筆, 0 筆誤傷**。`CATALOG_VERSION` `5m5zaj` → **`1nbqg8x`**。
另外 4 個「只有這 10 筆在用」的 `.webp` 加進 `.assetsignore` (其餘共用圖檔還有已上市拍組在指, 絕不能排除)。
新增 `tests/unreleased-pairs.test.ts` 7 條迴歸測試 (實測: 把 filter 拿掉會紅並列出 10 個外流 id)。

> ⚠ **殘留風險 (還沒解決)**: 那個 JSON 線上是 `max-age=31536000, immutable` 且已 `CF-Cache-Status: HIT`。
> 部署後 origin 沒了, 但**邊緣與瀏覽器已抓過的副本最長可存活一年**。已外流的收不回來。
> 要主動清除, 需要 Cloudflare 端 purge —— 而 **workers.dev 子網域沒有 zone purge UI**。
> **這是 §0 第 3 條 (接自訂網域) 除了 colo 之外的第二個理由。**
>
> ⚠ **拍組正式公布後要記得把 `.assetsignore` 那 4 行刪掉**, 否則線上是空卡。

### 8.4 1000 列靜默截斷 (這一輪修掉)

**問題**: PostgREST 一次最多回 1000 列, **超過時不報錯、靜默截斷**。

【實測】直接證據 (`member_pairs`, 線上 2,055 列):
```
不分頁 → 拿到「剛好 1000 列」, error 為 null      ← 完全靜默
分頁   → 拿到 2,055 列 = 1000 + 1000 + 55
畫面上的差別: 「持有人次」1,000 vs 2,055 —— 少算 1,055 人次
```

**主修**: `gyms/[id]/battles/page.tsx` 跨全部賽事的兩支 `.in()` 查詢改走 `fetchAllRows` 分頁。

【實測】外推 (一場打滿 = 290 列):
```
場數   總列數    修前拿到 / 修後拿到
 1     290       290 /  290
 3     870       870 /  870        ← 今天在這裡, 修前修後 0 差異
 4    1160      1000 / 1160        ← 斷點! 少 160 列 ≈ 少算 330 張券
 6    1740      1000 / 1740        ← 少算 1,524 張券
```
> **線上已經辦到第三場 —— 下一場就是斷點。** 而且截斷後畫面沒有任何錯誤訊息,
> 看起來就像「那場大家打得比較少」, 被吃掉的還是**最舊的那幾場**。

**順帶**: `api/export` 的單場 `battle_logs` 也改分頁 —— 它**沒有硬上限** (`member_tickets.cap` 依 0043 可調到 99,
且 `reportBattleLog` 在 `ticketsUsed=0` 時照樣插列) → 理論天花板 20 人 × 99 = **1,980 列**。

**全部既有的 `fetchAllRows` 補 `.order("id")`** —— 這不是裝飾: `fetch-all.ts` 現在一批平行發 3 頁 = 三次獨立查詢,
沒有 ORDER BY 時 Postgres 不保證列順序一致, 中間有人寫入 (`syncMemberPair` 在 grade=0 時**刪列**) 就會讓邊界的列重複或漏掉。
重複的後果不是「多一筆」而是**數字變大** (券數多加、持有數多算)。`id` 是 uuid 主鍵 = 唯一全序。

**已稽核**: 全站 30+ 支查詢逐一標注上限與判定 (詳見該輪交辦紀錄)。兩個**還沒修**的留給之後 → §9。

### 8.5 UI / 資訊架構

- 手機版: hover-only 控制項一律 `pointer-coarse:opacity-100`, 觸控目標 ≥44px, 側板 = bottom sheet
- 資訊架構收斂到 2 個頂層分頁 + 道館底下 3 個分頁 (詳見 `AGENTS.md`, 那份才是權威)
- 排刀整套下線 (0047)、對戰紀錄分數移除 (0048)、全站用詞改正式說法 (出刀/券 → 對戰紀錄/挑戰券)

---

## §9 待辦池 (有訊號才做)

**不是 TODO list, 是「訊號 → 動作」對照表。** 沒有訊號就不要做。

| 訊號 | 動作 | 為什麼等訊號 |
|---|---|---|
| **現在** (20 人已經在撞) | 升 Workers Paid | §3.1, 唯一「已經在壞」的 |
| **現在** | 套 0050–0053 | 已在線上的權限洞 |
| 想驗證 colo 推論 | 接自訂網域 → `/cdn-cgi/trace` | 成本近乎零, 上限是 ~400ms 地板 (§3.2) |
| 頁面開始被抱怨慢 / 進階段 2 | 改寫 `member_pairs` RLS policy | §2, 34 倍 |
| **下一場道館戰前** | `battles/[battleId]/page.tsx:60` 與 `battle-client.tsx:246` 的 `battle_logs .eq(battle_id)` 改分頁 | 與 §8.4 修掉的同一個形狀, 天花板 1,980 列。看板是「對戰紀錄」的主要入口, 少列 = 有人的出刀憑空消失。分頁時要保留 `.order("created_at", desc)` 並加 `.order("id")` 當唯一決勝 (同一秒可能多列) |
| 賽事數 > 20 場 | 加聚合 RPC `gym_battle_totals(p_gym)` | 賽事一覽只需要三個數字 (每關券數/全場券數/參戰人數), 現在卻把全部列拉進 Worker 再在 JS 裡數。RPC 後回傳列數 = 場數×關數 (3 場 = 24 列), 永遠碰不到 1000 列。**順帶解掉 `.in(battle_id, [...])` 的 URL 長度未爆彈** —— 100 場 ≈ 3.7KB 的 query string, 撞上去是 414 (不靜默, 但一樣是「辦久了才炸」) |
| **catalog 筆數破 800** | `lib/collection.ts:23` 與 `api/export` 的 `user_collection .eq(user_id)` 改分頁 | 上限就是 catalog 筆數 (現在 635), 線上單人最大 130 列。餘裕還有, 但遊戲每月出新拍組 —— 不要等到破 1000 才修 |
| 那 10 筆拍組正式公布 | 刪掉 `.assetsignore` 最後 4 行 | 不刪 = 線上空卡 (§8.3) |
| 要重啟辨識功能 | 評估 Cloudflare Containers (§6), 先確認休眠前閒置時間 | 那個參數決定整個免費額度估算成不成立 |
| 要重啟 EX 立繪 | 三處一起動: 轉檔腳本 TARGETS 加 trainer-ex / upload 頁路徑 / `.assetsignore` 拿掉那行 | 少一步就是線上 EX 立繪全 404 (三處都已就地留註解) |
| 想上嚴格 CSP | 需要 middleware 逐次發 nonce | 直接上 `script-src` 會整站白畫面 (三種 inline script) |

---

## §10 操作手冊

環境: **Windows PowerShell 5.1** —— 沒有 `&&`, 沒有三元運算子, heredoc 用 `@'...'@` 且結尾 `'@` 必須在第 0 欄。
路徑一律絕對路徑: `C:\code\pokemon-master-inventory`

### 10.1 部署

```powershell
cd C:\code\pokemon-master-inventory
npm run deploy:cf
```

做了什麼 (`scripts/deploy-cloudflare.mjs`):
1. 以 `DEPLOY_TARGET=cloudflare` + `NEXT_PUBLIC_ENABLE_RECOGNITION=""` 執行 `npx opennextjs-cloudflare build`
   → `next.config.ts` 的 `pageExtensions` 變成 `["tsx","ts"]`, 辨識的 `*.node.tsx` / `*.node.ts` **不算路由**
   (它們頂層 import 原生模組, 只靠執行期 404 擋不住 bundler)
2. `npx opennextjs-cloudflare deploy`

認證: 優先吃 `CLOUDFLARE_API_TOKEN` 環境變數, 否則讀 repo 根目錄的 `.cloudflare-token` (gitignored, 內容就是 token 一行)。
帳號同理讀 `.cloudflare-account-id`。

**本機預覽 (不上線)**:
```powershell
npm run preview:cf        # build + 本地 workerd (opennextjs-cloudflare preview)
```

**部署前的例行檢查**:
```powershell
npx tsc --noEmit          # 型別
npm test                  # vitest
npx eslint                # lint
```

⚠ **地雷**:
- **wrangler 的 OAuth token 會過期** → deploy 失敗時跑 `npx wrangler login` (互動式, 會開瀏覽器)。**不要自動重試**。
- **Workers 部署有傳播延遲** —— 部署完立刻 probe 可能打到舊版, 等幾秒重試再判定。
- 部署後要驗證的三件事: 首頁 200、`/catalog/<指紋>.json` 是新的指紋、隨便一張 `/reference/**.webp` 不是 404。

### 10.2 套 migration

```powershell
cd C:\code\pokemon-master-inventory
node scripts/setup-supabase.mjs
```

- 對 `.env.local` 的 `DATABASE_URL` **直接跑雲端**, 依檔名順序套 `supabase/migrations/*.sql`
- 用 `public._migrations` 表記錄已套用檔名 → **冪等**, 重跑只補新的
- 跑完要確認每支新 migration 都印出 `✓ committed`

**新增 migration**: 檔名 `00NN_描述.sql`, 檔頭一定要寫「為什麼要有這支 / 套用後會不會影響現有功能 / 用什麼查證的」——
0050–0053 是這個格式的範例, 照抄。

⚠ **線上資料庫就是正式資料**。probe / 驗證腳本只能讀; 要寫也只能寫「自己的列」且寫回同一個值。
(前科: 曾把某成員的寶5 洗成寶1 再刪列, 事後才發現並手動還原。)

### 10.3 看線上日誌

```powershell
# 即時尾隨 (Ctrl+C 停)
npx wrangler tail pm-gym --format pretty

# 只看錯誤
npx wrangler tail pm-gym --status error

# 找 CPU 爆掉的請求 (§3.1 那 5 筆就是這樣抓到的)
npx wrangler tail pm-gym --format json | Select-String "exceededCpu"
```

`outcome` 的值要認得:
| outcome | 意思 |
|---|---|
| `ok` | 正常 |
| `exceededCpu` | **CPU 超標** → 使用者看到 Error 1102 |
| `exceptionThrown` | 程式丟例外 |
| `canceled` | 用戶端斷線 |

Dashboard 端 (`observability.enabled = true` 已開): Workers & Pages → pm-gym → Logs / Metrics, 看 CPU time 分佈與 p50/p99。

### 10.4 量 colo 與延遲

```powershell
# colo (最直接)
curl.exe -s https://pokemaster-tool.com/cdn-cgi/trace

# 若 /cdn-cgi/trace 被 Worker 接走 (404), 改看 cf-ray 尾碼 —— 最後三碼就是機場代號
curl.exe -sD - -o NUL https://pokemaster-tool.com/ | Select-String "cf-ray|cf-cache-status"

# 分段延遲
curl.exe -s -o NUL -w "dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}`n" https://pokemaster-tool.com/

# 對照組: 同一條線路打 cloudflare.com, 應該是 TPE
curl.exe -s https://www.cloudflare.com/cdn-cgi/trace | Select-String "colo"
```

判讀:
- `colo=TPE` + `conn` 個位數 ms = 走台北 (好)
- `colo=SJC` + `conn` >100ms = 走加州 (現況)
- 靜態檔 `CF-Cache-Status: HIT` 但 TTFB 仍 >400ms = **地板問題不是程式問題** (§3.2)

### 10.5 回滾

```powershell
# 先看有哪些版本 (wrangler 4.x 兩個指令都可能適用, 先 list 再說)
npx wrangler deployments list
npx wrangler versions list

# 回滾到上一個
npx wrangler rollback

# 回滾到指定版本
npx wrangler rollback <deployment-or-version-id>
```

⚠ **回滾只回滾 Worker 程式碼與資產, 不回滾資料庫。**
如果那次部署伴隨 migration, 回滾之後**舊程式碼要面對新 schema** —— 所以:
> **migration 一律寫成向後相容** (加欄位不刪欄位、加函式不改簽章), 刪除類的動作跟部署至少隔一輪。
> 0047 那種大掃除 (drop 三張表 + 一堆欄位) 就是必須確認舊版本不會再被回滾到才做。

**資料庫回滾**: 沒有自動的。Supabase Free **沒有** point-in-time recovery; Pro 才有自動備份。
→ 這是 §7 階段 1 升 Pro 的實質理由之一。

### 10.6 資料管線 (不是部署, 但常一起做)

```powershell
npm run data:update:fast    # 更新拍組 catalog (跳過 embedding 重算)
npm run data:webp           # 轉 webp (⚠ 一定在管線最後一階跑)
npm run data:catalog        # 只重新產生 public/catalog/<指紋>.json + catalog-version.ts
```

⚠ 手動跑過 `fetch-wiki-trainer-images` 之後**一定要補 `npm run data:webp`** —— PNG 不進部署,
漏轉 = 那些拍組線上是空卡。詳細規則在 `AGENTS.md` 與 `docs/data-update.md`。

改了 catalog 之後要一起 commit 的三個檔 (少一個 `tests/catalog-asset.test.ts` 會紅):
`src/data/catalog-version.ts` + 新的 `public/catalog/<新指紋>.json` + 刪掉的舊指紋 JSON。

---

## §11 不確定清單

**引用這份文件的數字之前先看這裡。** 這一節存在的意義是: 不要讓推論在轉述兩次之後變成事實。

| # | 事項 | 狀態 | 怎麼確認 |
|---|---|---|---|
| 1 | ~~workers.dev 子網域 → colo=SJC 的因果~~ | **【已否證 2026-09-02】** 接上自訂網域後 colo 仍是 SJC (連量 4 次), connect/TLS 與 workers.dev 在誤差內相同。子網域不是原因。 | 已驗證, 見 §3.2 |
| 2 | ~~接自訂網域就會回到 TPE~~ | **【已否證 2026-09-02】** 完全沒差。426ms 的地板另有原因 (推測是用戶端 ISP ↔ Cloudflare 的 peering), 待重新調查。 | 已驗證, 見 §3.2 |
| 3 | **Cloudflare Containers 的 GA 狀態與價格穩定性** | 【外部】免費額度數字 (25 GiB-h / 375 vCPU-min / 200 GB-h) 與 scale-to-zero 的官方原文都有據, 但**穩定性承諾與長期價格沒有明講**。 | 要做之前重讀價目表 |
| 4 | **Containers 休眠前的閒置時間** | **未知, 而且是關鍵參數。** 閒置 5 分鐘會讓「12.5 小時/月」變成「150 次喚醒/月」。 | 實測: 打一次然後看計費何時停 |
| 5 | **Supabase 運算階梯的落點 (Large vs Small)** | 【估算】§2.4 的 $157 / $65 是用官方加購價位反推的。**34 倍與 40 倍是實測**, 但「所以掉幾階」要到那個量級才知道。 | 到 2,000 MAU 時量一次 |
| 6 | **Zeabur 的「實例」那一欄** | 【估算】反推值, 三欄裡最不可靠。出站 $0.10/GB 是牌價, 那欄可信。 | 查 Zeabur 現行價目表 |
| 7 | **§4 的 `r`(100 請求/MAU/月) 與 `b`(21.5MB/MAU/月)** | 【估算】拍的。只有 `c`(286ms) 是實測。 | 上線後從 Workers Metrics 讀實際值, 重算一次 §4 |
| 8 | **個資法 §51 豁免 / NT$2萬–50萬 罰鍰** | 【外部, 未逐字核對】條號與金額引用自先前討論, **我沒有查全國法規資料庫核對**。 | 直接查條文, 或問一次法務。**「豁免在第一個陌生人出現時消失」這個結構是確定的**, 金額不確定。 |
| 9 | **Vercel Hobby 禁商業使用的具體邊界** | 【外部】條款寫得寬, 「開放註冊的協作站」大概率算商業使用, 但沒有官方個案認定。 | 不重要 —— 結論是「不用它」, 不需要精確認定 |
| 10 | **已外流的 catalog / webp 的實際擴散** | **不可知。** `immutable` 一年的邊緣與瀏覽器副本收不回來, 也沒辦法知道被抓過幾次。 | 沒辦法。只能記取: **未公布資料不要進 `public/`**。 |

---

## 附錄 A: 一句話版本

> 這個站沒有被鎖死 (production 0 個 Cloudflare 相依, 搬家 0.5–1 人日且與規模無關),
> 也不貴 (每個階段 Supabase 都是託管的 5–9 倍, 所以平台選擇不是成本槓桿)。
> 現在真正在傷害使用者的只有一條: **CPU 中位 286ms 撞免費方案的 10ms 上限, 20 人並行就有 25% 失敗。**
> 花 $5 解決。
> 之後最大的單筆槓桿是一條 RLS policy (34 倍, 到 2 萬 MAU 值 $92/月 —— 比所有平台價差加起來還大)。
> 而唯一「工程做得再好也擋不住」的風險, 在第 3 個道館出現時到期, 那是法務。

## 附錄 B: 相關檔案

| 檔案 | 管什麼 |
|---|---|
| `AGENTS.md` | **硬性慣例的權威** —— 這份 DevOps 文件不覆蓋它, 衝突時以 AGENTS.md 為準 |
| `wrangler.jsonc` | Worker 名稱 / 相容性日期 / assets binding / observability |
| `open-next.config.ts` | OpenNext adapter (目前預設值, 沒接 R2/KV) |
| `next.config.ts` | **安全標頭** / 轉導 / `pageExtensions` 的 cloudflare 分支 / `serverExternalPackages` |
| `public/_headers` | **靜態資產**的快取與 nosniff (只作用在資產命中的回應) |
| `public/.assetsignore` | **部署帶什麼的唯一開關** (109.68MB → 5.08MB) |
| `scripts/deploy-cloudflare.mjs` | 一鍵建置 + 部署 |
| `scripts/setup-supabase.mjs` | 套 migration (冪等) |
| `src/lib/supabase/fetch-all.ts` | 1000 列分頁 (一批平行 3 頁) |
| `src/lib/supabase/proxy.ts` | 登入牆 / `PUBLIC_ROUTES` (`/api/export` 必須在裡面, 它自己用金鑰授權) |
| `src/lib/pairs/loader.ts` | catalog 唯一收口 + `isUnreleasedPair` |
| `src/lib/server/**` | 辨識管線 1,633 行, **零 Supabase / 零 next/\* / 零 React** —— 可搬性的來源, 維持這個性質 |
| `docs/data-update.md` | 資料管線操作 |
| `docs/rebuff-notes.md` | 降抗重做前必讀 |
