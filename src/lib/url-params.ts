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

const firstOf = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

/**
 * uuid → 網址用的短碼 (去掉連字號取前 8 碼)。一頁裡要同時記好幾個 id 時用
 * (20 個人寫全名是 740 個字, 網址貼到賴群會長成一大串)。
 * 同一份清單裡撞號的機率可以不計; 真的撞了也只是多選到一個, 不會壞掉。
 */
export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase();

/**
 * 「一組被選中的 id」的網址值 → 短碼清單。
 * `null` = 網址沒帶 (呼叫端用自己的預設); `[]` = 明確清空 ("none")。
 * 只收 16 進位短碼, 其餘丟掉 (使用者可以手改網址, 不能因此壞掉)。
 */
export function parseShortIds(raw: string | string[] | undefined): string[] | null {
  const v = firstOf(raw);
  if (typeof v !== "string") return null;
  if (v === "none") return [];
  return [...new Set(v.split(",").map((s) => s.trim().toLowerCase()))].filter((s) =>
    /^[0-9a-f]{4,32}$/.test(s)
  );
}

/** 短碼 → 完整 id (照 `ids` 的順序; 對不到的短碼直接略過) */
export function resolveShortIds(short: readonly string[], ids: readonly string[]): string[] {
  const want = new Set(short);
  return ids.filter((id) => want.has(shortId(id)));
}

/**
 * 寫回網址。等於預設就不留; 全部取消寫成 none ——
 * 否則重新整理會被當成「沒帶 = 預設」又選回預設那一組。
 */
export function serializeShortIds(ids: Iterable<string>, defaults: Iterable<string>): string | null {
  const a = [...new Set(ids)];
  const d = new Set(defaults);
  if (a.length === d.size && a.every((id) => d.has(id))) return null;
  return a.length ? a.map(shortId).join(",") : "none";
}

/** 「第幾個」的清單 (1 起算, 例如看板收起來的第 2、5 關) → 數字; 沒帶就是空的 */
export function parsePositions(raw: string | string[] | undefined, max: number): number[] {
  const v = firstOf(raw);
  if (typeof v !== "string") return [];
  const out = new Set<number>();
  for (const s of v.split(",")) {
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

export function serializePositions(ns: Iterable<number>): string | null {
  const sorted = [...new Set(ns)].sort((x, y) => x - y);
  return sorted.length ? sorted.join(",") : null;
}
