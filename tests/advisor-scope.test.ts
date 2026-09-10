// 顧問的練度不屬於這一館 (0072)。
//
// 2026-09-10 使用者:「理論上是看不到顧問的拍組的才對吧? 顧問互相也不應該看得到對吧?
// 那個顯示是不是可以顯示得清楚一點」—— 對, 而且 0028 定義顧問時漏了三張表。
//
// 三種壞法, 全部**沒有徵兆**:
//   1. 顧問用 /pairs 記練度 → 鏡射進 member_pairs → 全館 (含其他顧問) 看得到他的拍組。
//   2. 那些列進了持有率的**分子**, 而分母不含顧問 → 「持有 20 / 19 人」,
//      側板還會冒出一顆沒有頭像、名字是「?」的晶片。
//   3. 管理員把成員降級成顧問, 舊的 member_pairs 留著 (**刻意不刪**, 改回成員時要回得來),
//      於是第 2 條今天就按得到。
//
// ⚠ 0072 是**把 0069 的 set_member_pair 原文複製過來再插一句 guard** 產生的,
//   所以這裡有一條在比對「除了那一句以外一個字都沒變」—— 複製 113 行的函式而
//   把拍檔石盤上限 (0067) 或 coalesce (0069) 抄掉, 就是把兩個修好的 bug 放回去。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const M0072 = read("supabase/migrations/0072_advisor_not_in_roster.sql");
const M0069 = read("supabase/migrations/0069_sync_grid_insert_null.sql");

/** 從一份 migration 取出 set_member_pair 的整段原文 */
function fnBody(sql: string): string {
  const s = sql.replace(/\r\n/g, "\n");
  const at = s.indexOf("create or replace function public.set_member_pair(");
  const end = s.indexOf("\n$$;", at);
  if (at < 0 || end < 0) throw new Error("找不到 set_member_pair");
  return s.slice(at, end + 4);
}

describe("member_counts_in_gym", () => {
  it("顧問與待確認的都不算道館的一員", () => {
    expect(M0072).toMatch(
      /create or replace function public\.member_counts_in_gym\(p_member uuid\)/
    );
    expect(M0072).toMatch(/role in \('admin', 'member'\) and status = 'active'/);
  });

  it("是 security definer + 釘死 search_path (policy 會呼叫它)", () => {
    const at = M0072.indexOf("create or replace function public.member_counts_in_gym");
    const body = M0072.slice(at, M0072.indexOf("$$;", at));
    expect(body).toContain("security definer");
    expect(body).toContain("search_path = public");
  });
});

describe("三張成員資料表的寫入", () => {
  // 紅了怎麼辦: 0028 當初只把 is_gym_editor 加到 battle_logs / member_tickets /
  // stage_assignments, 這三張漏了。兩個條件擋的是兩件不同的事 ——
  // is_gym_editor 擋「顧問拿自己的帳號寫別人」, member_counts_in_gym 擋「寫到顧問那一列上」。
  const TABLES = ["member_pairs", "member_candies", "member_type_focus"] as const;

  for (const t of TABLES) {
    it(`${t}_insert 兩個條件都要有`, () => {
      const at = M0072.indexOf(`create policy "${t}_insert"`);
      expect(at, `0072 沒有重建 ${t}_insert`).toBeGreaterThan(0);
      const policy = M0072.slice(at, M0072.indexOf(");", at));
      expect(policy).toContain("public.member_counts_in_gym(member_id)");
      expect(policy).toContain("public.is_gym_editor(gym_id)");
    });
  }

  for (const t of ["member_pairs", "member_candies"] as const) {
    it(`${t}_update 兩個條件都要有`, () => {
      const at = M0072.indexOf(`create policy "${t}_update"`);
      expect(at).toBeGreaterThan(0);
      const policy = M0072.slice(at, M0072.indexOf("\n\n", at));
      expect(policy).toContain("public.member_counts_in_gym(member_id)");
      expect(policy).toContain("public.is_gym_editor(gym_id)");
    });
  }

  it("**每一條 create policy 前面都要有對應的 drop policy if exists**", () => {
    // permissive policy 是 OR 起來的 —— 名字打錯就變成「舊的寬鬆那條還在」,
    // 新條件等於完全沒有作用, 而且畫面上一點徵兆都沒有。
    for (const m of M0072.matchAll(/create policy "([^"]+)" on public\.(\w+)/g)) {
      expect(M0072, `${m[1]} 少了 drop policy`).toContain(
        `drop policy if exists "${m[1]}" on public.${m[2]};`
      );
    }
  });

  it("**delete 刻意不加限制**", () => {
    // 兩個理由: 降級成顧問之後管理員仍要清得掉舊列; 而且 syncMemberPair 在寶0 時
    // 走的就是 delete —— 擋掉會讓「點回未持有」變成靜默失敗。
    expect(M0072).not.toMatch(/create policy "member_pairs_delete"/);
    expect(M0072).toMatch(/delete \*\*不加限制\*\*/);
  });
});

