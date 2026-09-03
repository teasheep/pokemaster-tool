<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# pm-gym — Pokemon Masters EX 道館賽協作站

線上: https://pokemaster-tool.com (Cloudflare Workers, 2026-09-02 起; 舊的 workers.dev 已關閉)。
20 位道館成員實際在用。UI/註解一律繁體中文。

## ⛔ 帳號: 這個專案的每一個外部服務都是**獨立專用帳號**

**GitLab / Cloudflare / Supabase 全部都是**, 一個都不例外。**不要**假設「開發者電腦上現在登入的那個帳號」
就是這個專案要用的帳號 —— 那台機器上同時有本人的帳號與專案專用帳號, 而 CLI 工具預設會用前者。

**動任何雲端操作 (部署 / 改設定 / 查資料) 之前, 先核對帳號 ID**:

| 服務 | 專案專用帳號 | 怎麼確認 |
| --- | --- | --- |
| Cloudflare | Worker `pm-gym` 的 account id 存在 `.cloudflare-account-id` (gitignored) | `npx wrangler whoami` 的 Account ID 必須等於那個檔的內容 |
| Supabase | `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 那個專案 | 只走 `.env.local`, 不要用其他來源 |
| GitLab | 專案專用帳號 | `git remote -v` |

⚠ **前科 (2026-09-02)**: `npx wrangler whoami` 顯示的是**開發者本人的帳號, 不是專案的**,
而且那個帳號的 memberships 裡看不到專案帳號的任何 zone。當時據此推論「網域被加到別的帳號」
並照常部署, 結果 deploy 打到專案帳號的 API 直接 `Authentication error [code: 10000]`。
**登入錯帳號的徵兆是「查不到東西」而不是「報錯」** —— zone 清單會回 `success: true` 但 0 筆,
看起來像資料不存在, 其實是在錯的帳號裡找。

帳號不對時的解法只有一條: 請使用者互動式重登 (`npx wrangler login`, 會開瀏覽器)。
**不要自己重試、也不要改用其他帳號的憑證繞過。**

- 技術: Next.js 16 App Router + Supabase (雲端) + @opennextjs/cloudflare + Tailwind 4 + vitest
- **資訊架構 (使用者指定, 別改回去)**: 頂部只有兩個分頁 —
  `/pairs` 拍組 (只有自己的資料) 與 `/gyms` 道館, 外加 `/resources` 我的資源 (糖果)。
  道館底下目前 3 個分頁 (使用者指定的順序, 2026-08-17 起成員與拍組排最前 = 根路徑預設頁),
  **分頁名 = 頁面 h1 = 該頁唯一職責, 三者要一起改**:
  成員與拍組 (名冊+角色 / 成員碼與顧問碼緊貼 h1 (`PageHeading beside`) / 名冊第一項「全館拍組」= ★名單+持有率 / 選成員 = 他的練度+糖果+紀錄) /
  道館戰 (`/gyms/[id]/battles` 賽事一覽+建立賽事+單場看板; 「全體屬性戰力」已暫時收掉, 之後要再加) /
  隊伍庫 (每屬性用哪三隻; 看板側板選隊用同一份 `TeamLibrary`)。
  道館攻略與紀錄 2026-08-17 暫時下架 (使用者要重做): 只拔入口 — tabs 移除 +
  next.config 轉導 /guides /activity → members; 頁面程式與資料表都留著, 不要刪。
  `/gyms/[id]` 根路徑 = 轉導到 members (next.config redirects, 不是 page redirect)。
  個人的東西在頭像選單: 個人設定 / 資料連線 (AI 唯讀金鑰)。
  **不要再長出新分頁**, 也**不要把既有分頁降級成別頁的側板** — 隊伍庫曾被收進看板側板,
  結果分頁消失、看板裡的連結指向轉導頁 (使用者當場抓包)。功能要搬家先確認「入口還在不在導覽列」。
  想加東西先問「現有哪一頁的職責涵蓋它」。
  分頁以外**不要再放第二個入口** (看板裡的「隊伍庫/攻略」按鈕已刪 — tabs 就在上面一排)。
  (已刪: 沒有分頁的「道館總覽」孤兒頁 → 內容拆回上述各頁;
  「排刀權重」/strategy → 死功能, assign.ts 根本不讀 strategy_pairs)
- 指令: `npm run dev` (port 3030)、`npm test`、`npx tsc --noEmit`、`npm run deploy:cf` (建置+部署一鍵)、
  `node scripts/setup-supabase.mjs` (套 migrations, 冪等)、`npm run data:update:fast` (更新拍組 catalog)

## 硬性慣例 (違反 = bug, 全部有前科)

- **`/pairs` 兩個子分頁 + 一個開關 (使用者指定)**: 道館重點拍組 / 所有遊戲拍組,
  右側「顯示全部 / 只看我持有的」(預設顯示全部, 沒有的是灰卡)。**這頁只有自己的資料** — 別人的持有在道館的成員頁看,
  不要再把成員切換器放回來; 匯出 CSV / 分享連結屬於頁面層級動作, 放標題列不要塞進篩選列。
- **練度欄位只留遊戲裡真的有的**: 寶數與超覺醒是同一條軸 → 單一下拉
  (未持有 / 寶1-5 / 超覺醒1-5); 星數只能從**原始星級**升到 6★EX (5★ 拍組沒有 3★/4★ 選項),
  6★EX = 星數 6, 不要再用額外的 checkbox 表示同一件事。招式 1-5 / 同步 1-5 不存在, 已刪。
  **這條軸的數值 = 0-10** (0038 起): 0=未持有, 1-5=寶, 6-10=超覺醒1-5 —
  `member_pairs.grade`、隊伍需求 `min_grade`、`GRADE_LABELS` 全部同一條;
  不要再把 6 當「籠統的超覺醒」(前科: 隊伍需求點寶數從寶5 直接跳超覺醒5)。
- **讀 Supabase 全量資料要分頁**: PostgREST 一次最多回 1000 列, `member_pairs` 這種表早就超過 —
  忘記 `.range()` 分頁會拿到「剛好 1000 列」的假象 (前科: 匯入比對被截斷, 差點誤判)。
  client 端用 `fetchAll` (`lib/gym/export-csv.ts`), 腳本自己寫 range 迴圈。
- **卡片外框不因 6★EX 變化**; 星星只有兩種: 1-5★ 用 p5_N, 6★EX 用 pex_ex。
  EX 換裝立繪 UI 已拔除 (資料欄位與圖檔保留, 之後要做再開)。
- **篩選只放「拍組本身的性質」** (屬性/角色/系列/地區/原始星級/可超覺醒)。
  「我有沒有」「是不是道館指定」由分頁決定, 不要塞回篩選器; 可超覺醒是獨立面向, 不是星級。
  地區依 `REGION_ORDER` (世代順序) 排, 系列不含 `upcoming` (那是上架時間不是系列)。
- **拍組顯示名一律 `pairName()`** (`src/lib/pairs/name.ts`):「人名 & 寶可夢名」, 卡下兩行 `line-clamp-2`。
- **成員顯示名一律 `memberLabel()`** (`src/components/gym/member-card.tsx`):「遊戲名(社群名)」。
- **卡片互動標準**: 點卡片 (含灰卡) = 開編輯側板; 點左下角 = 寶數循環 (寶1→5→超覺1→5→歸零)。
  寶0 = 整卡反灰, 沒有「寶0 持有」狀態。可點的左下角要有 hover 光暈提示。
- **拍組領域禁用「移除」**: 不持有 = 寶0 (循環歸零 / 側板選寶0), 全站不要再有刪除收藏、
  從名單移除之類的第二條路 — 語意重複而且結果不同 (刪列 vs grade=0) 已經害過一次。
  `syncMemberPair` / `set_member_pair` 在 grade=0 時一律刪 member_pairs 列, 不留幽靈列。
- **ref/ 只是 input (使用者 2026-08-17 明訂)**: 匯入表單只取「值」(誰有什麼、練度多少),
  ref 的分類/標籤/權重一律丟棄, 也不要為了 ref 長新欄位或新功能。0039 已 drop 掉整批
  ref 匯入的結構: member_debuffs / member_type_scores / gym_pair_tags / strategy_pairs
  四張表 + gym_pairs.tag/source_kind 兩欄 (drop 前備份在 ref/archive-ref-tables-2026-08-17.json)。
  「拍組共筆標籤」功能同時整個移除 — 使用者根本不知道它存在 (「共筆標籤是什麼 在哪裡啊」)。
- **降抗整套待重做** (2026-08-16 使用者要求先拔掉): 排刀降抗先手、屬性戰力燈號、
  「全體屬性戰力」面板都移除了。重做前先看 `docs/rebuff-notes.md`
  (官方用語「屬性抵抗」, 有階數/單體/全體/觸發之分), 不要拿舊試算表數值長回來。
- **沒有「館主」, 只有 管理員/成員/顧問** (0041): 建館的人就是管理員 (`create_gym` RPC),
  管理員可互相升降、也可把自己移除, 但**最後一位管理員動不了** (DB trigger `LAST_ADMIN`;
  整館刪除的 cascade 例外)。gyms.owner_id 已刪, 權限判定一律走 role。
- **名字跟人走**: 遊戲名/社群名是個人資料 (profiles, 個人設定編輯), 不因道館而異 →
  加入道館**只填邀請碼** (`join_gym(p_code)`), 建館只填館名。「同暱稱認領名單」已移除
  (暱稱可重複, 不能當身分; 帳號識別一律 email = auth 帳號)。
- **登入只有 Google 一條路, 但有兩個觸發** (2026-09-01): 按鈕 `GoogleSignInButton`
  (整頁導向 → `/auth/callback`) 與 Google One Tap `components/google-one-tap.tsx`
  (`signInWithIdToken` → `/auth/one-tap`)。One Tap 是**捷徑不是第二種登入方式**, 按鈕永遠要留著 ——
  FedCM 生效後 `isDisplayed()`/`getNotDisplayedReason()` 全部不再觸發, 我們**偵測不到它有沒有跳出來**,
  沒有保底入口就是「入口還在但功能斷掉」。四個踩過/查證過的點:
  1. **nonce 方向不能反**: hashed (SHA-256 **小寫 hex**, gotrue 是 `fmt.Sprintf("%x",…)`) 給 Google,
     raw 給 `signInWithIdToken` —— 給反了是 401 `Nonces mismatch`, 訊息看不出方向。
     兩份都由 `lib/auth/one-tap-nonce.ts` 產, `tests/one-tap-nonce.test.ts` 釘住格式。
  2. **onboarding 閘門只有一份**: `lib/auth/post-login-destination.ts` 的 `resolvePostLoginPath()`,
     `/auth/callback` 與 `/auth/one-tap` 共用。One Tap 不經過 callback, 少了它新成員永遠不會被要求
     設定名稱/頭貼。導向走 **Route Handler `/auth/one-tap` 而不是直接去 `/welcome`** ——
     `/welcome` 被 `app/loading.tsx` 涵蓋, 已 onboarded 的人會先閃一格骨架再跳走。
  3. **成功後一定要再 `getSession()` 確認**才導頁: browser client 只寫 `document.cookie` 沒有記憶體
     備援, cookie 被擋時 `signInWithIdToken` 仍會成功 resolve → 直接導頁就變成
     one-tap → /login → 又自動彈的迴圈。另有 sessionStorage 保險絲, **在排定 prompt 的當下就燒**
     (不是等成功), 否則站內 `<Link>` 走來走去每次重掛都會再彈一次。
  4. **掛在 root layout, 但只給訪客** (2026-09-02 改, 使用者指定「沒登入的時候哪裡都有 One Tap」):
     入口是 `components/google-one-tap-slot.tsx` (async server 元件), **已登入就 `return null`** ——
     連 GIS script 都不載 (20 位成員平常都是登入狀態, 不該為一個他們永遠看不到的提示付一支
     第三方 script)。RootLayout 要用 `<Suspense>` 包它: layout 自己不准 await (老地雷)。
     **代價要知道**: GIS script 載入本身就是一個帶 Google cookie 的請求, 每頁都掛 = 每頁都告訴
     Google「有人來過」, 而訪客關掉 One Tap 會讓瀏覽器對本站進入 FedCM embargo (看不到、查不出來)。
     這是使用者權衡過後要的, 不要自己改回只掛一頁。也**不要**改成訪客點卡片彈 One Tap (撞「卡片互動標準」)。
  前置條件在 Google Cloud Console 的「授權的 JavaScript 來源」(要含正式站與 `http://localhost:3030`),
  漏了就是**完全不顯示 + 畫面零徵兆**, 只有 console 一行 GSI_LOGGER。Supabase 端不用動
  (aud 對的就是既有的 `external_google_client_id`, 不需要 additional client ids, 也不要開 Skip nonce check)。
  client id 由 `GoogleOneTapSlot` 讀執行期 `process.env.GOOGLE_OAUTH_CLIENT_ID` 傳下去,
  **不需要 `NEXT_PUBLIC_`** (opennextjs-cloudflare 會把 .env.local 寫進 next-env.mjs 再灌回 process.env)。
  **右上角那顆「登入」鈕在 `/` 與 `/login` 不渲染** (`components/header-sign-in.tsx`, 2026-09-03):
  這兩頁畫面裡本來就有一顆真的 Google 按鈕, 再放一顆等於同一個動作兩個入口, 而且兩顆長得不一樣
  (shadcn 主色鈕 vs 官方 Google 鈕)。**其他頁一定要留著** —— 訪客還看得到 `/pairs` 與
  `/share/[token]`, 那些頁沒有 CTA, 那顆就是唯一的保底入口 (One Tap 偵測不到, 不算入口)。
