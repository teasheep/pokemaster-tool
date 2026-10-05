// 顧問不領挑戰券 (0084, 2026-10-05)。壞掉沒有徵兆 —— 只是「剩 / 上限」悄悄多算 30 張的倍數。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const M = read("supabase/migrations/0084_tickets_exclude_advisors.sql");
const UI = read("src/app/gyms/[id]/battles/[battleId]/battle-client.tsx");

describe("0084 顧問不領挑戰券", () => {
  it("insert policy 擋顧問 / 待確認 (member_counts_in_gym 看的是這一館的那一列)", () => {
    const p = M.match(/create policy "member_tickets_insert"[\s\S]*?;/)![0];
    expect(p).toContain("public.member_counts_in_gym(member_id)");
    expect(p).toContain("public.is_gym_editor(gym_id)");
  });

  it("adjust_member_ticket 先 update 既有的列 —— 舊賽事的券 (轉顧問之前領的) 照樣調得動", () => {
    const fn = M.slice(M.indexOf("create or replace function public.adjust_member_ticket"));
    const upd = fn.indexOf("update public.member_tickets");
    const ins = fn.indexOf("insert into public.member_tickets");
    expect(upd).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(upd);
    expect(fn).toMatch(/if found then\s+return v_remaining;/);
    // 簽章不變 (換簽章會留下舊函式、重新套 default privileges —— AGENTS「改 RPC 簽章」)
    expect(fn).toMatch(/p_gym uuid, p_battle uuid, p_member uuid, p_delta int default 0, p_cap_delta int default 0/);
  });

  it("挑戰券側板: 沒有券的顧問不列, 已經有券的照樣列; 全員發放不發給顧問", () => {
    expect(UI).toMatch(/\.filter\(\(m\) => m\.role !== "advisor" \|\| ticketByMember\.has\(m\.id\)\)/);
    expect(UI).toMatch(/r\.remaining === null && r\.member\.role !== "advisor"/);
  });
});
