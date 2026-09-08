// 查詢字串的純函式 —— **這支不可以標 "use client"**。
//
// 前科 (2026-09-08): 本來把它跟 `useUrlState` 放在同一個 "use client" 檔案裡,
// 於是 server component 的 `page.tsx` 一呼叫就整頁炸掉:
//   「Attempted to call pickParam() from the server but pickParam is on the client.」
// 讀初始值的是 server (page.tsx 拿 searchParams), 寫網址的是 client (hook) ——
// 兩邊共用的東西就得放在中立的檔案裡。

/** 把查詢字串的值收斂成允許的選項之一; 不認得就回預設 (使用者可以手改網址, 不能因此壞掉) */
export function pickParam<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(v as T) ? (v as T) : fallback;
}
