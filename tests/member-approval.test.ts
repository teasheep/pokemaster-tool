// 「加入道館要管理員按確認」的不變量 (0071)。
//
// 2026-09-10 使用者:「就算用道館碼或顧問碼加入的玩家, 也不會立刻看到道館內的所有拍組 ——
// 因為碼確實有可能被外流, 此時再踢出, 已經被看光了。」
//
// **為什麼這一整檔都值得寫**: 這條是安全邊界, 而它每一種壞法都**沒有徵兆** ——
// 頁面照樣渲染、沒有錯誤、沒有紅字, 只是本來該被擋在門外的人看得到全館的資料
// (或者反過來, 全館 20 個人一起被當成「還沒確認」而資料整片消失)。
// 兩種都不會有人回報, 只會有人覺得「怪怪的」。
//
// 三類:
//   1. **SQL**: 五支 RLS helper 一律只認 status='active'; join_gym 建的是 pending 列;
//      自助更新不能把自己核准掉。
//   2. **回歸掃描**: 全部 migration 裡**最後一次**定義那五支的地方都要有 status 這一句 ——
//      以後有人 `create or replace` 忘了帶, 這裡會紅。這是本檔最重要的一條。
//   3. **前端**: 待確認的名單只送給管理員; 貼完碼不可以 push 進那一館; 匯出要濾掉。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isActiveMember, isPendingMember } from "@/lib/gym/membership";
import { TRACKS } from "@/components/tour/tour-steps";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/**
 * 全部 migration 裡**最後一次**定義某支函式的那一段原始碼。
 * 依檔名排序 = 依套用順序, 所以最後一段就是資料庫裡現在跑的那一份。
 */
function latestFunctionSource(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of migrationFiles) {
    const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    const needle = `create or replace function public.${name}(`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      // 函式本體一律 `as $$ … $$;` 收尾 (整份 migrations 都是這個寫法)
      const end = text.indexOf("$$;", text.indexOf("$$", at + needle.length) + 2);
      found = { file, body: text.slice(at, end < 0 ? text.length : end + 3) };
      from = at + needle.length;
    }
  }
  if (!found) throw new Error(`migrations 裡找不到 ${name}`);
  return found;
}

const M0071 = read("supabase/migrations/0071_member_approval.sql");

// ── 1. 欄位本身 ──

describe("gym_members.status", () => {
  it("預設是 active — 現有的成員一列都不能因為套了這支而被鎖在門外", () => {
    expect(M0071).toMatch(/add column if not exists status text not null default 'active'/);
  });

  it("只有 pending / active 兩種值 (資料庫也要擋, 不能只靠前端)", () => {
    expect(M0071).toMatch(/check \(status in \('pending', 'active'\)\)/);
  });
});

// ── 2. 五支 RLS helper 一律只認 active (回歸掃描: 看的是「最後一次定義」) ──

describe("RLS helper 只認 status = 'active'", () => {
  // 紅了怎麼辦: 你剛才 create or replace 的那一支忘了帶 `and status = 'active'`。
  // 補回去 —— 少一支就是一扇側門, 而且那扇門開著的時候畫面完全正常。
  const GATED = [
    ["is_gym_member", "讀 — 全站的道館資料都收斂在這一支"],
    ["is_gym_admin", "管理 (含按下確認那一下)"],
    ["is_gym_editor", "寫共享資料: 出戰回報 / 券數 / 攻略"],
    ["is_gym_advisor", "顧問視野: 道館紀錄"],
    ["is_self_member", "「這一列 member row 是我的」— 成員資料表的寫入"],
  ] as const;

  for (const [name, why] of GATED) {
    it(`${name} (${why})`, () => {
      const { file, body } = latestFunctionSource(name);
      expect(body, `${name} 的最後一次定義在 ${file}, 少了 status 這一句`).toContain(
        "status = 'active'"
      );
    });
  }

  it("五支都是 security definer + 釘死 search_path (policy 會遞迴呼叫它們)", () => {
    for (const [name] of GATED) {
      const { body } = latestFunctionSource(name);
      expect(body, name).toContain("security definer");
      expect(body, name).toContain("search_path = public");
    }
  });
});

// ── 3. 自助更新不能自己把自己核准掉 ──