describe("set_member_pair 也要自己擋一次", () => {
  // 它是 security definer, **RLS 對它無效** —— 上面那幾條 policy 一條都攔不到它。
  it("權限檢查後面多一句 member_counts_in_gym", () => {
    const body = fnBody(M0072);
    expect(body).toContain("if not public.member_counts_in_gym(p_member) then");
    const perm = body.indexOf("沒有權限修改這位成員的拍組");
    const guard = body.indexOf("member_counts_in_gym(p_member)");
    expect(guard, "guard 要在權限檢查之後").toBeGreaterThan(perm);
  });

  it("**除了那一句以外, 與 0069 的原文一字不差**", () => {
    // 0072 是把 0069 的函式整段複製過來的。抄的時候把 0067 的
    // `v_grid_cap := v_pot` 或 0069 的 `coalesce(v_grid, 0)` 弄掉, 就是把兩個
    // 修好的 bug 放回去 —— 而症狀只是「卡牆上悄悄多一顆 62 的徽章」。
    const stripped = fnBody(M0072).replace(
      /\n {2}-- 0072:[\s\S]*?if not public\.member_counts_in_gym\(p_member\) then\n {4}raise exception '[^']*';\n {2}end if;\n/,
      "\n"
    );
    expect(stripped).toBe(fnBody(M0069));
  });

  it("0067 的上限與 0069 的 coalesce 都還在 (上面那條的白話版)", () => {
    const body = fnBody(M0072);
    expect(body).toContain("v_grid_cap := v_pot;");
    expect(body).toContain("least(coalesce(v_grid, 0), v_grid_cap)");
  });
});

describe("持有率只算正式成員", () => {
  const page = read("src/app/gyms/[id]/members/page.tsx");

  it("索引與 memberIds 都吃 members, 不是 memberList", () => {
    expect(page).toContain("const memberIndex = new Map(members.map((m, i) => [m.id, i]));");
    expect(page).toContain("memberIds: members.map((m) => m.id)");
    expect(page, "用 memberList 就會把顧問算進分子").not.toContain(
      "memberIds: memberList.map((m) => m.id)"
    );
  });

  it("memberList 還在 — 名冊本身要列出顧問 (只是不進統計)", () => {
    expect(page).toContain("const memberList = [...members, ...advisors];");
    expect(page).toMatch(/members=\{memberList\.map/);
  });
});

describe("顧問的個人收藏不鏡射進道館", () => {
  it("/pairs 對顧問把 memberId 設成 null", () => {
    const src = read("src/app/pairs/page.tsx");
    expect(src).toContain('memberId: active.role === "advisor" ? null : active.memberId,');
    // gymId 照舊給 —— 側板的「☆ 已是道館拍組」是全館的名單, 不是他的資料
    expect(src).toContain("gymId: active.gymId,");
  });

  it("syncMemberPair 沒 memberId 就直接不動 (這條是上面那招成立的前提)", () => {
    expect(read("src/lib/collection-sync.ts")).toContain("if (!gym?.memberId) return;");
  });
});

describe("畫面講清楚", () => {
  const client = read("src/app/gyms/[id]/members/members-client.tsx");

  it("點到顧問顯示說明, 不是一面空的卡牆", () => {
    expect(client).toContain('selected.role === "advisor" ? (');
    expect(client).toContain("<AdvisorPanel member={selected}");
    // 說明要講到重點: 唯讀 / 不佔名額 / 這裡沒有他的資料
    const at = client.indexOf("function AdvisorPanel");
    const body = client.slice(at, at + 2000);
    expect(body).toContain("唯讀");
    expect(body).toContain("不佔 20 人名額");
    expect(body).toContain("其他顧問也看不到他的拍組");
  });

  it("名冊那一列有顧問 badge (手機的選擇 sheet 看不到分區標題)", () => {
    expect(read("src/components/gym/member-card.tsx")).toMatch(
      /member\.role === "advisor" \? \([\s\S]{0,400}顧問/
    );
  });
});
