// 降抗分成物降抗 / 特降抗 (0078, 2026-09-29 使用者指定) —— 隊伍庫的分類與出刀的分工。
//
// 壞掉都沒有徵兆: 前端多一個值而 check 沒放寬 = 一選就「新增失敗」;
// 舊的 'debuff' 被拿掉 = 17 支隊伍與 81 筆紀錄的標籤變成空白 (或整區消失)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TAG_STYLES, TEAM_TAGS, TEAM_TAG_ORDER } from "@/components/gym/team-sheet";
import { BATTLE_ROLES, BATTLE_ROLE_LABELS, TEAM_TAG_LABELS, isDebuffRole } from "@/lib/gym/types";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/0078_split_debuff.sql");
const checkValues = (name: string) =>
  [...sql.match(new RegExp(`${name}\\s+check \\((\\w+) in \\(([^)]*)\\)`))![2]!.matchAll(/'(\w+)'/g)].map((m) => m[1]);

describe("隊伍分類", () => {
  it("可以新增的分類: 物降抗 / 特降抗 / 物攻 / 特攻 / 磨隊, 沒有舊的「降抗」", () => {
    expect(TEAM_TAGS).toEqual(["debuff_physical", "debuff_special", "physical", "special", "closer"]);
    expect(TEAM_TAG_LABELS.debuff_physical).toBe("物降抗");
    expect(TEAM_TAG_LABELS.debuff_special).toBe("特降抗");
  });
  it("畫面上的分區含舊的「降抗（未分）」, 每一種都有名稱與配色", () => {
    expect(TEAM_TAG_ORDER).toContain("debuff");
    for (const t of TEAM_TAG_ORDER) {
      expect(TEAM_TAG_LABELS[t], t).toBeTruthy();
      expect(TAG_STYLES[t], t).toBeTruthy();
    }
  });
  it("資料庫的 check 允許的值 = 畫面上的全部分類 (含舊的 debuff)", () => {
    expect(new Set(checkValues("gym_teams_tag_check"))).toEqual(new Set(TEAM_TAG_ORDER));
  });
  it("載入骨架的分區數 = 分類數 (不同構的話資料到位時整頁跳一下)", () => {
    expect(read("src/components/skeletons.tsx")).toMatch(
      new RegExp(`TeamGridSkeleton\\(\\{ tags = ${TEAM_TAGS.length} \\}`)
    );
  });
});

describe("隊伍的屬性 (2026-09-29 一起修)", () => {
  const sheet = read("src/components/gym/team-sheet.tsx");
  it("「全部」底下按新增要先選屬性, 不可以默默建成一般", () => {
    expect(sheet).toContain('scope === "all" && !defaultType ? (');
    expect(sheet).toContain("onSelect={() => void createTeam(tag, ty)}");
  });
  it("建好的隊伍改得了屬性與分類 (以前放錯就只能刪掉重建)", () => {
    expect(sheet).toMatch(/<TypeSelect/);
    expect(sheet).toMatch(/<TagSelect/);
  });
});

describe("出刀的分工", () => {
  it("登記時的選項: 主力 / 補刀 / 物降抗 / 特降抗 (舊的「降抗」只給舊紀錄顯示)", () => {
    expect([...BATTLE_ROLES]).toEqual(["main", "assist", "debuff_physical", "debuff_special"]);
    expect(BATTLE_ROLE_LABELS.debuff).toBe("降抗");
  });
  it("資料庫的 check 允許的值 = 全部分工 (含舊的 debuff)", () => {
    expect(new Set(checkValues("battle_logs_role_check"))).toEqual(new Set(Object.keys(BATTLE_ROLE_LABELS)));
  });
  it("降抗一族同一個色系", () => {
    expect(isDebuffRole("debuff")).toBe(true);
    expect(isDebuffRole("debuff_special")).toBe(true);
    expect(isDebuffRole("main")).toBe(false);
  });
  it("三個登記入口都用 BATTLE_ROLES, 不再手寫三個值", () => {
    for (const f of ["report-run-sheet.tsx", "stage-board.tsx", "battle-client.tsx"]) {
      const code = read(`src/app/gyms/[id]/battles/[battleId]/${f}`);
      expect(code, f).toMatch(/BATTLE_ROLES\.map/);
      expect(code, f).not.toMatch(/\["main", "assist", "debuff"\]/);
    }
  });
});
