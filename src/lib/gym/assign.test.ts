import { describe, expect, it } from "vitest";

import {
  autoAssign,
  fitness,
  type GymPairEntry,
  type MemberInput,
  type StageInput,
} from "./assign";

const fireGymPairs: GymPairEntry[] = [
  { pairId: "p-fire-1", label: "美極套裝鬥也&蓋諾賽克特" },
  { pairId: "p-fire-2", label: "葉子(冠軍)&火焰鳥" },
  { pairId: "p-fire-3", label: "煤炭龜手" },
];

const fireStage: StageInput = { stageId: "s-fire", seq: 1, weakType: "fire" };
const dragonStage: StageInput = { stageId: "s-dragon", seq: 2, weakType: "dragon" };

const teamStage: StageInput = {
  stageId: "s-team",
  seq: 3,
  weakType: "fighting",
  teams: [
    {
      name: "格鬥主力隊",
      pairs: [
        { pairId: "t-1", label: "阿爾可爾妮", minGrade: 5 },
        { pairId: "t-2", label: "樹梟", minGrade: 3 },
        { pairId: "t-3", label: "96皮", minGrade: 5 },
      ],
    },
    {
      name: "格鬥備援隊",
      pairs: [
        { pairId: "t-4", label: "彼特", minGrade: 1 },
        { pairId: "t-5", label: "岩兔", minGrade: 1 },
      ],
    },
  ],
};

function member(partial: Partial<MemberInput> & { memberId: string; name: string }): MemberInput {
  return {
    tickets: null,
    pairGrades: {},
    ...partial,
  };
}

describe("fitness — 有隊伍的關: 按隊伍需求媒合", () => {
  it("全達標 = 100 分, 理由標示全符合", () => {
    const m = member({
      memberId: "a",
      name: "泡茶綿羊",
      pairGrades: { "t-1": 5, "t-2": 6, "t-3": 5 },
    });
    const f = fitness(m, teamStage, {});
    expect(f.score).toBe(100);
    expect(f.reason).toContain("格鬥主力隊");
    expect(f.reason).toContain("全符合");
    expect(f.suggestedPairIds).toEqual(["t-1", "t-2", "t-3"]);
  });

  it("多套隊伍取最合的那套 (副隊全符合 > 主隊部分符合)", () => {
    const m = member({
      memberId: "b",
      name: "老人",
      pairGrades: { "t-1": 2, "t-4": 3, "t-5": 1 },
    });
    const f = fitness(m, teamStage, {});
    expect(f.score).toBe(100);
    expect(f.reason).toContain("格鬥備援隊");
  });

  it("部分達標按比例給分且低於全達標", () => {
    const m = member({
      memberId: "c",
      name: "小鳴",
      pairGrades: { "t-1": 5, "t-2": 6 }, // 差 t-3
    });
    const f = fitness(m, teamStage, {});
    expect(f.score).toBeGreaterThan(40);
    expect(f.score).toBeLessThan(100);
    expect(f.reason).toContain("2/3 符合");
  });
});

describe("fitness — 無隊伍的關: 按該屬性道館拍組寶數", () => {
  it("取最強三隻的寶數平均", () => {
    const m = member({
      memberId: "a",
      name: "綠香菇",
      // 0038 軸: 10=超覺醒5, 1-5=寶1-5
      pairGrades: { "p-fire-1": 10, "p-fire-2": 5, "p-fire-3": 3 },
    });
    const f = fitness(m, fireStage, { fire: fireGymPairs });
    // (10/10 + 5/10 + 3/10)/3 *100 = 60
    expect(f.score).toBeCloseTo(60, 0);
    expect(f.reason).toContain("道館拍組");
    expect(f.reason).toContain("超覺醒");
    expect(f.suggestedPairIds[0]).toBe("p-fire-1");
  });

  it("無該屬性持有 = 0 分不派", () => {
    const m = member({ memberId: "b", name: "無火人" });
    const f = fitness(m, fireStage, { fire: fireGymPairs });
    expect(f.score).toBe(0);
  });
});