- **首頁 hero 的插圖是兩塊看板輪替** (`app/home-hero-boards.tsx`, 2026-09-03): 全館拍組持有
  (20 人中幾人有) 與道館戰 (誰還剩幾張券) —— 正好對上標題那句「拍組、道館戰分配」的兩件事,
  少一塊就有半句沒有畫面。**拍組排第一** (使用者指定, 也是句子的前半)。四件不要改壞的事:
  兩塊**一直都掛著**只是輪流淡入 (grid 疊同一格 + `h-full`), 切換時版面一個像素都不動;
  那一下變化 (券 13→12 / 持有 +1) **由 hero 統一計時** (`ticked` prop) —— 看板自己算 timer 的話
  兩顆都在載入時跑完, 輪到第二塊時動作早就播完了; 點過圓點就停止自動輪替 (WCAG 2.2.2),
  `prefers-reduced-motion` 則一開始就不自動輪; 長條的掃入 (`revealed`) **只播第一次**,
  每輪回來都掃一次會變吵。
- **拍組看板列的是 catalog 最新上架的五組, 持有人數隨機** (`app/home-latest-pairs.ts`,
  2026-09-03 使用者指定): 寫死名單遲早會過期, 吃 catalog 就自己跟著改版更新。兩件事:
  一律走 `loadPairsForClient()` (未公布的那批在那裡就濾掉了, 不會冒到對外的首頁);
  擲骰子**只能在 server 端擲一次再傳下去** —— 在 client 元件裡擲會 SSR 對不起來,
  而且 `react-hooks/purity` 會直接把 render 裡的 `Math.random()` 判成錯誤。
  區間是照名次分的 (越新的人越少有), 不是均勻亂數 —— 均勻亂數會擲出五條差不多長的條,
  看不出這是持有率看板。道館戰看板的示範成員維持假資料 (小智/小霞/小剛/小光, 一看就知道是範例),
  頭貼用他們自己的訓練家立繪, 走 `MemberAvatar` 的 avatarUrl 不要長第二套頭像實作。
