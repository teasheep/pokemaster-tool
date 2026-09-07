// 道館視角的側板 (`PairEditPanel` 的 `gymView`) 為什麼與「我的拍組」有差 —— 釘住**理由**。
//
// 差別不是 UI 偏好, 是資料決定的, 兩件事各有各的原因:
//   - **星數不顯示**: member_pairs 沒有 promotion 欄位, 而 user_collection 的 RLS 是
//     own-rows only → 別人的星數全站讀不到。畫出來只會是 defaultEntry 的預設值。
//   - **等級看得到也改得動**: 0057 補了 member_pairs.level 鏡像, 0058 讓 set_member_pair
//     收 p_level (**null = 不要動** —— 左下角的寶數循環不傳它, 才不會把人家設好的等級洗掉)。
// 哪天 RPC 也收了 p_promotion, 這支測試會變紅提醒你回頭把星數那格打開。
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

  it("等級的鏡像由 syncMemberPair 寫入 (本人自己改那條)", () => {
    const sync = read("src/lib/collection-sync.ts");
    expect(sync, "syncMemberPair 沒有把 level 寫進 member_pairs").toMatch(/level/);
  });

  it("set_member_pair 收得了 p_level (0058) —— 但仍然沒有 p_promotion", () => {
    const sql = read("supabase/migrations/0058_set_member_pair_level.sql");
    const start = sql.indexOf("create or replace function public.set_member_pair");
    expect(start).toBeGreaterThan(-1);
    const sig = sql.slice(start, sql.indexOf(")", start));
    for (const p of ["p_member", "p_pair_id", "p_pair_label", "p_potential", "p_super_awakening"]) {
      expect(sig, `少了參數 ${p}`).toContain(p);
    }
    expect(sig, "代改要能寫等級").toContain("p_level");
    // 收得了就代表資料層支援星數了 → 回頭把 gymView 的星數那格打開
    expect(sig, "RPC 現在收得了星數 — gymView 該放寬了").not.toContain("p_promotion");
  });

  it("**p_level 一定要有 default, 而且 null = 不要動** (左下角循環不傳它)", () => {
    const sql = read("supabase/migrations/0058_set_member_pair_level.sql");
    // 沒有 default 的話, 舊的五參數呼叫 (寶數循環) 會直接叫不到這支函式
    expect(sql).toMatch(/p_level\s+int\s+default\s+null/i);
    // coalesce(v_level, 既有值) = 沒傳就保留 —— 少了這個, 管理員每點一次左下角
    // 就把那位成員設好的等級洗成 1
    expect(sql).toContain("coalesce(v_level, public.member_pairs.level)");
    expect(sql).toContain("coalesce(v_level, public.user_collection.level)");
  });

  it("**簽章換掉要先 drop 舊的** (0040 的前科: 舊那支會留著, 而且權限會重新放寬)", () => {
    const sql = read("supabase/migrations/0058_set_member_pair_level.sql");
    expect(sql).toContain("drop function if exists public.set_member_pair(uuid, text, text, int, int)");
    // 新簽章要照 0051 重收一次權限 (只 revoke public 是無效的, 一定要含 anon)
    expect(sql).toMatch(/revoke all on function public\.set_member_pair\([^)]*\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.set_member_pair\([^)]*\) to authenticated/);
  });

  it("RPC 認可的等級與程式碼的 LEVEL_OPTIONS 是同一組", async () => {
    const { LEVEL_OPTIONS } = await import("@/lib/collection-entry");
    const sql = read("supabase/migrations/0058_set_member_pair_level.sql");
    expect(sql).toContain(`p_level in (${LEVEL_OPTIONS.join(", ")})`);
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
