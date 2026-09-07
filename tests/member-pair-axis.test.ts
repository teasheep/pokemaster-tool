// 道館視角的側板 (`PairEditPanel` 的 `gymView`) 為什麼與「我的拍組」有差 —— 釘住**理由**。
//
// 差別不是 UI 偏好, 是資料決定的, 兩件事各有各的原因:
//   - **星數不顯示**: member_pairs 沒有 promotion 欄位, 而 user_collection 的 RLS 是
//     own-rows only → 別人的星數全站讀不到。畫出來只會是 defaultEntry 的預設值。
//   - **等級唯讀**: 0057 之後 member_pairs 有 level 鏡像了 (所以看得到), 但代改走的
//     `set_member_pair` 不收 level → 畫成可點的下拉就是「改了不會存」。
// 任何一條變了 (例如有人替 RPC 加了 p_level), 這支測試會變紅提醒你回頭放寬 gymView。
//
// 讀 migration SQL 再與程式碼對照 —— 與 tests/type-focus.test.ts 同一套做法。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * member_pairs **現在**有哪些欄位 = 建表 (0005) + 後來 alter 加的
 * (0018 ex_style_worn / 0023 super_awakening / 0057 level)。只看建表會漏掉後加的。
 * 回傳欄位名的集合 —— 用子字串比對會被 `super_awakening` 裡的 `awakening` 之類坑到。
 */
function memberPairsColumns(): Set<string> {
  const dir = path.join(root, "supabase/migrations");
  const cols = new Set<string>();

  const create = read("supabase/migrations/0005_gyms.sql");
  const start = create.indexOf("create table public.member_pairs");
  expect(start, "找不到 member_pairs 的建表 SQL").toBeGreaterThan(-1);
  for (const line of create.slice(start, create.indexOf(");", start)).split("\n").slice(1)) {
    const m = /^\s{2}([a-z_]+)\s/.exec(line);
    if (m) cols.add(m[1]!);
  }

  for (const f of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of sql.matchAll(
      /alter table public\.member_pairs\s+add column\s+(?:if not exists\s+)?([a-z_]+)/gi
    )) {
      cols.add(m[1]!);
    }
  }
  return cols;
}

describe("道館視角的側板與資料層必須對得起來 (PairEditPanel 的 gymView)", () => {
  const cols = memberPairsColumns();

  it("掃得到欄位 (掃不到代表這個測試自己壞了)", () => {
    expect(cols.size).toBeGreaterThan(5);
    expect(cols).toContain("grade");
    expect(cols).toContain("super_awakening");
  });

  it("**member_pairs 沒有 promotion** — 這就是道館側板不畫星數的原因", () => {
    expect(cols).not.toContain("promotion");
  });

  it("**member_pairs 有 level** (0057 的鏡像) — 所以道館看得到等級", () => {
    expect(cols).toContain("level");
  });

  it("等級的鏡像由 syncMemberPair 寫入 (代改那條不會動它)", () => {
    const sync = read("src/lib/collection-sync.ts");
    expect(sync, "syncMemberPair 沒有把 level 寫進 member_pairs").toMatch(/level/);
  });

  it("set_member_pair 只收 (member, pair_id, pair_label, potential, super_awakening)", () => {
    const sql = read("supabase/migrations/0038_grade_axis_awakening_levels.sql");
    const start = sql.indexOf("create or replace function public.set_member_pair");
    expect(start).toBeGreaterThan(-1);
    const sig = sql.slice(start, sql.indexOf(")", start));
    for (const p of ["p_member", "p_pair_id", "p_pair_label", "p_potential", "p_super_awakening"]) {
      expect(sig, `少了參數 ${p}`).toContain(p);
    }
    // 收得了就代表代改能寫等級了 → 回頭讓道館側板的等級變成可編輯
    expect(sig, "RPC 現在收得了等級 — 道館側板的等級可以開放編輯了").not.toContain("p_level");
    expect(sig, "RPC 現在收得了星數 — gymView 該放寬了").not.toContain("p_promotion");
  });

  it("道館成員頁的側板一定要開 gymView (不然會拿預設值冒充別人的星數)", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(client).toContain("<PairEditPanel");
    expect(client, "道館側板少了 gymView").toContain("gymView");
  });

  it("道館側板走 set_member_pair — 不可以直接寫 user_collection (RLS 只讓人寫自己的)", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(client).toContain("set_member_pair");
    expect(client, "道館頁不該直接寫 user_collection").not.toContain('from("user_collection")');
  });

  it("★ 開關的文案兩個側板逐字相同 (AGENTS 定死的用字)", () => {
    for (const f of [
      "src/components/pair-edit-panel.tsx",
      "src/app/gyms/[id]/pairs/pairs-client.tsx",
    ]) {
      const text = read(f);
      expect(text, `${f} 的 ★ 開關文案`).toContain('"已設為道館拍組"');
      expect(text, `${f} 的 ★ 開關文案`).toContain('"設為道館拍組"');
      expect(text, `${f} 的取消提示`).toContain('"點擊取消"');
      // 舊的第二種說法 (帶星號的按鈕標籤); 註解裡寫「設為 / 取消道館拍組」不算
      expect(text, `${f} 還留著舊文案`).not.toContain("★ 取消道館拍組");
    }
  });
});