- **首頁要看得出是哪一款遊戲** (2026-09-03, 使用者:「完全看不出來跟遊戲有關」、
  「用拍組組起來那個圖, 不要把人跟寶可夢分開」、「氛圍感的 3D 微微跟著滑鼠動」):
  看板每列的圖是**一組拍組不是兩張圖** (訓練家立繪當本體、寶可夢壓右下角 = 官方卡面的排法),
  背後 `app/home-pair-art.tsx` 再擺七張**真的 `SyncPairCard`** (同一個元件、同一份 catalog 紀錄)。
  四件別改壞的事:
  1. **深度不要用 `translateZ`** (踩過): 共用一個 perspective 時 translateZ 會把元素往消失點
     (畫面中央) 拉 —— 擺在 left:1.5% 的卡在 z=-560 會被拉到中間壓住文字, 位置完全不受控。
     現在每張卡自己一個 `perspective()` 自己轉, 深度由 scale/opacity/blur/視差位移量表達, 寫哪就在哪。
  2. **滑鼠視差走 CSS 變數 + rAF lerp**: 指標位置寫進 scene 的 `--mx/--my` (-1…1), 每張卡用自己的
     `par`/`deg` 換算 —— 近的位移大遠的小, 那個差就是空間感 (實測近 46-49px、中 23-26、遠 8-13)。
     追到位就 **cancel 掉 rAF**, 不要留一個永遠在跑的迴圈。
  3. **中央是挖空的** (radial mask), 所以無論視窗多寬字上面都不會有東西 —— 不要改成整片鋪滿。
  4. **手機/窄視窗整層不掛載** (`useMedia("(min-width: 768px)")` 直接 return null, 不是 CSS 隱藏):
     挖空那招靠的是四周有留白, 手機沒有; 而且 **display:none 的圖瀏覽器照樣會下載**,
     用 CSS 藏等於白花流量 (手機 75KB / 桌機 179KB 的差就是這樣來的)。
     滑鼠視差另外要求 `(pointer: fine)` —— 平板照樣看得到卡, 只是不跟著手指跑。
  用到的拍組**只能是已上市的**: 這一層是對外的, 未公布拍組的美術素材不能出現 ——
  所以 slot 一律用 pairId 去 `loadPairsForClient()` 的結果撈, **撈不到就不畫**。
