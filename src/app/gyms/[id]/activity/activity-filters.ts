// 道館紀錄的篩選值域與標籤 —— **這支不可以標 "use client"**。
//
// 前科 (2026-09-08 的 pickParam, 2026-09-10 這裡又踩了一次): 這幾個常數本來放在
// activity-client.tsx (標了 "use client") 裡, server 端的 page.tsx 一 import 就拿到
// client reference 而不是真的陣列 →
//   「TypeError: allowed.includes is not a function」
// 而且 tsc 與 lint 都不會擋, 只有真的開頁面才看得到 (整頁掛掉)。
// 讀初始值的是 server (page.tsx 拿 searchParams), 用它畫 chips 的是 client ——
// 兩邊共用的東西就得放在中立的檔案裡。

/** 類型篩選的合法值 (chips 的順序也是這一份) */
export const ACTIVITY_KINDS = ["pair", "candy", "ticket", "battle_log", "gym_pair", "all"] as const;

/**
 * 「全部」實際上要撈哪幾種 —— 就是有 trigger 在記的那些。
 * gym_pair 是 0068 加回來的 (0030 曾停掉); 隊伍 (team) 刻意沒有加回來。
 */
export const ACTIVITY_LOGGED_KINDS = ["pair", "candy", "ticket", "battle_log", "gym_pair"] as const;

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  pair: "拍組練度",
  candy: "背包",
  ticket: "挑戰券",
  battle_log: "對戰紀錄",
  gym_pair: "道館拍組",
};

/** 日期範圍: 幾天內 ("all" = 不限, "custom" = 自己選區間) */
export const ACTIVITY_RANGES = ["7", "30", "90", "all", "custom"] as const;

export const ACTIVITY_RANGE_LABELS: Record<string, string> = {
  "7": "近 7 天",
  "30": "近 30 天",
  "90": "近 90 天",
  all: "全部",
  custom: "自訂",
};

/** YYYY-MM-DD 才收 (使用者可以手改網址, 亂填不能讓頁面壞掉) */
export function pickDate(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
