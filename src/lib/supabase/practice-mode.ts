// 練習模式 —— 使用教學讓使用者「自己點點看」時, 把寫入吞掉不要真的存進資料庫
// (2026-09-07 使用者:「不要把教學加的內容寫進資料庫」)。
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
//   - RPC 是 POST, 教學期間不該有唯讀 RPC 被呼叫 (查過: /pairs 與成員頁都走 select)。

let blocked = false;
let swallowed = 0;

/** 開/關練習模式。開的時候歸零計數 (每一段練習各自算) */
export function setWritesBlocked(on: boolean) {
  blocked = on;
  if (on) swallowed = 0;
}

export function writesBlocked(): boolean {
  return blocked;
}

/** 這一輪吞掉了幾次寫入 —— 教學結束時用它決定要不要提醒使用者「剛剛的調整沒有存檔」 */
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
 * 假的成功回應。PostgREST 對「沒有 .select() 的寫入」本來就回空陣列/204,
 * 所以回 `[]` 對呼叫端而言就是 `{ data: [], error: null }` —— 不會跳錯誤 toast。
 */
export function swallowResponse(): Response {
  swallowed += 1;
  return new Response("[]", {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