- **成員頭像尺寸**: 名冊/一般清單用 md (44px), 排刀那種密集列用 28px — 不要再一邊 64 一邊 20。
- **道館拍組 ★ 只有一個開關**: 一律走 `setGymPair()` (`lib/gym/gym-pairs-client.ts`),
  文案固定「設為道館拍組 / 已設為道館拍組 (點擊取消)」。不要再做第二個搜尋新增面板 —
  要加名單就切到「全圖鑑」範圍點灰卡, 跟「所有拍組點灰卡點亮」同一個心智模型。
- **成員練度的寫入路徑只有一條**: 自己改走 `/pairs` (user_collection → syncMemberPair);
  管理員代改走 `set_member_pair` RPC (0030/0031) — 它會在成員已綁定帳號時**一併更新
  他的 user_collection**, 否則他下次自己一改就把代改的值蓋回去 (舊版就是這樣默默丟資料)。
- **圖鑑星級一律 `basePotential`** (原始星級); 個人升星只在「我的拍組」呈現。點亮不會自動 6★EX。
- **系列標籤每拍組唯一** (`SERIES_LABELS`); 判定在 `scripts/patch-pomatools-meta.mjs`, seasonal 必須先於 limited。
  徽章會蓋掉 series (有 11 隻掛大師徽章實為 BP 兌換) → 另存 `acquisitions[]` 全展開, 篩選兩邊都吃。
- **主角 (Player) 拍組**由 `add-protagonist-pairs.mjs` 補 (管線 4d, 在 meta patch 之後);
  形象固定用官方預設男主角 Scottie。datamine 的重複拍組用 `dedupe-catalog-pairs.mjs` 以 wiki 為準去重。
- **對外資料匯出**: `/api/export?key=` (唯讀)。金鑰**跟著人走** (profiles.export_token, 0037) —
  範圍 = 這個人加入的每一個道館 (成員/顧問都算) + 他自己的收藏, 不是一館一把鑰匙。
  不得輸出 email / auth uid; 這條路由必須在 proxy.ts 的 PUBLIC_ROUTES (它自己用金鑰授權)。
- **工具頁的文案**: 指引用 UI 完成 (可複製的指令、分頁、可展開的結構), 不要寫成教學文;
  名稱要像工具而不是口語 (「資料連線」而不是「給 AI 用的資料串接」)。
- **EX 裝 (目前 UI 已下架)**: 立繪呈現不對, 使用者要求先拔掉; 資料 (`exStyleWorn`/
  `exStyleImagePath`) 與圖檔都留著。要重啟時: 立繪路徑一律吃 catalog `exStyleImagePath`
  (不要用 trainerId 拼路徑 — 同名多變體會拼錯), `exStyleWorn` 依附 6★EX。
- **雙表同步**: `user_collection` 任何寫入都要經 `syncMemberPair()` (`src/lib/collection-sync.ts`) 同步
  `member_pairs`, 否則排刀/道館拍組頁看到舊資料。新增 `CollectionEntry` 欄位時三處都要接: collection.ts
  讀取、兩個 client 的 upsert、syncMemberPair。
- **糖果制度**是查證過的遊戲規則 (角色糖五種+通用黃糖+棒棒糖): **遊戲制度不確定時先上網查證, 不要自己設計**。
- `/gyms/[id]/*` 子頁**不要**自帶 SiteHeader/SiteFooter — layout.tsx 統一渲染。
- hover-only 控制項一律加 `pointer-coarse:opacity-100` (手機沒有 hover); 觸控目標 ≥44px。
- 手機側板 = bottom sheet (`ui/side-panel.tsx` 已處理, 新側板沿用該元件)。
- **使用者看得到的值一律繁中** — 資料層的英文值 (region 等) 顯示前必須過對照表
  (`REGION_LABELS`/`TYPE_LABELS`/`ROLE_LABELS`/`SERIES_LABELS`), 不要直出英文。
- **版面寬度一律 `PageShell`** (`components/page-shell.tsx`; wide/prose/form 三種) —
  SiteHeader/SiteFooter 在 root layout, 道館子頁的容器在 `gyms/[id]/layout.tsx`,
  子頁只回傳內容 + `PageHeading`。頁面自己包 `container`/`max-w-*` = 切分頁時寬度跳動 (前科)。
