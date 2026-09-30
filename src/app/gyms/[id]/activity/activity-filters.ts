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
export const ACTIVITY_KINDS = ["pair", "candy", "ticket", "battle_log", "gym_pair", "member", "all"] as const;

/**
 * 「全部」實際上要撈哪幾種 —— 就是有 trigger 在記的那些。
 * gym_pair 是 0068 加回來的 (0030 曾停掉); 隊伍 (team) 刻意沒有加回來。
 * member (人員異動: 申請 / 放行 / 拒絕 / 改角色 / 移出 / 離開) 是 0079 加的。
 */
export const ACTIVITY_LOGGED_KINDS = ["pair", "candy", "ticket", "battle_log", "gym_pair", "member"] as const;

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  pair: "拍組練度",
  candy: "背包",
  ticket: "挑戰券",
  battle_log: "對戰紀錄",
  gym_pair: "道館拍組",
  member: "人員",
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
    // 人員異動**一筆一列, 不合併**: 「放行 → 升成管理員」是兩個人可能做的兩件事,
    // 併起來就丟掉了中間那一步是誰做的 (而那正是這一類紀錄存在的理由)
    const key = r.kind === "member" ? r.id : `${r.member_id}|${r.kind}|${r.target}`;
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
 * 一次撈幾筆**原始**紀錄。PostgREST 單發最多回 1000 列 (AGENTS「讀全量要分頁」),
 * 所以一頁一定要小於它, 再多就走 `.range()` 往後翻。
 *
 * ⚠ **「還有沒有下一頁」一律看原始筆數, 不可以看合併後的列數** (2026-09-26 使用者:
 * 「為什麼道館紀錄剩下這麼少? 我現在只看的到 3 筆」)。舊版撈 100 筆 → mergeRuns →
 * 拿**合併後**的長度去比 100: 蓉與 Opal 9/24 凌晨一小時內改了 100 筆練度, 併完只剩
 * 64 列 (< 100), 於是「載入更多」不見了, 近 30 天 1478 筆裡畫面只剩 3 組, 而且沒有任何
 * 往下翻的路。資料庫一筆都沒少 —— 正是「合併」這個功能本身讓判斷失準。
 */
export const ACTIVITY_PAGE_SIZE = 500;

/** 這一頁撈滿了 = 後面可能還有 (撈不滿就是到底了) */
export function pageHasMore(page: readonly unknown[]): boolean {
  return page.length >= ACTIVITY_PAGE_SIZE;
}

/**
 * 把下一頁接在後面。offset 分頁在翻頁期間有人寫入時列會位移, 邊界那幾筆會重複出現
 * (AGENTS「走 fetchAllRows 的查詢一律要有穩定排序」同一件事) → 以 id 去重。
 */
export function appendPage(prev: ActivityRow[], page: ActivityRow[]): ActivityRow[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...page.filter((r) => !seen.has(r.id))];
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

// ── 人員異動 (kind = 'member', 0079) 的句子 ──

const ROLE_LABELS: Record<string, string> = { admin: "管理員", member: "成員", advisor: "顧問" };

/** 'status:role' → 拆開 (null = 那一列不存在; 'self' 只會出現在刪除的 new_value) */
function parseMemberState(v: string | null): { status: string; role: string } | null {
  if (!v || !v.includes(":")) return null;
  const [status, role] = v.split(":");
  return { status: status!, role: role! };
}

/**
 * 一筆人員異動 → 一句話的三段: 主詞 (誰做的) / 動作 / 受詞 (對誰) / 補充。
 * subject = "actor" 表示主詞是操作者, "target" 表示主詞是那位成員自己 (申請 / 取消 / 離開 ——
 * 這幾種操作者就是他本人, 而他那時候多半還不在名冊上, 用名冊回查會查不到)。
 */
export function memberSentence(a: Pick<ActivityRow, "old_value" | "new_value">): {
  subject: "actor" | "target";
  verb: string;
  object: boolean;
  tail: string;
} {
  const before = parseMemberState(a.old_value);
  const after = parseMemberState(a.new_value);
  const role = (s: { role: string } | null) => (s ? (ROLE_LABELS[s.role] ?? s.role) : "");
  if (!before && after) {
    return after.status === "pending"
      ? { subject: "target", verb: "申請加入", object: false, tail: `（${role(after)}）` }
      : { subject: "target", verb: "加入道館", object: false, tail: `（${role(after)}）` };
  }
  if (before && !after) {
    const self = a.new_value === "self";
    if (before.status === "pending") {
      return self
        ? { subject: "target", verb: "取消了加入申請", object: false, tail: "" }
        : { subject: "actor", verb: "拒絕了", object: true, tail: "的加入申請" };
    }
    return self
      ? { subject: "target", verb: "離開了道館", object: false, tail: `（原本是${role(before)}）` }
      : { subject: "actor", verb: "把", object: true, tail: `移出道館（原本是${role(before)}）` };
  }
  if (before && after) {
    if (before.status === "pending" && after.status !== "pending") {
      return { subject: "actor", verb: "放行", object: true, tail: `加入（${role(after)}）` };
    }
    if (before.role !== after.role) {
      return { subject: "actor", verb: "把", object: true, tail: `從${role(before)}改成${role(after)}` };
    }
  }
  return { subject: "actor", verb: "變更了", object: true, tail: "的身分" };
}
