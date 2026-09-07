// 使用教學進行中 —— **所有寫入都不進資料庫**
// (2026-09-07 使用者:「不要叫做練習, 就叫做教學。我的意思就是連建立賽事也不要,
//  教學完不要留著這些資料, 這樣才一致合理」)。
//
// 規則就一條, 沒有例外: 教學開著的時候, 對 Supabase 的寫入一律吞掉。
// 之前是只有標了「練習」的步驟才吞 —— 那條規則有兩個問題:
//   1. 不一致: 同一段教學裡有些動作會留下資料 (例如按下「建立賽事」會真的開一場),
//      使用者事後得自己去清;
//   2. 很難察覺: 哪幾步會寫、哪幾步不會, 畫面上看不出來。
//
// 攔在哪: `lib/supabase/client.ts` 建 browser client 時注入的 fetch。
// **刻意不改任何寫入路徑** —— 全站的寫入都經過 syncMemberPair / RPC 那幾條,
// 在那裡加「如果在教學就跳過」等於在核心路徑上長出一個教學專用的分支,
// 而那種分支就是「為什麼我的資料沒存到」這類 bug 的溫床 (AGENTS: 寫入路徑只有一條)。
// 攔在 fetch 的好處是: 應用程式碼一行都不知道有這回事, 樂觀更新照跑, 畫面照變,
// 只是那一趟 HTTP 沒有真的送出去。
//
// 判斷在 request 當下才做 —— 呼叫端普遍把 client 用 useMemo 記住, 所以不能在建立
// client 的當下決定, 否則教學開始前建好的 client 就攔不到。
//
// 只吞 `/rest/v1/` 與 `/storage/v1/` 的非 GET 請求:
//   - `/auth/v1/` **絕對不能吞** —— token 刷新是 POST, 吞掉就是把人登出。
//   - 讀取一律是 GET (PostgREST), 所以不會誤傷。

let blocked = false;
let swallowed = 0;

/** 開/關教學模式。開的時候歸零計數 */
export function setTourWritesBlocked(on: boolean) {
  blocked = on;
  if (on) swallowed = 0;
}

export function tourWritesBlocked(): boolean {
  return blocked;
}

/**
 * 這一輪吞掉了幾次寫入 —— 教學結束時用它決定要不要重新載入,
 * 把畫面上那些「看起來改了但沒存」的樂觀更新清掉。
 */
export function swallowedWrites(): number {
  return swallowed;
}

/** 這個網址 + 方法要不要吞掉 */
export function shouldSwallow(url: string, method: string): boolean {
  if (!blocked) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  return url.includes("/rest/v1/") || url.includes("/storage/v1/");
}

/**
 * 呼叫端有沒有要求「剛好一列」(`.single()` / `.maybeSingle()`)。
 * PostgREST 用 Accept 標頭表達, supabase-js 會帶 `application/vnd.pgrst.object+json`。
 */
function wantsSingleRow(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  const accept =
    headers instanceof Headers
      ? headers.get("Accept")
      : Array.isArray(headers)
        ? headers.find(([k]) => k.toLowerCase() === "accept")?.[1]
        : (headers as Record<string, string>).Accept ??
          (headers as Record<string, string>).accept;
  return typeof accept === "string" && accept.includes("pgrst.object");
}

/** 錯誤訊息會被呼叫端原樣 toast 出來, 所以這句話要自己講得清楚 */
export const TOUR_WRITE_MESSAGE = "使用教學進行中 — 這個操作不會存進資料庫";

/**
 * 假的回應。**兩種形狀, 差別很重要**:
 *
 * - 一般寫入 (沒有 `.single()`): 回空陣列 = 成功。樂觀更新留在畫面上、不跳錯誤 toast,
 *   使用者點卡片左下角調寶數的手感與平常一模一樣。
 * - 要求剛好一列的寫入 (`.single()`): **必須回錯誤**。這種呼叫端拿到列之後會用裡面的
 *   id 繼續做事 —— 例如「建立賽事」會 `router.push(.../battles/<id>)`。
 *   回假的成功會把人導到一個不存在的賽事 (比失敗還糟), 回空陣列則會變成看不懂的
 *   「建立失敗」。所以直接給一句說得清楚的錯誤, 呼叫端原樣 toast 出來就是正確的說明。
 */
export function swallowResponse(init?: RequestInit): Response {
  swallowed += 1;
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  if (wantsSingleRow(init?.headers)) {
    return json({ message: TOUR_WRITE_MESSAGE, code: "TOUR_MODE" }, 400);
  }
  return json([], 200);
}
