import { describe, expect, it } from "vitest";

import { battleStatusFromDates } from "./types";
import { spentByMember } from "./tickets";

describe("battleStatusFromDates (狀態由賽期推導, 無手動下拉)", () => {
  it("沒設開賽日或還沒到 = 籌備中", () => {
    expect(battleStatusFromDates(null, null, "2026-08-17")).toBe("planning");
    expect(battleStatusFromDates("2026-08-20", "2026-08-27", "2026-08-17")).toBe("planning");
  });
  it("開賽日至結束日 (含當天) = 進行中; 沒設結束日就一直進行中", () => {
    expect(battleStatusFromDates("2026-08-10", "2026-08-17", "2026-08-10")).toBe("active");
    expect(battleStatusFromDates("2026-08-10", "2026-08-17", "2026-08-17")).toBe("active");
    expect(battleStatusFromDates("2026-08-10", null, "2026-12-31")).toBe("active");
  });
  it("過了結束日 = 已結束", () => {
    expect(battleStatusFromDates("2026-08-10", "2026-08-17", "2026-08-18")).toBe("finished");
  });
});

describe("spentByMember", () => {
  const logs = [
    { member_id: "a", tickets_used: 3 },
    { member_id: "a", tickets_used: 1 },
    { member_id: "b", tickets_used: 2 },
  ];
  it("已花張數依成員加總", () => {
    expect(spentByMember(logs)).toEqual({ a: 4, b: 2 });
  });
});
