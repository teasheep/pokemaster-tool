// 成員「拍組最後更新」的兩種講法 (2026-11-05 使用者:「側邊欄…用區間來顯示
// 但點進去以後還是會有精確的更新日期和時間」)。時間來源見 0086 (帳號那一份, 不是道館的鏡像)。
//
// ⚠ 中立模組, **不可以標 "use client"** —— page.tsx 與測試都要直接 import 它
// (與 activity-filters / compare-params 同一條規矩)。
//
// 兩件刻意的事:
//   1. **「幾天前」用台北的日曆日算, 不是 24 小時一格**: 昨晚 23:50 改的, 今天早上看是「1 天前」,
//      不是「今天」—— 對人來說那就是昨天。台北沒有日光節約, 固定 +8 小時就好, 不靠執行環境的時區。
//   2. **現在時間由 server 給** (page.tsx 的 Date.now()), 不在 client render 裡取 ——
//      兩邊各取一次的話, 剛好跨過午夜那一刻 SSR 與 hydration 的字會對不起來。
//      精確時間也是自己排版, 不用 toLocaleString (Node 與瀏覽器的 ICU 排出來的字不一定一樣)。

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const taipeiDay = (ms: number) => Math.floor((ms + TAIPEI_OFFSET_MS) / DAY_MS);

/** 台北日曆日差幾天 (今天 = 0)。讀不到時間回 null */
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, taipeiDay(nowMs) - taipeiDay(t));
}

/**
 * 名冊第二行: 今天 / 1–6 天前 / 1–3 週前 / 30 / 60 / 90 天前。
 * 一週以上就只講區間 —— 「17 天前」跟「14 天前」對「這個人多久沒更新了」是同一個答案。
 */
export function pairsUpdatedAgo(iso: string | null | undefined, nowMs: number): string | null {
  const days = daysSince(iso, nowMs);
  if (days === null) return null;
  if (days === 0) return "今天更新";
  if (days < 7) return `${days} 天前更新`;
  if (days < 30) return `${Math.floor(days / 7)} 週前更新`;
  if (days < 60) return "30 天前更新";
  if (days < 90) return "60 天前更新";
  return "90 天前更新";
}

/**
 * 這一次請求的「現在」—— **只給 server 的 page.tsx 用** (force-dynamic, 一次請求畫一次)。
 * client 元件不要呼叫它: 那正是上面第 2 點要避免的事。
 */
export function requestNowMs(): number {
  return Date.now();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 精確時間 (台北): 2026/11/04 21:58 */
export function formatTaipeiDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + TAIPEI_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
