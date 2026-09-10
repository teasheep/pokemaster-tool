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

// ── 紀錄的合併與過濾 (純函式, 沒有 DOM/React) ──
//
// 放在這個中立檔案而不是 activity-client.tsx: 那個檔標了 "use client" 且 import 了
// 一整串元件, 測試沒辦法只拿這幾個函式。**這裡照舊不可以標 "use client"** (見檔頭)。

export type ActivityRow = {
  id: string;
  member_id: string | null;
  actor_id: string | null;
  kind: string;
  target: string | null;
  target_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

/**
 * 同一個人、同一個東西在短時間內連點多次 (寶0 一路點到超覺5 = 11 筆) 只留一列:
 * 起點取最舊的 old_value, 終點取最新的 new_value。
 *
 * ⚠ **不能只比對「上一列」** (2026-09-10 使用者:「紀錄也讓文字合理, 不然使用者覺得奇怪」)。
 * 舊版只跟 `out` 的最後一筆比, 所以中間夾了別的東西就併不起來 ——
 * 實際發生的例子: 草地人在 44 秒內把五種糖各點了幾下, 排出來是
 * 「技術×5, 支援×5, 衝刺, 支援(5→6), 技術(5→6), 場地, 通用×6」;
 * 那兩筆單獨的 5→6 跟同一種糖前面那一串**不相鄰**, 於是各自留成一列,
 * 畫面上就是一句沒頭沒尾的「技術糖 5 個 → 6 個」—— 使用者看到的正是這個。
 * 改成用 (成員, 種類, 對象) 當 key 去找**這一組已經開好的那一列**, 中間隔了什麼都能併。
 *
 * 順帶治好另一個症狀: 糖果的寫入曾經會互相超車 (見 candy.tsx 的 useMyCandies),
 * 留下 1→4 / 5→7 這種跳號; 併成一列之後那些中間過程本來就不會出現在畫面上。
 */
export const MERGE_WINDOW_MS = 30 * 60 * 1000;

export function mergeRuns(rows: ActivityRow[]): ActivityRow[] {
  const out: ActivityRow[] = [];
  /** (成員|種類|對象) → 這一組在 out 的位置 + 目前最舊的時間 (rows 是新到舊) */
  const open = new Map<string, { at: number; oldest: number }>();
  for (const r of rows) {
    const key = `${r.member_id}|${r.kind}|${r.target}`;
    const t = new Date(r.created_at).getTime();
    const hit = open.get(key);
    // 與這一組目前最舊的那一筆比 —— 一步一步往回接, 中斷超過視窗才另起一列
    if (hit && hit.oldest - t < MERGE_WINDOW_MS) {
      out[hit.at] = { ...out[hit.at], old_value: r.old_value };
      hit.oldest = t;
      continue;
    }
    open.set(key, { at: out.length, oldest: t });
    out.push(r);
  }
  return out;
}

/**
 * 併完之後**起點與終點一樣** = 誤點了又馬上改回來, 預設不顯示
 * (2026-09-10 使用者:「有時候誤點然後馬上改回來… 好像就不需要顯示,
 *  或者要更詳細的資料再顯示就可以」)。
 * 資料**不會刪**, 只是收起來 —— 想查「他到底點了什麼」時按一下就攤開。
 */
export function isNoop(r: ActivityRow): boolean {
  return (r.old_value ?? "") === (r.new_value ?? "");
}
