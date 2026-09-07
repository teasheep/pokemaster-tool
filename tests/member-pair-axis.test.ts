// 道館代改別人的拍組時「只有寶數/超覺醒那一條軸」—— 這條的**理由**要釘住。
//
// `PairEditPanel` 的 `gradeOnly` 不是 UI 偏好, 是資料的必然結果:
//   1. `member_pairs` 沒有 promotion / level 兩欄;
//   2. `set_member_pair` RPC 不收這兩個參數;
//   3. `user_collection` 的 RLS 是 own-rows only, 管理員讀不到別人的星數/等級。
// 三條裡任何一條變了 (例如有人替 RPC 加了 p_level), gradeOnly 就該跟著放寬 ——
// 這支測試變紅就是那個提醒。反過來, 有人把星數/等級搬進道館側板卻沒動資料層時,
// 畫面會拿 defaultEntry 的預設值 (5★ / Lv200) 冒充別人的練度, 而且改了不會存。
//
// 讀 migration SQL 再與程式碼對照 —— 與 tests/type-focus.test.ts 同一套做法。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * member_pairs 這張表**現在**有哪些欄位 = 建表 (0005) + 後來 alter 加的
 * (0018 ex_style_worn / 0023 super_awakening)。只看建表會漏掉後加的欄位。
 */
function memberPairsColumns(): string {
  const dir = path.join(root, "supabase/migrations");
  const create = read("supabase/migrations/0005_gyms.sql");
  const start = create.indexOf("create table public.member_pairs");
  expect(start, "找不到 member_pairs 的建表 SQL").toBeGreaterThan(-1);
  let cols = create.slice(start, create.indexOf(");", start));
  for (const f of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of sql.matchAll(/alter table public\.member_pairs\s+add column[^;]*;/gi)) {
      cols += "\n" + m[0];
    }
  }
  return cols;
}

describe("道館代改只有寶數/超覺醒這條軸 (PairEditPanel 的 gradeOnly)", () => {
  it("member_pairs 存的是 grade + super_awakening", () => {
    const cols = memberPairsColumns();
    expect(cols).toContain("grade");
    expect(cols).toContain("super_awakening");
  });

  it("**member_pairs 沒有 promotion / level** — 這就是道館側板收起那兩格的原因", () => {
    const cols = memberPairsColumns();
    expect(cols).not.toContain("promotion");
    // 「level」要避開 super_awakening 之類的字中字, 用欄位定義的形狀比對
    expect(cols).not.toMatch(/^\s*level\s/im);
  });

  it("set_member_pair 只收 (member, pair_id, pair_label, potential, super_awakening)", () => {
    const sql = read("supabase/migrations/0038_grade_axis_awakening_levels.sql");
    const start = sql.indexOf("create or replace function public.set_member_pair");
    expect(start).toBeGreaterThan(-1);
    const sig = sql.slice(start, sql.indexOf(")", start));
    for (const p of ["p_member", "p_pair_id", "p_pair_label", "p_potential", "p_super_awakening"]) {
      expect(sig, `少了參數 ${p}`).toContain(p);
    }
    // 加了這兩個就代表資料層支援了 → 回頭把 gradeOnly 放寬
    expect(sig, "RPC 現在收得了等級 — gradeOnly 該放寬了").not.toContain("p_level");
    expect(sig, "RPC 現在收得了星數 — gradeOnly 該放寬了").not.toContain("p_promotion");
  });

  it("道館成員頁的側板一定要開 gradeOnly (不然會拿預設值冒充別人的練度)", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(client).toContain("<PairEditPanel");
    expect(client, "道館側板少了 gradeOnly").toContain("gradeOnly");
  });

  it("道館側板走 set_member_pair — 不可以直接寫 user_collection (RLS 只讓人寫自己的)", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(client).toContain("set_member_pair");
    expect(client, "道館頁不該直接寫 user_collection").not.toContain('from("user_collection")');
  });

  it("★ 開關的文案兩個側板逐字相同 (AGENTS 定死的用字)", () => {
    for (const f of ["src/components/pair-edit-panel.tsx", "src/app/gyms/[id]/pairs/pairs-client.tsx"]) {
      const text = read(f);
      expect(text, `${f} 的 ★ 開關文案`).toContain('"已設為道館拍組"');
      expect(text, `${f} 的 ★ 開關文案`).toContain('"設為道館拍組"');
      expect(text, `${f} 的取消提示`).toContain('"點擊取消"');
      // 舊的第二種說法 (帶星號的按鈕標籤); 註解裡寫「設為 / 取消道館拍組」不算
      expect(text, `${f} 還留著舊文案`).not.toContain("★ 取消道館拍組");
    }
  });
});