- **變化紀錄只記「成員身上發生的事」** (pair/candy/ticket/battle_log)。管理員的設定動作
  (道館名單、隊伍) 不記錄 (0030 已 drop trigger); 文案每種 kind 各自造句, 不要共用一個
  「沒有 new_value 就印紅字『移除』」的分支 — 那會讓五種不同的事長得一模一樣。
- **篩選一律用共用 `PairFilterBar`** (層級式: 搜尋+屬性 chips 常駐, 其餘收「進階篩選」;
  chips 多選, 同面向=或、面向間=且), 純邏輯在 `lib/pairs/filter.ts` — 不要再自刻篩選列。
- **卡片重圖一律延遲載入** (2026-08-19): SVG 的 `<image>` **不吃 `loading="lazy"`**, 所以走
  `lib/pairs/use-near-viewport.ts` (**一個 root 共用一顆 IntersectionObserver**, 進場即
  unobserve)。只延後「每張卡獨有的重圖」= 訓練家立繪 + 寶可夢圖; 星星/TYPE_/ROLE_/pairKind/
  sync_icon/ballground 是全站共用的幾十個小檔, 一律照舊立刻載。沒圖時 `href` 給 **undefined
  不是空字串** (空字串在部分瀏覽器 = 請求當前頁)。已載入就黏住不收回 (名次會隨篩選/排序變)。
  一定在畫面上的卡 (側板預覽 / 隊伍卡 / 已選槽位) 傳 `eager`; 自己捲的框 (PairPicker) 傳
  `scrollRoot`, 否則 rootMargin 擴張的是 viewport 不是那個框, 框內只會 pop-in。
  卡牆的 `eagerCount` 是**張數不是列數** (桌機 13 張/列、手機 3 張/列) — 調大等於在手機上
  先下載好幾個螢幕的圖。實測 /pairs 全圖鑑: 981 個重圖請求 / 14.7MB → 桌機 208 個 / 2.75MB、
  手機 93 個 / 1.04MB。
- **卡片的 `<defs>` 只有一份** (`components/sync-pair-defs.tsx`, 在 root layout 渲染一次):
  10 個固定 id (spc-clip-card / spc-clip-poke-circle|hex / spc-frame-3|4|5 / spc-bg-3|4|5 /
  spc-bg-ex)。**外框漸層只有 3 種** — 6★EX 不變框 (與「卡片外框不因 6★EX 變化」同一條);
  clipPath 的六角是 r=22, 卡面上直接畫的那個六角是 r=24, 兩者不同不要混。SidePanel portal
  到 document.body 仍在同一份 document, `url(#id)` 參照得到。
- **等待畫面一律骨架不是轉圈圈** (`components/skeletons.tsx` + globals.css 的
  `@utility skeleton`): 骨架要與真實版面**同構** (尺寸來源都記在 skeletons.tsx 檔頭),
  換頁時內容長出來才不會重排。骨架卡是 rounded-xl 灰塊, **不要去仿 SyncPairCard 的 SVG**
  (等於第二份卡片規格, 必然走鐘)。掃光動 `::after` 的 transform, 不動 background-position
  (一牆兩三百顆灰塊每 frame 重繪漸層會比不動還耗電); 節奏錯開走 `--skeleton-delay`。
  `loading.tsx` 的包法**兩種不可搞混**: 道館子頁只回傳內容 (main/PageShell/tabs 都在
  `gyms/[id]/layout.tsx`), `/pairs` 與 `/share` 的 page.tsx 自己包所以 fallback 要跟著包。
  **不要**替 `/`、`/gyms`、`/gyms/[id]`、`/welcome` 加 loading.tsx — 它們 await 完才 redirect,
  加了只會先串流出骨架再跳走 (redirect + loading 的老地雷)。
- **layout 不准 await 執行期資料**: layout 一 await, 導覽就整個 block 住, `loading.tsx` 的
  fallback 根本不會顯示 (Next 16 layout 文件「Interaction with loading.js」)。道館的導覽列
  資料在 `gyms/[id]/gym-nav.tsx`, 由 layout 用 `<Suspense fallback={<GymNavSkeleton/>}>` 串流;
  骨架高度必須等於真實那一列 (38px = border-b-2 + py-2 + text-sm), 否則資料到位時整頁彈一下。
  tabs 仍然只由 layout 這一條路徑渲染 — 抽成元件不等於搬進子頁。
- **線上的圖一律 `.webp`, PNG 只留在 repo** (2026-08-20): `scripts/convert-card-images.mjs`
  (q90 立繪/寶可夢、q92 UI, 一律 `alphaQuality:100` — alpha 走樣卡框內會出現白邊)。
  PNG **不刪但也不進版控** (2026-09-02, 為了公開 repo): 5,549 檔 / 94.8 MB 全是可重新產生的衍生檔,
  而線上供應的 WebP 只有 5.2 MB。本機檔案照舊存在, 辨識管線 (build-embeddings 讀 catalog 裡的 PNG 路徑)
  在本機仍然跑得動; 新 clone 要先跑 `npm run data:update` 才會有 PNG。部署端本來就由
  `public/.assetsignore` 擋掉 PNG, 不受影響。三條每一條都踩過的規則:
  1. **轉檔在管線最後一階 (5c)** — 會下載新圖的不只 stage 1, 4b (add-wiki-pairs) 與
     4d (add-protagonist-pairs) 也會寫 reference/trainer|pokemon 的 PNG。早跑就漏轉,
     而 PNG 不進部署 = 那些拍組線上是空卡。手動跑 fetch-wiki-trainer-images 之後也要補
     `npm run data:webp`。
  2. **只轉 catalog 指得到的**, 並清掉不再被指到的 `.webp` (只刪 webp 不刪 png) —
     trainer/pokemon 目錄有一千多張是 pairId remap/dedupe 的歷史殘留, 全轉的話部署圖片
     60% 是沒人會請求的孤兒。
  3. 糖果圖是唯一會 resize 的 (`CANDY_PX`, 現值 192 = 最大顯示 60px × DPR3)。
     **要放大糖果的顯示尺寸就要同步調大它, 不然會糊。**
  改副檔名要一起動的地方: sync-pair-card.tsx 的 11 條路徑、`typeIconUrl()`、candy.tsx。
  重啟 EX 立繪時三處要一起動 (三處都已就地留註解): 轉檔腳本的 TARGETS 加 trainer-ex、
  upload 頁的 trainer-ex 路徑、`.assetsignore` 拿掉那一行。少一步就是線上 EX 立繪全 404。
