// 道館的成員拍組: **數值記錄**與**卡面長相**是兩件事 —— 這支測試釘住那條界線。
//
// 2026-09-07 使用者:「之前的規則指的是長相, 但跟數值可以先分開。我們可以記錄每個人幾星,
// 但只顯示在內頁, 不影響拍組的圖鑑畫面。」所以:
//   - **記錄**: member_pairs 有 level (0057) 與 promotion (0059) 兩個鏡像,
//     兩條寫入路徑都要維持 (本人走 syncMemberPair, 代改走 set_member_pair);
//   - **內頁 (側板)**: 照實顯示這位成員的等級與星數, 兩個側板長得一模一樣
//     (所以 PairEditPanel 不再需要任何「道館版」的旗標);
//   - **圖鑑畫面 (卡牆)**: 道館頁**不准**把個人星數餵進 GridItem —— 卡一律畫原始星級。
//     這條沒有徵兆 (只是卡上的星星悄悄變了), 只能靠測試擋。
//
// 另一條紅線: RPC 的 p_level / p_promotion **null = 不要動** —— 左下角的寶數循環不傳它們,
// 否則管理員每點一次就把人家設好的 Lv200 / 6★EX 洗掉。
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

/** 最新那支 set_member_pair 的定義 (簽章一路加參數, 認最後一支) */
function latestSetMemberPair(): { sql: string; sig: string } {
  const dir = path.join(root, "supabase/migrations");
  let found: string | null = null;
  for (const f of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    if (sql.includes("create or replace function public.set_member_pair")) found = sql;
  }
  expect(found, "找不到 set_member_pair 的定義").not.toBe(null);
  const sql = found!;
  const start = sql.indexOf("create or replace function public.set_member_pair");
  return { sql, sig: sql.slice(start, sql.indexOf(")", start)) };
}

describe("道館成員拍組: 記錄什麼 vs 畫成什麼", () => {
  const cols = memberPairsColumns();

  it("掃得到欄位 (掃不到代表這個測試自己壞了)", () => {
    expect(cols.size).toBeGreaterThan(5);
    expect(cols).toContain("grade");
    expect(cols).toContain("super_awakening");
  });

  it("**member_pairs 有 level 與 promotion 的鏡像** — 道館才看得到成員的練度", () => {
    expect(cols).toContain("level");
    expect(cols).toContain("promotion");
  });

  it("兩個鏡像由 syncMemberPair 寫入 (本人自己改那條路徑)", () => {
    const sync = read("src/lib/collection-sync.ts");
    expect(sync, "syncMemberPair 沒寫 level").toMatch(/level/);
    expect(sync, "syncMemberPair 沒寫 promotion").toMatch(/promotion/);
  });

  it("set_member_pair 收得了 p_level 與 p_promotion (代改那條路徑)", () => {
    const { sig } = latestSetMemberPair();
    for (const p of ["p_member", "p_pair_id", "p_pair_label", "p_potential", "p_super_awakening"]) {
      expect(sig, `少了參數 ${p}`).toContain(p);
    }
    expect(sig, "代改要能寫等級").toContain("p_level");
    expect(sig, "代改要能寫星數").toContain("p_promotion");
  });

  it("**p_level / p_promotion 一定要有 default, 而且 null = 不要動** (左下角循環不傳)", () => {
    const { sql } = latestSetMemberPair();
    // 沒有 default 的話, 少傳參數的呼叫會直接叫不到這支函式
    expect(sql).toMatch(/p_level\s+int\s+default\s+null/i);
    expect(sql).toMatch(/p_promotion\s+int\s+default\s+null/i);
    // coalesce(值, 既有值) = 沒傳就保留 —— 少了這個, 管理員每點一次左下角
    // 就把那位成員設好的 Lv200 / 6★EX 洗掉
    expect(sql).toContain("coalesce(v_level, public.member_pairs.level)");
    expect(sql).toContain("coalesce(v_level, public.user_collection.level)");
    expect(sql).toContain("coalesce(v_promo, public.member_pairs.promotion)");
    expect(sql).toContain("coalesce(v_promo, public.user_collection.promotion)");
  });

  it("**簽章換掉要先 drop 舊的** (0040 的前科: 舊那支會留著, 而且權限會重新放寬)", () => {
    for (const f of [
      "supabase/migrations/0058_set_member_pair_level.sql",
      "supabase/migrations/0059_member_pairs_promotion.sql",
    ]) {
      const sql = read(f);
      expect(sql, `${f} 沒有 drop 舊簽章`).toMatch(
        /drop function if exists public\.set_member_pair\([^)]*\)/
      );
      // 新簽章要照 0051 重收一次權限 (只 revoke public 是無效的, 一定要含 anon)
      expect(sql, `${f} 沒重收權限`).toMatch(
        /revoke all on function public\.set_member_pair\([^)]*\) from public, anon/
      );
      expect(sql, `${f} 沒重新 grant`).toMatch(
        /grant execute on function public\.set_member_pair\([^)]*\) to authenticated/
      );
    }
  });

  it("RPC 認可的等級與程式碼的 LEVEL_OPTIONS 是同一組", async () => {
    const { LEVEL_OPTIONS } = await import("@/lib/collection-entry");
    const { sql } = latestSetMemberPair();
    expect(sql).toContain(`p_level in (${LEVEL_OPTIONS.join(", ")})`);
  });

  it("兩個側板現在是同一顆, 沒有任何「道館版」旗標", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    const panel = read("src/components/pair-edit-panel.tsx");
    expect(client).toContain("<PairEditPanel");
    // gymViewMembers 是無關的既有變數 (全館視角的成員清單), 別誤傷
    const flag = /\bgymView\b(?!Members)/;
    expect(panel, "PairEditPanel 又長出道館專用分支了").not.toMatch(flag);
    expect(client, "道館頁又傳了道館專用旗標").not.toMatch(flag);
  });

  it("**卡牆不准畫個人星數** — 圖鑑畫面一律原始星級 (使用者: 只顯示在內頁)", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    // 只看組 GridItem 的那段 (側板的 entryOf 本來就該帶 promotion, 那是內頁)
    const m = /const items = useMemo<GridItem\[\]>\([\s\S]*?\n {2}\}, \[/.exec(client);
    expect(m, "找不到卡牆的 items —— 這個測試自己壞了").not.toBe(null);
    // GridItem 的 promotion 一旦被填, 整面卡牆的星星就會變成那個人的個人升星
    expect(m![0], "道館卡牆把個人星數餵進 GridItem 了").not.toContain("promotion");
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
