// 移出成員不再刪掉他的出刀紀錄 (0081, 2026-10-01 使用者:「出刀紀錄…不應該跟著成員離開而離開
// 也許可以頭像變灰之類的 但記錄應該要留著」)。
//
// 前科: battle_logs.member_id 是 on delete cascade, 哲爸被移出時 21 筆 / 30 張跟著消失,
// 已經結束的第三次道館戰統計被改掉 —— 沒有任何錯誤, 數字就是悄悄少了。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { memberLabel } from "@/components/gym/member-card";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const MIGRATIONS = "supabase/migrations";
const files = fs.readdirSync(path.join(process.cwd(), MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
const M0081 = read(`${MIGRATIONS}/0081_keep_battle_logs_of_departed.sql`);

describe("0081 出刀紀錄不跟著成員刪", () => {
  it("拿掉 battle_logs.member_id 的 cascade 外鍵, 之後的 migration 也沒有加回來", () => {
    expect(M0081).toMatch(/alter table public\.battle_logs drop constraint if exists battle_logs_member_id_fkey/);
    for (const f of files.filter((f) => f > "0081")) {
      expect(read(`${MIGRATIONS}/${f}`), f).not.toMatch(/battle_logs[\s\S]{0,200}references public\.gym_members/);
    }
  });
  it("離開時存名字 / 頭像快照; 整館刪除時不存 (外鍵會擋刪館)", () => {
    expect(M0081).toMatch(/after delete on public\.gym_members/);
    expect(M0081).toMatch(/if not exists \(select 1 from public\.gyms where id = old\.gym_id\) then\s+return old;/);
    expect(M0081).toMatch(/gym_id uuid not null references public\.gyms\(id\) on delete cascade/);
  });
  it("快照只有 trigger 寫得進去; 讀的權限跟出刀紀錄一樣", () => {
    expect(M0081).toMatch(/for select using \(public\.is_gym_member\(gym_id\)\)/);
    expect(M0081).not.toMatch(/create policy [a-z_]+ on public\.departed_members\s+for (insert|update|delete|all)/);
    expect(M0081).toMatch(/revoke insert, update, delete, truncate on public\.departed_members from anon, authenticated/);
  });
});

describe("看板: 已離開的人只拿來查「紀錄是誰出的」", () => {
  const page = read("src/app/gyms/[id]/battles/[battleId]/page.tsx");
  const client = read("src/app/gyms/[id]/battles/[battleId]/battle-client.tsx");
  const board = read("src/app/gyms/[id]/battles/[battleId]/stage-board.tsx");

  it("頁面讀快照, 只送這一場紀錄裡出現、又不在名冊上的人", () => {
    expect(page).toMatch(/\.from\("departed_members"\)/);
    expect(page).toMatch(/logMemberIndex\.has\(d\.id\) && !members\.some\(\(m\) => m\.id === d\.id\)/);
    expect(page).toMatch(/departed: true/);
  });
  it("改成顧問的人也算「已離開」—— 他當時的出刀紀錄照樣畫 (小鳴 第三次道館戰 12 筆原本整個不見)", () => {
    expect(page).toMatch(/const \{ gym, viewer, members, advisors \} = await getGymContext\(id\)/);
    expect(page).toMatch(/\.\.\.advisors\.map\(/);
  });
  it("只併進查人的 map, 沒有混進 members (名冊 / 挑戰券 / 選單)", () => {
    expect(client).toMatch(/new Map\(\[\.\.\.departedMembers, \.\.\.members\]/);
    expect(board).toMatch(/new Map\(\[\.\.\.\(departedMembers \?\? \[\]\), \.\.\.members\]/);
    expect(client).not.toMatch(/members=\{\[\.\.\.members, \.\.\.departedMembers\]\}/);
    expect(client).not.toMatch(/members=\{\[\.\.\.departedMembers/);
  });
  it("名字後面加「（已離開）」, 在名冊上的人不受影響", () => {
    expect(memberLabel({ displayName: "Roy", lineName: "哲爸", departed: true })).toBe("哲爸(Roy)（已離開）");
    expect(memberLabel({ displayName: "Roy", lineName: "哲爸" })).toBe("哲爸(Roy)");
  });
  it("頭像變灰", () => {
    expect(read("src/components/gym/member-card.tsx")).toMatch(/member\.departed && "opacity-60 grayscale"/);
  });
});

describe("道館紀錄: 已離開的人留下的紀錄照樣看得出是誰 (2026-10-12)", () => {
  // 前科: 阿育 10/12 離開後, 她 10/5 改自己練度的 3 筆變成「匯入資料 改了 已退出的成員 的 拍組練度」——
  // 名字只從現役名冊找, 沒讀 departed_members 快照。
  const page = read("src/app/gyms/[id]/activity/page.tsx");
  const client = read("src/app/gyms/[id]/activity/activity-client.tsx");
  it("頁面讀 departed_members (含 user_id, 才回查得到「誰改的」) 並標 departed", () => {
    expect(page).toMatch(/from\("departed_members"\)\s*\.select\("id, user_id, display_name, line_name, avatar_url, badge_text"\)/);
    expect(page).toMatch(/departed=\{[\s\S]*?userId: d\.user_id,[\s\S]*?departed: true/);
  });
  it("回查名冊把快照放最前面 (同一個人又加回來時現役那一筆蓋掉快照)", () => {
    expect(client).toMatch(/\[\.\.\.departed, \.\.\.members, \.\.\.advisors\]/);
  });
});

describe("0085 離開的人一律存快照 (不再限有出刀紀錄的人)", () => {
  const M0085 = read(`${MIGRATIONS}/0085_departed_snapshot_everyone.sql`);
  const fn = M0085.slice(M0085.indexOf("create or replace function public.snapshot_departed_member"), M0085.indexOf("$$;") + 3);
  it("trigger 函式不再看 battle_logs; 待確認的申請與整館刪除照舊不存", () => {
    expect(fn).not.toMatch(/battle_logs/);
    expect(fn).toMatch(/if old\.status = 'pending' then\s+return old;/);
    expect(fn).toMatch(/if not exists \(select 1 from public\.gyms where id = old\.gym_id\) then\s+return old;/);
    expect(fn).toMatch(/security definer set search_path = public/);
  });
  it("補資料只補: 道館還在、不在現役名冊、還沒有快照、不是待確認的", () => {
    expect(M0085).toMatch(/from public\.deleted_rows d\s+where d\.table_name = 'gym_members'/);
    expect(M0085).toMatch(/<> 'pending'/);
    expect(M0085).toMatch(/not exists \(select 1 from public\.gym_members m where m\.id = \(d\.data->>'id'\)::uuid\)/);
    expect(M0085).toMatch(/on conflict \(id\) do nothing/);
  });
});
