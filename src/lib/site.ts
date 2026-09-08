/**
 * 站台層級的常數 —— metadata / robots / sitemap 三處共用一份。
 *
 * 網址寫死不吃 env: 這個站只有一個正式網域 (`wrangler.jsonc` 的 custom domain),
 * 而 `metadataBase` 錯了的症狀是「OG 圖與 canonical 指到 localhost」——
 * 那種錯只有在別人分享連結時才看得到, 從 env 讀反而多一個會忘記設的地方。
 * 真的要多環境時再改成讀 env, 但要連 CI 的 secrets 一起加。
 */
export const SITE_URL = "https://pokemaster-tool.com";

export const SITE_NAME = "教練休息室";

/**
 * 對外的一句話。這是 Google 搜尋結果與 LINE 分享卡片會顯示的那一段,
 * 所以講的是「這是什麼、給誰用」, 不是功能清單。
 */
export const SITE_DESCRIPTION =
  "Pokémon Masters EX 的道館戰協作工具：全館拍組持有一目了然，道館戰的出刀與挑戰券即時同步，不用再開串手動統計。";

/** 分享卡片的圖 (1200×630) —— 由 scripts/make-og-image.mjs 產生 */
export const OG_IMAGE = "/og.png";

/**
 * 開源程式庫 (MIT, 見 repo 的 LICENSE 與 NOTICE)。
 *
 * **這是本服務唯一的對外聯絡管道** —— 沒有客服信箱, 隱私權政策與服務條款的
 * 「聯絡方式」都指向這裡, 頁尾也連過去。所以網址只寫一份:
 * 哪天 repo 改名或搬家, 漏改其中一頁的症狀是「法遵頁上的聯絡方式是死連結」,
 * 那正是 Google OAuth 審核會看的東西 (`tests/seo.test.ts` 釘住兩頁都要指到它)。
 */
export const REPO_URL = "https://github.com/teasheep/pokemaster-tool";

/** 提 issue 的直接入口 —— 功能建議、bug 回報走這裡 (公開) */
export const REPO_ISSUES_URL = `${REPO_URL}/issues`;

/**
 * 作者的聯絡信箱 (使用者 2026-09-08 指定)。
 *
 * **兩個管道是分工不是備援**: issue 是公開的, 所以「要求刪除帳號與資料」這種
 * 必然要講到自己是誰的事一律走 email; 功能建議與 bug 則走 issue (公開討論才有意義)。
 * 隱私權政策與服務條款都照這個分工寫, 改一邊記得改另一邊。
 *
 * 這個位址也是 Google Cloud Console 那邊 OAuth 同意畫面的支援信箱 ——
 * 審核會比對「政策上寫的聯絡方式」與「同意畫面填的」, 兩邊一致比較不會被退。
 */
export const CONTACT_EMAIL = "eric990262@gmail.com";

/**
 * 私密頁的 metadata —— 直接展開到頁面的 `export const metadata`。
 *
 * `robots.txt` 已經把這些路徑 Disallow 了, 但兩個機制擋的東西不一樣:
 * Disallow 是「不要來抓」(網址本身仍可能被收錄), `noindex` 是「抓了也不要收錄」。
 * 需要登入的頁其實兩個都不太可能出事, 真正要緊的是 `/share/<token>` ——
 * 那個網址有人拿得到, 所以兩層都要。統一用同一份, 免得漏掉哪一頁。
 */
export const NOINDEX = {
  robots: { index: false, follow: false },
  // 順手清掉從 root layout 繼承來的 canonical —— 一個 noindex 的頁還宣告
  // 「我的正規網址是首頁」是互相矛盾的訊號 (而且會被當成想把權重灌給首頁)。
  alternates: { canonical: null },
} as const;