describe("gym_members_update_self", () => {
  // RLS 沒有欄位粒度 —— 「改自己那一列」如果不把 status 釘死, 待確認的人送一個
  // `update gym_members set status='active' where user_id = me` 就自助進門了。
  // 角色 (0028) 早就是這樣釘的, status 照同一條做。
  it("with check 把 status 釘在現況 (my_gym_status)", () => {
    expect(M0071).toMatch(/and status = public\.my_gym_status\(gym_id\)/);
  });

  it("而且照舊要求 is_gym_member — 待確認的人連自己那一列都不能動", () => {
    const at = M0071.indexOf('create policy "gym_members_update_self"');
    expect(at).toBeGreaterThan(0);
    const policy = M0071.slice(at, M0071.indexOf(";", at));
    expect(policy).toContain("public.is_gym_member(gym_id)");
    expect(policy).toContain("role = public.my_gym_role(gym_id)");
  });
});

// ── 4. 兩支入館 RPC ──

describe("join_gym 建的是申請列", () => {
  const src = latestFunctionSource("join_gym");

  it("insert 一律 'pending'", () => {
    expect(src.body, `join_gym 的最後一次定義在 ${src.file}`).toMatch(
      /values[\s\S]{0,200}'pending'\)/
    );
  });

  it("回傳帶 pending 旗標 — 前端要靠它決定「導進道館」還是「留在清單等」", () => {
    expect(src.body).toContain("'pending', true");
  });

  it("**已經有列的冪等分支也要回 pending**", () => {
    // 待確認的人看不到任何東西, 再貼一次碼是很自然的反應。那一趟如果回 pending:false,
    // 就會把他導進一個他讀不到的道館頁 (「找不到道館或你不是成員」)。
    expect(src.body).toMatch(/'pending', v_status = 'pending'/);
  });

  it("換了簽章就要重收權限 (0040 的前科)", () => {
    expect(M0071).toContain("drop function if exists public.join_gym(text);");
    expect(M0071).toMatch(/revoke all on function public\.join_gym\(text\) from public, anon;/);
    expect(M0071).toMatch(/grant execute on function public\.join_gym\(text\) to authenticated;/);
  });

  it("節流沒有被順手改回丟例外 (0060 檔頭第 2 點)", () => {
    // raise exception 會讓那筆「他試錯了」跟著交易回滾 → 節流等於整個關掉,
    // 而且測起來還像有效 (錯誤訊息照樣出現)。
    expect(src.body).toContain("jsonb_build_object('error', 'INVALID_CODE')");
    expect(src.body).not.toMatch(/raise exception 'INVALID_CODE'/);
    expect(src.body).toContain("code_attempts");
  });
});

describe("create_gym 的建館者是 active", () => {
  it("明寫 'active', 不靠欄位預設", () => {
    const { body } = latestFunctionSource("create_gym");
    expect(body).toMatch(/'admin', v_avatar, v_line, 'active'\)/);
  });
});

// ── 5. 待確認的人自己那一邊 ──