- **`public/.assetsignore` = 部署帶什麼的唯一開關** (實測 6573 檔/109.68MB → 1053 檔/5.08MB)。
  **加任何一行之前先全域 grep 確認 src/ 沒有引用** — 排錯一條線上就是 404 空圖, 而本機因為
  檔案還在完全看不出來。目前排除: opencv/、五個零引用的 reference 子目錄、trainer-ex/、
  以及已有 webp 的那四個目錄的 `*.png`。
- **還不能對外送的拍組: 兩條判準, 中任一條就擋** (`isUnreleasedPair()`, `lib/pairs/loader.ts`)。
  **A. 來源未收錄** (2026-08-21): `verifiedSources` 空 **且** `releaseDate` 為 null — 目前恰好 10 筆。
  **B. 還沒上架** (2026-09-01 補): `releaseDate` 晚於今天 (台北) — 目前 7 筆 (9/12~9/16)。
  加 B 的原因: fandom roster **會收 datamine 先行列**, reconcile 因此給了它們 `verifiedSources:["wiki"]`
  → A 一筆都擋不到, 那次更新有 7 筆官方還沒公布的拍組 (交叉查證 Bulbapedia 標 Datamined future release、
  官方公告隻字未提) 直接進了 `public/catalog/<指紋>.json` —— 那個檔由 Workers Assets 直送,
  訪客沒登入就抓得到。**這是收緊不是放寬** (禁止的是放寬); 已上市的拍組完全不受影響。
  過濾點**只有一個** — `loadPairsForClient()`, 它是所有對外輸出的唯一收口 (頁面 SSR / `/api/catalog` /
  產靜態檔的 emit 腳本全部經過它)。`loadPairs()` / `loadPairsById()` **刻意不濾** —— 它們只被
  「用 pairId 查既有資料」的地方用, 濾了只會讓萬一存在的收藏掉成灰字 pair_id。
  **判準 A 的兩個陷阱** (只用單一條件都會誤殺, 已驗證): 只看 `releaseDate` 為 null 會多殺已上市的
  劇情拍組; 只看 `series === "upcoming"` 會多殺已上市新拍組 (upcoming 是上架時間標記不是系列)。
  A 的實質語意是「**上游來源還沒收錄**」不完全等於「官方沒公布」→ 剛實裝但 pomatools/wiki 還沒跟上的
  新拍組會暫時被擋 (安全方向)。`npm run data:catalog` 每次都會**印出被擋下的清單並標明是哪一條**,
  「來源未收錄」裡出現已上市拍組時去重跑 `data:update` 讓來源補上, **不要放寬判準**。
  **B 是跟時間走的**: `loadPairsForClient()` 的快取以台北日期為 key, 上架當天 SSR 頁面會自己放行;
  但**靜態資產是建置時產的** → 上架日要重跑 `npm run data:catalog` 並重新部署, 「全圖鑑」才看得到
  (`tests/catalog-asset.test.ts` 會在那天自己變紅當提醒, 那是刻意的)。
  判準 A 那 10 筆用得到的圖檔 (4 個) 另外列進 `.assetsignore`; 與已上市拍組共用的圖**絕不能排除**。
  判準 B 擋下的拍組**刻意不進 `.assetsignore`** —— 它們每隔幾天就會上架, 忘記把行刪掉的代價
  (線上空卡) 比留著未被任何頁面引用的圖檔大得多。
  `tests/unreleased-pairs.test.ts` 是這條的迴歸防線。
- **PostgREST 一次最多 1000 列這條, 三個地方要一起維持分頁**: `battles/page.tsx` (跨全部賽事的
  `.in()`)、`battles/[battleId]/page.tsx` (單場 battle_logs)、`/api/export`。券上限可調到 99 且
  `reportBattleLog` 允許 0 張也插列, 所以**沒有硬上限** —— 單發 `.eq()` 會靜默截斷成「剛好
  1000 列」而不報錯 (已用實測推算: 20 人辦到第 4 場就會少算約 330 張券)。
  走 `fetchAllRows` 的查詢**一律要有穩定排序**才安全 (`.order("id")` 當決勝鍵): offset 分頁在
  讀取期間有人寫入會讓列位移, 邊界重複會讓「持有 N / 20 人」多算。`battle_stages` 的
  `seq` 跨賽事不唯一, 要 `.order("seq").order("id")`。
