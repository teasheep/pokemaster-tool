// 人員異動記進道館紀錄 (0079, 2026-09-30 使用者:「哪個管理員放行、把人升級成管理、
// 移成顧問, 這些資訊需要放在道館紀錄內」)。
//
// 壞掉都沒有徵兆: trigger 漏掉一條路 = 那一種異動靜靜不記; 句子寫錯 = 「拒絕」畫成「離開」,
// 誰做的整個顛倒。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_KINDS,
  ACTIVITY_LOGGED_KINDS,
  mergeRuns,
  memberSentence,
  type ActivityRow,
} from "@/app/gyms/[id]/activity/activity-filters";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0079_member_activity.sql"), "utf8");
const say = (old_value: string | null, new_value: string | null) => {
  const s = memberSentence({ old_value, new_value });
  return `${s.subject === "actor" ? "[操作者]" : "[本人]"} ${s.verb}${s.object ? " [對象]" : ""}${s.tail ? " " + s.tail : ""}`;
};

describe("人員異動的句子", () => {
  it("申請 / 放行 / 拒絕 / 取消申請", () => {
    expect(say(null, "pending:advisor")).toBe("[本人] 申請加入 （顧問）");
    expect(say("pending:advisor", "active:advisor")).toBe("[操作者] 放行 [對象] 加入（顧問）");
    expect(say("pending:member", null)).toBe("[操作者] 拒絕了 [對象] 的加入申請");
    expect(say("pending:member", "self")).toBe("[本人] 取消了加入申請");
  });
  it("改角色: 升成管理員 / 改成顧問", () => {
    expect(say("active:member", "active:admin")).toBe("[操作者] 把 [對象] 從成員改成管理員");
    expect(say("active:member", "active:advisor")).toBe("[操作者] 把 [對象] 從成員改成顧問");
  });
  it("移出 vs 自己離開 (那一列已經不在, 只能靠 new_value = self 分)", () => {
    expect(say("active:member", null)).toBe("[操作者] 把 [對象] 移出道館（原本是成員）");
    expect(say("active:admin", "self")).toBe("[本人] 離開了道館 （原本是管理員）");
  });
  it("建館 / 直接加入", () => {
    expect(say(null, "active:admin")).toBe("[本人] 加入道館 （管理員）");
  });
});

describe("人員異動在紀錄頁", () => {
  it("是一種可以篩選的類型, 「全部」也撈得到", () => {
    expect(ACTIVITY_KINDS).toContain("member");
    expect(ACTIVITY_LOGGED_KINDS).toContain("member");
  });
  it("一筆一列, 不合併 (放行 → 升管理員可能是兩個人做的)", () => {
    const row = (id: string, old_value: string, new_value: string): ActivityRow => ({
      id, member_id: "m1", actor_id: "u1", kind: "member", target: "乙", target_id: "m1",
      old_value, new_value, created_at: "2026-09-30T01:00:00Z",
    });
    const rows = [row("b", "active:member", "active:admin"), row("a", "pending:member", "active:member")];
    expect(mergeRuns(rows)).toHaveLength(2);
  });
});

describe("0079 trigger", () => {
  it("insert / update / delete 都掛 —— 放行、改角色、拒絕、移出、離開走的是不同路", () => {
    expect(sql).toMatch(/after insert or update or delete on public\.gym_members/);
  });
  it("只改名字 / 圓圈 / 出沒時段不記 (只看 status 與 role)", () => {
    expect(sql).toMatch(/old\.status is not distinct from new\.status and old\.role is not distinct from new\.role/);
  });
  it("整館刪除的 cascade 不記 (不留孤兒紀錄)", () => {
    expect(sql).toMatch(/if not exists \(select 1 from public\.gyms where id = v_row\.gym_id\)/);
  });
  it("刪除時分得出是不是本人刪的", () => {
    expect(sql).toMatch(/old\.user_id = auth\.uid\(\) then 'self'/);
  });
  it("trigger 函式收回執行權限 (0050 的原則)", () => {
    expect(sql).toMatch(/revoke all on function public\.log_member_change\(\) from public, anon, authenticated/);
  });
});
