// 背包的寫入順序, 與道館紀錄怎麼把它講成人話 (2026-09-10)。
//
// 使用者:「背包會有預設的糖果數字嗎? 應該都是 0 吧。為什麼 9/9 草地人會從 5→6?
//          是記錄問題還是預設問題?」以及「紀錄也讓文字合理, 不然使用者覺得奇怪」。
//
// 查出來的兩件事:
//   1. **不是預設問題** —— member_candies.count 的 DB 預設是 0, 沒有任何種子資料。
//   2. **是記錄問題**, 而且有兩層:
//      (a) 舊版每按一次就送一個**絕對值** upsert, 連點時五六個請求同時在飛,
//          HTTP 不保證到達順序 → 線上 277 筆糖果異動裡有 7 筆跳號 (1→4 / 5→7 / 第一筆就是 3),
//          而且最後存下來的數字有機會少一格 (雷歐 2026-09-10: 畫面 7 / 資料庫 6, 持續 5 秒)。
//      (b) 紀錄的合併只比對「上一列」, 中間夾了別的東西就併不起來 —— 於是畫面上留下
//          一句沒頭沒尾的「技術糖 5 個 → 6 個」, 那正是使用者看到的東西。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isNoop,
  mergeRuns,
  type ActivityRow,
} from "@/app/gyms/[id]/activity/activity-filters";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** 草地人 2026-09-09 那 44 秒的真實紀錄 (由舊到新; 時間是台北時間) */
const REAL: [string, string | null, string, string][] = [
  ["tech", null, "3", "05:16:30.692"],
  ["tech", "3", "2", "05:16:30.693"],
  ["tech", "2", "1", "05:16:30.867"],
  ["tech", "1", "4", "05:16:31.004"],
  ["tech", "4", "5", "05:16:31.460"],
  ["support", null, "1", "05:16:34.936"],
  ["support", "1", "2", "05:16:35.195"],
  ["support", "2", "3", "05:16:35.328"],
  ["support", "3", "4", "05:16:35.466"],
  ["support", "4", "5", "05:16:35.660"],
  ["sprint", null, "1", "05:16:39.565"],
  ["support", "5", "6", "05:16:49.264"],
  ["tech", "5", "6", "05:16:52.354"],
  ["field", null, "1", "05:16:55.621"],
  ["universal", null, "1", "05:17:13.048"],
  ["universal", "1", "2", "05:17:13.240"],
  ["universal", "2", "3", "05:17:13.461"],
  ["universal", "3", "4", "05:17:13.670"],
  ["universal", "4", "5", "05:17:13.983"],
  ["universal", "5", "6", "05:17:14.340"],
];

/** 頁面拿到的順序是**新到舊** (query 是 order created_at desc) */
const rows: ActivityRow[] = REAL.map(([target, oldV, newV, t], i) => ({
  id: String(i),
  member_id: "草地人",
  actor_id: "草地人",
  kind: "candy",
  target,
  target_id: null,
  old_value: oldV,
  new_value: newV,
  created_at: `2026-09-09T${t}+08:00`,
})).reverse();

describe("道館紀錄要把一串連點講成一句話", () => {
  const merged = mergeRuns(rows);

  it("五種糖各一列, 不是七列", () => {
    // 舊版只比對上一列 → 「支援 5→6」與「技術 5→6」跟同一種糖前面那一串不相鄰,
    // 於是各自留成一列, 畫面上就是兩句沒頭沒尾的「5 個 → 6 個」。
    expect(merged.length, merged.map((m) => `${m.target} ${m.old_value}→${m.new_value}`).join(" / ")).toBe(5);
  });

  it("每一列都是「從 0 開始」到最後的值", () => {
    const byTarget = Object.fromEntries(merged.map((m) => [m.target, m]));
    for (const [target, end] of [
      ["tech", "6"],
      ["support", "6"],
      ["universal", "6"],
      ["sprint", "1"],
      ["field", "1"],
    ] as const) {
      expect(byTarget[target].old_value, `${target} 的起點`).toBeNull();
      expect(byTarget[target].new_value, `${target} 的終點`).toBe(end);
    }
  });

  it("**跳號的中間過程不會出現在畫面上**", () => {
    // 1→4 / 3→2 那些是請求互相超車留下的, 併成一列之後本來就看不到
    const shown = merged.map((m) => `${m.old_value}→${m.new_value}`);
    expect(shown).not.toContain("1→4");
    expect(shown).not.toContain("5→6");
    expect(shown).not.toContain("3→2");
  });

  it("中斷超過視窗就另起一列 (不是無條件全部併掉)", () => {
    const far: ActivityRow[] = [
      { ...rows[0], id: "z", target: "tech", old_value: "6", new_value: "7", created_at: "2026-09-09T09:00:00+08:00" },
      ...rows,
    ];
    const m = mergeRuns(far);
    expect(m.filter((r) => r.target === "tech").length).toBe(2);
  });

  it("誤點又改回來 (起點=終點) 照舊算 noop", () => {
    expect(isNoop({ ...rows[0], old_value: "3", new_value: "3" })).toBe(true);
    expect(isNoop({ ...rows[0], old_value: "3", new_value: "4" })).toBe(false);
  });
});

describe("紀錄的文案", () => {
  const src = read("src/app/gyms/[id]/activity/activity-client.tsx");

  it("糖果沒有起點時要印「0 個」不是留空", () => {
    // 留空的話畫面只印一個孤零零的「6 個」, 看不出來是從哪裡變過來的
    expect(src).toMatch(/from: a\.old_value \? `\$\{a\.old_value\} 個` : "0 個"/);
  });
});

describe("背包的寫入", () => {
  const src = read("src/components/gym/candy.tsx");

  it("連點要合併 (同一種糖 450ms 內只送最後一個值)", () => {
    expect(src).toContain("useCoalescedWrite");
  });

  it("**還要排隊** — 只有合併的話, 跨視窗的兩趟還是可能後到先至", () => {
    expect(src).toContain("queues");
    expect(src).toMatch(/queues\.current\.get\(key\) \?\? Promise\.resolve\(\)/);
  });

  it("gymId / memberId 走 payload 不走閉包", () => {
    // 這支 hook 的 memberId 會變 (管理員換人看), 而 useCoalescedWrite 記住的是最新那顆 flush
    // → 用閉包的話, 換人當下還在等的那一筆會寫到**新的那個人**身上。
    expect(src).toMatch(/type CandyWrite = \{ gymId: string; memberId: string;/);
    expect(src).toMatch(/gym_id: w\.gymId, member_id: w\.memberId/);
  });

  it("畫面照舊是樂觀更新 (合併的只有網路那一段)", () => {
    expect(src).toMatch(/setCounts\(\(prev\) => \(\{ \.\.\.\(prev \?\? \{\}\), \[type\]: next \}\)\)/);
  });
});

describe("activity-filters 仍然是中立模組", () => {
  it("不可以標 use client — page.tsx 要 import 它 (整頁掛掉的前科)", () => {
    expect(
      read("src/app/gyms/[id]/activity/activity-filters.ts").trimStart().startsWith('"use client"')
    ).toBe(false);
  });
});