describe("autoAssign", () => {
  const strongFire = member({
    memberId: "m1",
    name: "火強者",
    pairGrades: { "p-fire-1": 6, "p-fire-2": 6, "p-fire-3": 6 },
  });
  const weakAll = member({ memberId: "m2", name: "萌新" });
  const teamPlayer = member({
    memberId: "m3",
    name: "隊伍人",
    pairGrades: { "t-1": 5, "t-2": 5, "t-3": 5 },
  });

  it("有隊伍的關派全符合者, 無隊伍的關派道館拍組寶數高者; 0 分不硬塞", () => {
    const out = autoAssign({
      stages: [fireStage, teamStage],
      members: [strongFire, weakAll, teamPlayer],
      gymPairsByType: { fire: fireGymPairs },
      perStage: 2,
    });
    const fireAssigned = out.filter((o) => o.stageId === "s-fire").map((o) => o.memberId);
    const teamAssigned = out.filter((o) => o.stageId === "s-team").map((o) => o.memberId);
    expect(fireAssigned).toContain("m1");
    expect(teamAssigned).toContain("m3");
    // 萌新 0 分, 兩關都不該被硬塞
    expect(out.some((o) => o.memberId === "m2")).toBe(false);
  });

  it("券數 0 不派; 券數限制可接關數", () => {
    const noTickets = { ...strongFire, memberId: "m4", name: "沒券", tickets: 0 };
    const out = autoAssign({
      stages: [fireStage],
      members: [noTickets],
      gymPairsByType: { fire: fireGymPairs },
    });
    expect(out).toHaveLength(0);
  });

  it("既有派遣不重複且計入負載", () => {
    const out = autoAssign({
      stages: [fireStage],
      members: [strongFire],
      gymPairsByType: { fire: fireGymPairs },
      perStage: 1,
      existing: [{ stageId: "s-fire", memberId: "m1" }],
    });
    expect(out).toHaveLength(0); // 名額已被既有派遣佔滿
  });

  it("無資料的關卡不產生派遣", () => {
    const out = autoAssign({
      stages: [dragonStage],
      members: [strongFire],
      gymPairsByType: { fire: fireGymPairs },
    });
    expect(out).toHaveLength(0);
  });
});

describe("autoAssign — 輪次規則與券數記帳", () => {
  const strongFire = member({
    memberId: "m1",
    name: "火強者",
    pairGrades: { "p-fire-1": 6, "p-fire-2": 6, "p-fire-3": 6 },
  });

  it("物攻無效輪: physical 隊伍不採用, 改用其他隊/道館拍組", () => {
    const stage: StageInput = {
      stageId: "s-r",
      seq: 1,
      weakType: "fire",
      teams: [
        {
          name: "物攻隊",
          tag: "physical",
          pairs: [{ pairId: "x-1", label: "物攻手", minGrade: 1 }],
        },
        {
          name: "特攻隊",
          tag: "special",
          pairs: [{ pairId: "y-1", label: "特攻手", minGrade: 1 }],
        },
      ],
    };
    const phys = member({ memberId: "mp", name: "物攻人", pairGrades: { "x-1": 5 } });
    const spec = member({ memberId: "ms", name: "特攻人", pairGrades: { "y-1": 5 } });
    const out = autoAssign({
      stages: [stage],
      members: [phys, spec],
      gymPairsByType: {},
      rule: { blocked: "physical" },
      perStage: 2,
    });
    // 物攻隊被過濾 → 只有特攻人符合特攻隊
    expect(out.map((o) => o.memberId)).toEqual(["ms"]);
    expect(out[0].reason).toContain("特攻隊");
  });

  it("券數按實際成本記帳: 只剩 1 券排不了 (每人 2 券)", () => {
    const oneTicket = {
      ...member({
        memberId: "m5",
        name: "一券人",
        pairGrades: { "p-fire-1": 6, "p-fire-2": 6, "p-fire-3": 6 },
      }),
      tickets: 1,
    };
    const out = autoAssign({
      stages: [fireStage],
      members: [oneTicket],
      gymPairsByType: { fire: fireGymPairs },
    });
    expect(out).toHaveLength(0);
  });

  it("已經有人排的關卡不再補 (含舊資料的 role=debuff 列)", () => {
    const out = autoAssign({
      stages: [fireStage],
      members: [strongFire],
      gymPairsByType: { fire: fireGymPairs },
      round: 2,
      existing: [{ stageId: "s-fire", memberId: "x", role: "debuff" }],
    });
    expect(out).toHaveLength(0);
  });

  it("R1-3: 每關 1 人 3 券打過, 適配分高者優先", () => {
    const weaker = {
      ...member({
        memberId: "df",
        name: "寶數低",
        pairGrades: { "p-fire-1": 3, "p-fire-2": 3, "p-fire-3": 3 },
      }),
      tickets: 30,
    };
    const stronger = {
      ...member({
        memberId: "pm",
        name: "寶數高",
        pairGrades: { "p-fire-1": 6, "p-fire-2": 6, "p-fire-3": 6 },
      }),
      tickets: 30,
    };
    const out = autoAssign({
      stages: [fireStage],
      members: [weaker, stronger],
      gymPairsByType: { fire: fireGymPairs },
      round: 2,
    });
    expect(out).toHaveLength(1); // 一人打過
    expect(out[0].memberId).toBe("pm");
    expect(out[0].plannedTickets).toBe(3);
  });
});
