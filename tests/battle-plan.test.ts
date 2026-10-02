// 排刀表 (0083, 2026-10-02)。這幾條壞掉都沒有徵兆: 畫面照常, 只是有人存不進去、或兩個人同時排時互相蓋掉。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const M = read("supabase/migrations/0083_battle_plan.sql");
const UI = read("src/app/gyms/[id]/battles/[battleId]/battle-plan.tsx");
const DATA = read("src/app/gyms/[id]/battles/[battleId]/battle-plan-data.ts");

describe("0083 排刀表", () => {
  it("全館成員都能改、顧問唯讀: 寫入一律 is_gym_editor, 讀取 is_gym_member", () => {
    for (const t of ["battle_plan_fields", "battle_plan_slots", "battle_plans"]) {
      for (const op of ["insert", "update", "delete"]) {
        const m = M.match(new RegExp(`"${t}_${op}" on public\\.${t}\\s+for ${op}[\\s\\S]*?;`));
        expect(m, `${t} ${op}`).toBeTruthy();
        expect(m![0]).toContain("is_gym_editor(gym_id)");
        expect(m![0]).not.toContain("is_gym_admin");
      }
      expect(M).toMatch(new RegExp(`"${t}_select" on public\\.${t}\\s+for select using \\(public\\.is_gym_member\\(gym_id\\)\\)`));
    }
  });

  it("一人一列、冪等: 唯一鍵是 nulls not distinct, 前端 onConflict 指同一組欄位", () => {
    expect(M).toMatch(/unique nulls not distinct \(field_id, stage_id, member_id\)/);
    const conflicts = [...UI.matchAll(/onConflict: "([^"]+)"/g)].map((m) => m[1]);
    expect(conflicts.filter((c) => c === "field_id,stage_id,member_id").length).toBeGreaterThanOrEqual(2);
    // 加人一定要忽略重複 (別人剛好也加了同一個人 → 不跳 duplicate key)
    expect(UI).toMatch(/onConflict: "field_id,stage_id,member_id", ignoreDuplicates: true/);
  });

  it("顧問 / 別館成員不能被排進去; 全場欄位與每關欄位不能混", () => {
    expect(M).toMatch(/m\.status = 'active' and m\.role <> 'advisor'/);
    expect(M).toMatch(/f\.wide = \(p_stage is null\)/);
  });

  it("新賽事自動帶 物攻 / 特攻 / 降抗(全場), 既有賽事補上", () => {
    expect(M).toMatch(/'物攻', false, 1\),\s+\(new\.gym_id, new\.id, '特攻', false, 2\),\s+\(new\.gym_id, new\.id, '降抗', true, 3\)/);
    expect(M).toMatch(/after insert on public\.gym_battles/);
    expect(M).toMatch(/where not exists \(select 1 from public\.battle_plan_fields f where f\.battle_id = b\.id\)/);
  });

  it("page.tsx 用的查詢欄位放在中立模組, 不可以標 use client (否則整頁掛掉)", () => {
    expect(DATA).not.toMatch(/^\s*["']use client["']/m);
    const page = read("src/app/gyms/[id]/battles/[battleId]/page.tsx");
    expect(page).toMatch(/from "\.\/battle-plan-data"/);
    expect(page).not.toMatch(/from "\.\/battle-plan"/);
  });

  it("沒有 localStorage 殘留 (預覽版的資料來源已經換成資料表)", () => {
    expect(UI).not.toMatch(/localStorage/);
  });
});