describe("my_pending_gyms / cancel_join_request", () => {
  it("只回呼叫者自己的申請 (沒有枚舉面)", () => {
    const { body } = latestFunctionSource("my_pending_gyms");
    expect(body).toContain("m.user_id = auth.uid()");
    expect(body).toContain("m.status = 'pending'");
  });

  it("**不回 gym_members.id**", () => {
    // 0071 檔頭那條假設: set_member_pair 的自助分支 (v_user = auth.uid()) 沒有另外
    // 檢查 status, 靠的就是「待確認的人拿不到自己那一列的 id」。這裡漏出去就要回去補那一句。
    const { body } = latestFunctionSource("my_pending_gyms");
    expect(body).not.toMatch(/select\s+m\.id/);
    expect(body).toMatch(/returns table \(gym_id uuid, gym_name text, role text, requested_at timestamptz\)/);
  });

  it("兩支都收掉 public/anon, 只給 authenticated (0050/0051)", () => {
    for (const fn of ["my_pending_gyms()", "cancel_join_request(uuid)"]) {
      expect(M0071, fn).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(M0071, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("cancel 只刪得掉自己的、而且只刪 pending 的那一列", () => {
    const { body } = latestFunctionSource("cancel_join_request");
    expect(body).toMatch(/where gym_id = p_gym and user_id = v_uid and status = 'pending'/);
  });
});

// ── 6. 最後一位管理員 ──

describe("protect_last_admin", () => {
  it("「還有沒有別的管理員」只算 active 的", () => {
    const { body } = latestFunctionSource("protect_last_admin");
    expect(body).toMatch(/role = 'admin' and status = 'active' and id <> old\.id/);
  });

  it("整館刪除的 cascade 照舊放行 (0042)", () => {
    const { body } = latestFunctionSource("protect_last_admin");
    expect(body).toContain("if not exists (select 1 from public.gyms where id = old.gym_id)");
  });
});

// ── 7. 前端: 判斷式本身 ──

describe("isActiveMember", () => {
  it("pending = 還沒被確認", () => {
    expect(isActiveMember({ status: "pending" })).toBe(false);
    expect(isPendingMember({ status: "pending" })).toBe(true);
  });

  it("active = 正式成員", () => {
    expect(isActiveMember({ status: "active" })).toBe(true);
  });

  it("**欄位還沒上線 (undefined/null) 一律當成 active**", () => {
    // 部署前端與套 migration 是兩個動作、不會同時落地。中間那幾分鐘讀回來沒有這一欄 ——
    // 寫成 `=== "active"` 的話全館 20 個人一起變成「還沒確認」, 名冊/持有率/匯出一次全空,
    // 而且完全沒有錯誤訊息。
    expect(isActiveMember({})).toBe(true);
    expect(isActiveMember({ status: null })).toBe(true);
  });

  it("實作寫成 !== \"pending\" 而不是 === \"active\"", () => {
    const src = read("src/lib/gym/membership.ts");
    expect(src).toContain('m.status !== "pending"');
    expect(src, "改成 === \"active\" 就是上面那個壞法").not.toContain('m.status === "active"');
  });

  it("membership.ts 是中立模組 — 不可以拖進 server 專用的東西", () => {
    // /api/export (service role) 與這支測試都要 import 它; 一旦它 import 了
    // @/lib/supabase/server, next/headers 就會被拖進來, 測試直接掛掉。
    // 只看 import 那幾行 —— 檔頭的註解本來就會提到這兩個名字 (它在解釋為什麼不能有)
    const imports = read("src/lib/gym/membership.ts")
      .split(/\r?\n/)
      .filter((l) => /^\s*import\b/.test(l))
      .join("\n");
    expect(imports).not.toContain("@/lib/supabase/server");
    expect(imports).not.toContain("next/headers");
    expect(read("src/lib/gym/membership.ts").trimStart().startsWith('"use client"')).toBe(false);
  });
});

// ── 8. 前端: 接線 ──

describe("待確認的名單只有管理員看得到", () => {
  it("members/page.tsx: viewer.isAdmin 才送 pending", () => {
    const src = read("src/app/gyms/[id]/members/page.tsx");
    expect(src).toMatch(/pending=\{\s*viewer\.isAdmin\s*\?/);
  });

  it("getGymContext 把 pending 另外一袋, members/advisors 只留 active", () => {
    const src = read("src/lib/gym/queries.ts");
    expect(src).toContain("const active = rows.filter(isActiveMember)");
    expect(src).toContain("members: active.filter((m) => m.role !== \"advisor\")");
    expect(src).toContain("advisors: active.filter((m) => m.role === \"advisor\")");
    expect(src).toContain("pending: rows.filter((m) => !isActiveMember(m))");
  });
});

describe("勾勾與叉叉", () => {
  const src = read("src/app/gyms/[id]/members/members-client.tsx");

  it("勾勾 = status 改成 active; 叉叉 = 刪掉那一列", () => {
    expect(src).toContain('.update({ status: "active" })');
    expect(src).toMatch(/await supabase\.from\("gym_members"\)\.delete\(\)\.eq\("id", m\.id\)/);
  });

  it("叉叉要按兩下 (誤按一下就把人家的申請刪掉, 而他不會收到任何通知)", () => {
    expect(src).toContain("confirmRejectId");
  });

  it("桌機左欄與手機 bottom sheet 用同一份 Roster, 兩邊都要收到 pending", () => {
    // 只接一邊的話, 手機上的管理員永遠看不到有人在等 (而且沒有任何提示)。
    const uses = src.split("<Roster").slice(1);
    expect(uses.length, "Roster 應該有兩個呼叫端 (桌機左欄 + 手機 bottom sheet)").toBe(2);
    for (const [i, block] of uses.entries()) {
      expect(block.slice(0, 400), `第 ${i + 1} 個 <Roster> 沒收到 pending`).toContain(
        "pending={pending}"
      );
      expect(block.slice(0, 400), `第 ${i + 1} 個 <Roster> 沒接 onDecide`).toContain("onDecide");
    }
  });

  it("那一區有 data-tour, 教學的補充說明才指得到", () => {
    expect(src).toContain('data-tour="pending-requests"');
  });
});

describe("貼完碼不可以直接導進那一館", () => {
  // 待確認的人讀不到那一館的任何資料 → push 進去只會看到「找不到道館或你不是成員」,
  // 而他其實什麼都沒做錯。兩個入口 (道館清單 / 新手引導) 都要處理。
  for (const f of ["src/app/gyms/gyms-client.tsx", "src/app/welcome/welcome-client.tsx"]) {
    it(f, () => {
      const src = read(f);
      const at = src.indexOf("res.pending");
      expect(at, "沒有判斷 res.pending").toBeGreaterThan(0);
      // 判斷之後、進道館之前要先 return
      const after = src.slice(at, at + 500);
      expect(after).toContain("已送出加入申請");
      expect(after).toMatch(/return;/);
    });
  }

  it("readGymRpc 舊版回傳 (uuid 字串) 當成 pending:false = 舊行為", () => {
    const src = read("src/lib/gym/gym-rpc.ts");
    expect(src).toContain("{ gymId: data, pending: false }");
    expect(src).toContain("pending: row.pending === true");
  });

  it("「等管理員確認中」那一頁講的是對的事", () => {
    const src = read("src/app/gyms/[id]/members/page.tsx");
    expect(src).toContain("getMyPendingGyms");
    expect(src).toContain("等管理員確認中");
  });
});

describe("待確認的人不進任何統計", () => {
  it("/gyms 的「N 位成員」不算他", () => {
    const src = read("src/app/gyms/page.tsx");
    expect(src).toContain("if (!isActiveMember(r)) continue;");
    // status 是後加的欄位 → 明列欄位名會在 migration 還沒套時 400, 整個清單白掉
    expect(src).toContain('.from("gym_members").select("*")');
  });

  it("/api/export 是 service role — RLS 不會幫忙擋, 要自己濾兩處", () => {
    const src = read("src/app/api/export/route.ts");
    expect(src).toContain("(myMemberships ?? []).filter(isActiveMember)");
    expect(src).toContain("(members ?? []).filter(isActiveMember)");
    expect(src).not.toContain('select("id, gym_id, role")');
  });

  it("有待確認的申請時 /gyms 不轉導 (不然那張卡永遠沒人看得到)", () => {
    const src = read("src/app/gyms/page.tsx");
    expect(src).toContain("gyms.length === 1 && pending.length === 0");
  });
});

// ── 9. 教學要講同一件事 ──

describe("使用教學同步", () => {
  const invite = TRACKS.flatMap((t) => t.steps).find((s) => s.target === "invite-codes");

  it("「把人找進來」那一步還在", () => {
    expect(invite).toBeTruthy();
  });

  it("不可以再教「貼上碼就加入」—— 那是 0071 之前的行為", () => {
    expect(invite!.body).not.toContain("貼上碼就加入");
    expect(invite!.body).toContain("待確認加入");
    expect(invite!.body).toMatch(/勾勾/);
  });

  it("有人在等的時候才多講一句 (extra.ifTarget)", () => {
    expect(invite!.extra?.ifTarget).toBe("pending-requests");
  });

  it("成員那條要講「要等管理員確認」", () => {
    const step = TRACKS.flatMap((t) => t.steps).find((s) => s.target === "member-row");
    expect(step!.body).toContain("管理員");
  });
});

describe("client 元件不可以 import 到 server 專用的模組", () => {
  // queries.ts 一 import 就把 @/lib/supabase/server (next/headers) 拖進來。
  // 型別 import 現在會被抹掉, 但哪天有人把它改成值 import 就是一個建置期才炸的錯誤 ——
  // PendingGym 因此放在中立的 membership.ts。
  it("gyms-client 的 PendingGym 來自 membership 不是 queries", () => {
    const src = read("src/app/gyms/gyms-client.tsx");
    expect(src.trimStart().startsWith('"use client"')).toBe(true);
    expect(src).toContain('from "@/lib/gym/membership"');
    expect(src).not.toContain('from "@/lib/gym/queries"');
  });
});