- **每一支 `security definer` 函式都要問「PostgREST 會不會把它當 RPC 曝出來」** (0050/0051):
  Postgres 對函式的 EXECUTE **預設 grant 給 PUBLIC**, 而 Supabase 的 default privileges 另外
  明授給 anon/authenticated → `revoke ... from public` **是無效的**, 一律要寫
  `from public, anon, authenticated` 三個角色 (前科: 0030 對 set_member_pair 寫過 revoke,
  今天查 ACL 仍是 `anon=X`)。另一個前科是**簽章換掉時 revoke 沒跟著搬** (0040 把 join_gym 改成
  單參數 = 全新物件 = 重新套用 default privileges)。
  **不可以收的**: RLS policy 條件式裡用到的 `is_gym_member` / `is_gym_admin` / `is_gym_editor` /
  `member_in_gym` (policy 以呼叫端角色評估, 收掉整站讀不到資料), 以及分享頁要給未登入者用的
  `get_share_meta` / `get_shared_collection`。
  收 `log_activity` 之前務必確認呼叫它的 trigger 函式是 `security definer` 且 owner 保有
  EXECUTE —— trigger 失敗會讓整個 INSERT rollback, 出刀回報/券數/糖果會全部寫不進去。
- **安全標頭寫在 `next.config.ts` 的 `headers()` 不是 `public/_headers`**: 後者只作用在
  **靜態資產命中的回應**, 而頁面 HTML 是 Worker 動態產的。`_headers` 裡第二次設同一個 key 是
  **append 不是覆蓋**, 所以不要在 `/*` 寫 Cache-Control。CSP 只上 `frame-ancestors`/`base-uri`/
  `form-action`/`object-src` —— 完整 CSP 會被 Next 的 inline script (next-themes 防閃爍、
  `__next_f` flight 資料) 打掛。
- **DevOps 的決策脈絡在 `docs/devops.md`** (成本模型、colo=SJC 的實測、RLS 34 倍、
  訊號驅動的階段路線圖、PowerShell 操作手冊)。要動託管/資料庫/規模相關的決定前先讀那份。
- **完整 645 筆 catalog 只有 PairPicker 勾「全圖鑑」時才載** (`/api/catalog?v=<CATALOG_VERSION>`):
  teams / battle 頁只送「道館名單 ∪ 已在隊伍裡」的子集 (464KB → 約 50KB)。三件事不能漏:
  子集一定要是**兩邊的聯集** (少了名單候選池是空的, 少了隊伍裡的卡會掉成灰字 pair_id);
  `useCatalogWithFullFallback(subset, { ids, fullCatalogUrl })` 的 `ids` 要傳, 別人在你開著頁面時
  加了名單外的拍組才會自動補抓; 抓失敗一律**留在原本的候選池不可以變空白**
  (「入口還在但功能斷掉」是點名過的前科)。
  `CATALOG_VERSION` 的指紋**要含投影形狀** (CLIENT_PAIR_FIELDS + 衍生欄位) —— 那條路由是
  `private, immutable` 快取一年, 只改欄位清單不改 catalog JSON 的話 URL 不會換, 使用者會被
  鎖在舊投影上。新增衍生欄位記得加進 loader.ts 的 `SHAPE`。
- **靜態資產的快取在 `public/_headers`** (Workers Assets 預設是 `max-age=0, must-revalidate`):
  `/_next/static/*` 給 immutable (檔名帶內容雜湊), `/reference/*` 給 30 天且**刻意不給
  immutable** (圖檔名是 actorId 沒雜湊, scrape 重跑會覆寫同名檔)。**絕對不要寫 `/*`**
  或去蓋頁面 HTML 的 `private, no-cache, no-store`。open-next 會把 public/ 整包複製過去,
  部署腳本不用改。
- **卡牆的 memo 要真的有效**: `PairTypeGrid` 有 grid 級的 `onSelect`/`onCount` (收 GridItem.key)
  就是為此 — 呼叫端傳 inline 箭頭函式 = 645 張卡的 memo 全部失效, 每按一鍵跑兩次全量 render
  (useDeferredValue 也會一起白做)。GridItem 自己的 onClick/onCountClick 留著給「圖鑑未收錄
  拍組」那條純文字按鈕當 fallback。
- **賽事狀態由賽期日期推導** (`battleStatusFromDates`, 台北時區): 沒到開賽日=籌備中,
  過結束日=已結束, 其間=進行中 — **沒有手動狀態下拉**;「目前輪」同樣由 battle_logs
  的最大已回報輪推導。gym_battles.status / current_round 已 drop (0047)。單場看板
  頂部列: 賽事切換 / 改名 (鉛筆) / 狀態 badge / 日期 (管理員直接改) + 挑戰券 /
  對戰紀錄 / 刪除賽事 — 輪次選單/特規/備註/剩券數字/自動排刀都已拔
  (assign.ts 演算法留著, 無入口)。
- **排刀整套已下線 (0047)**: stage_assignments / stage_plan_pairs / battle_round_rules
  三張表已 drop (殘料備份在 ref/archive-legacy-fix-2026-08-18.json), battle_stages 的
  leader_name/rule/rule_block/team_id、battle_logs 的 round_label/notes、
  user_collection 的 move_level/sync_level、gym_members.avatar_pair_id 一併 drop。
  重做排刀/特規時重建 schema, 不要復活這些欄位名。
- **挑戰券 = 「剩餘 / 上限」** (0043): 預設 30/30 從上限往下扣 (館內用法是「這場總共 30 刀」,
  不用官方 9+3/日記法), 上限可 ± (模擬用; 降上限會夾住剩餘)。寫入一律走
  `adjust_member_ticket(p_delta, p_cap_delta)` 原子 RPC, 不要 client 算絕對值回寫。
  燈號三列 (`TeamFitRows`) 是純檢視 — 點頭像預排刀已拔掉, 不要加回點擊寫入。
- **新增對戰紀錄只有一條路** (`reportBattleLog`, `lib/gym/battle-log.ts`): 看板輪次列的
  Swords (自己出刀, 要選主力/降抗) 與 + (管理員幫成員記) 跟對戰紀錄側板都走它
  (插 battle_logs + round_label 派生 + 自動扣券)。排刀 (stage_assignments) 已無新增入口,
  舊資料只剩虛線籤顯示。輪次用詞一律 `roundLabel()` (R1-R3 / Ex1…); 每關每輪的敘述在
  `stage_round_notes` (0044/0045, 管理員可編, 顯示不截斷)。有成員出現的地方一律
  頭像 + `memberLabel` (`MemberAvatar`/`MemberOption`)。

## 資料管線 (src/data/pomatools-pairs.json)

單一 catalog 來源, 由 scripts 依序產生: `scrape-brybry.mjs` (拍組+圖) → `patch-pomatools-meta.mjs`
(日期/徽章/系列) → `enrich-pomatools-exstyle.mjs` (EX 資料)。全部冪等可重跑。名稱比對地雷已內建防護, 改動比對邏輯前先讀:

- **在地化名稱檔要跟結構檔一起更新** (`fetch-brybry-proto.mjs` 已含 lsd 的 6 個名稱檔):
  變體拍組的全名只存在 `trainer_verbose_name_*` (鍵 = pairId), 缺了就**退回本尊的名字** —
  2026-08 就這樣讓「阿爾套裝卡露妮 & 沙奈朵」變成「卡露妮 & 沙奈朵」(與 2021 年的本尊撞名,
  還被 reconcile 依名字把本尊的超覺醒旗標抄過來); 而**沒有英文名的整筆會被 scrape 丟掉**,
  當時有 5 對拍組 (山葵/蕾荷/生彩/蓋伊/鎯琊_01) 因此不見, 只好用 wiki 佔位 id 補。
- **超覺醒的唯一權威是 `TrainerSpecialAwaking.json`** (datamine, 124 筆), scrape 直接寫進 `hasAwakening`;
  pomatools 的 `dateAwakening` 會落後 → reconcile 的 FILL_FIELDS **不准**再放 hasAwakening
  (前科: 杜若 & 鋁鋼橋龍 明明能超覺醒卻被洗成 false)。
- **`number === 111` 是劇情/NPC 版**, scrape 直接跳過 — 它們跟真正可抽的 `_01` 拍組同名
  (鎯琊 & 胡帕 曾同時存在三筆, 還留錯成 NPC 那筆)。
- **pairId 換掉時要跑 `scripts/remap-pair-ids.mjs`** (預設 dry-run, `--apply` 才寫雲端):
  佔位 id 讓位、或收錯版本改收正確版本時, 成員收藏/道館名單會指到不存在的拍組。
  對照表放 `src/data/pair-id-remap.json`。
- **datamine 撞名**: brybry 新拍組名稱未本地化時 (阿爾套裝卡露妮的 EN 名只是 "Diantha") 會與本體同名,
  直接吃 name-key 會整包繼承本體的系列/日期 → `_9x` 高階變體撞名時只接受帶前綴條目。
- **化名角色** (`EN_ALIASES`): brybry 用本尊名、pomatools 用官方化名 (皇家假面/貝魯芭/哈奇庫超人/小克)。
- **`RELEASED_OVERRIDES`**: pomatools 落後期間, 已實裝新拍組依官方新聞手動指定 (收錄後可移除)。
- 形態修飾詞前後都可能出現 (Alolan Raichu / Lycanroc Midday) → 雙向包含比對取最長重疊。
- wiki 日期 fallback 的欄位在 `wiki.roster` (不是 `wiki.sixEx`)。
- 稽核工具: 對 catalog↔pomatools↔wiki 做日期交叉與反向漏配掃描 (歷史版本在 scratchpad/series-audit.mjs);
  反向清單中的進化型列與 Player 主角拍組是 by design 不收。

## 地雷 (都踩過, 別再踩)

- **CRLF**: repo 檔案可能是 CRLF, node 取代腳本先 `\r\n→\n` 再比對。
- **PostgREST `onConflict` 不能引用 expression unique index** (如 `coalesce(round,-1)`) → 用 delete-then-insert
  並以 `.select()` 回傳筆數做誠實 toast。
- **Workers 部署有傳播延遲**: 部署後立刻 probe 可能打到舊版, 等幾秒重試再判定。
- **`redirect()` + `app/loading.tsx` = streaming**: 純 fetch 只會拿到「載入中」shell (200);
  驗證導向要帶 `RSC: '1'` header 看 307。SSR 文字比對要先去掉 React 的 `<!-- -->`。
- **wrangler OAuth token 會過期**: deploy 失敗時請使用者重跑 `npx wrangler login` (互動式), 不要自己重試。
- migrations 是 `setup-supabase.mjs` 對雲端 DATABASE_URL 直跑; 新 migration 記得跑一次並確認 `✓ committed`。
- E2E 驗證登入頁: scratchpad 的 render-probe 模式 (service key `generateLink(magiclink)` + `verifyOtp` 合成 cookie)。
- 開發環境是 Windows PowerShell 5.1 — 無 `&&`, heredoc 用 `@'...'@`。
- **線上資料庫就是正式資料**: probe/驗證腳本只能讀, 要寫也只能寫「自己的列」且寫回同一個值。
  不要拿其他成員試寫入 (曾把某成員的寶5 洗成寶1 再刪列, 事後才發現並手動還原)。

## 安全紅線

- **`ref/` 永不進 git** (LINE 記錄、成員 email; .gitignore 已擋, 不要解除)。
- `.env.local`、`.cloudflare-token` 不 commit; token 不貼進對話或文件。
- login redirect 參數只接受 `/` 開頭且非 `//` (防 open redirect), 改 auth 流程時保持此檢查。
