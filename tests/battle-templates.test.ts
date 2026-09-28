// 道館戰模板 (系統層級) 的不變量。
//
// 為什麼值得寫測試: 模板填錯不會有任何錯誤 —— 賽事建起來了、8 關也有屬性,
// 只是**屬性是錯的**, 而全館會照著它排隊伍與出刀。等到有人打不過才會發現。
//
// 之後遊戲開新的一回, 在 lib/gym/battle-templates.ts 加一筆就好, 這裡會自動涵蓋。

import { describe, expect, it } from "vitest";

import { ALL_TYPES } from "@/data/sync-pairs";
import {
  BATTLE_STAGE_COUNT,
  BATTLE_TEMPLATES,
  battleTemplate,
  formatHp,
  matchTemplate,
  stageRounds,
  templateStageRules,
} from "@/lib/gym/battle-templates";
import type { SyncPairType } from "@/lib/supabase/types";

describe("道館戰模板", () => {
  it("有模板可用", () => {
    expect(BATTLE_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("每一個模板都剛好 8 關 —— DB trigger 也是開 8 關, 兩邊必須一致", () => {
    expect(BATTLE_STAGE_COUNT).toBe(8);
    for (const t of BATTLE_TEMPLATES) {
      expect(t.types.length, t.name).toBe(BATTLE_STAGE_COUNT);
    }
  });

  it("屬性都是遊戲裡真的有的 18 種 (打錯字會被 DB 的 enum 擋下, 但那是建立賽事當下才炸)", () => {
    for (const t of BATTLE_TEMPLATES) {
      for (const ty of t.types) {
        expect(ALL_TYPES, `${t.name}: ${ty}`).toContain(ty);
      }
    }
  });

  it("id 唯一而且名字不是空的 (id 會被存進狀態, 改了等於換一個模板)", () => {
    const ids = BATTLE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BATTLE_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  describe("每關每輪的規則 (src/data/gvg-stage-rules.json, 2026-09-28)", () => {
    it("每個模板都有規則資料 —— 新的一回只加屬性、忘了跑 npm run data:gvg 會在這裡變紅", () => {
      for (const t of BATTLE_TEMPLATES) {
        expect(templateStageRules(t), t.name).not.toBe(null);
      }
    });

    it("**規則資料的弱點屬性 = 模板的屬性**, 一關都不能錯位 (錯位 = 規則掛到別的館主身上)", () => {
      for (const t of BATTLE_TEMPLATES) {
        const rules = templateStageRules(t);
        if (!rules) continue;
        expect(rules.map((s) => s.weak), t.name).toEqual(t.types);
      }
    });

    it("同一回裡 8 關屬性不重複 —— 看板用屬性對館主, 重複的話兩關會搶同一位", () => {
      for (const t of BATTLE_TEMPLATES) {
        expect(new Set(t.types).size, t.name).toBe(t.types.length);
      }
    });

    it("輪次是連續的 R1..Rn, 每一輪都有三隻對手的 HP (看板靠它把整回列出來, 缺一輪就少一列)", () => {
      for (const t of BATTLE_TEMPLATES) {
        for (const st of templateStageRules(t) ?? []) {
          const rounds = stageRounds(st);
          expect(rounds.map((r) => r.round), `${t.name} ${st.leader}`).toEqual(
            rounds.map((_, i) => i + 1)
          );
          for (const r of rounds) {
            expect(r.hp.every((n) => n > 0), `${t.name} ${st.leader} R${r.round}`).toBe(true);
          }
          // Ex 輪一定有限制, R1-R3 一定沒有 —— 資料格式變了會在這裡被抓到
          expect(rounds.filter((r) => r.round >= 4).every((r) => r.rules.length > 0)).toBe(true);
          expect(rounds.filter((r) => r.round <= 3).every((r) => r.rules.length === 0)).toBe(true);
        }
      }
    });

    it("**館主被動是累加的**: 每一輪都包含前一輪的全部, 只有新加的標「新」", () => {
      // 使用者 (2026-09-28):「tag 是追加 XX 的就代表那一輪會包含上一輪的限制」
      for (const t of BATTLE_TEMPLATES) {
        for (const st of templateStageRules(t) ?? []) {
          const rounds = stageRounds(st);
          for (let i = 1; i < rounds.length; i++) {
            const prev = rounds[i - 1]!.passives.map((p) => p.name);
            const cur = rounds[i]!.passives.map((p) => p.name);
            for (const name of prev) expect(cur, `${st.leader} R${i + 1}`).toContain(name);
            // 「新」的恰好是上一輪沒有的那些
            const fresh = rounds[i]!.passives.filter((p) => p.fresh).map((p) => p.name);
            expect(fresh).toEqual(cur.filter((n) => !prev.includes(n)));
          }
        }
      }
    });

    it("第四次梅麗莎那關的 Ex4 (第 7 輪): 兩條限制 + 館主三個被動全部都在", () => {
      const r4 = battleTemplate("r4-sinnoh")!;
      const st = templateStageRules(r4)!.find((s) => s.leader === "梅麗莎")!;
      const r7 = stageRounds(st).find((r) => r.round === 7)!;
      expect(r7.rules).toEqual(["特殊傷害0", "非效果絕佳時傷害0"]);
      expect(r7.passives.map((p) => p.name)).toEqual([
        "幽靈屬性替換",
        "特防下降無效",
        "首次上場時永久變成妖怪領域",
        "妖怪領域時異常狀態妨害無效G",
      ]);
      expect(r7.passives.some((p) => p.fresh)).toBe(false);
      expect(formatHp(r7.hp[0])).toBe("1796萬");
    });
  });

  describe("看板用 8 關屬性認出是哪一回 (matchTemplate)", () => {
    it("線上五場賽事的實際屬性都認得出來 —— 包括麵包店自己一格一格選的那場", () => {
      // 2026-09-28 線上 battle_stages 依 seq 排出來的樣子
      const real: [string, string][] = [
        ["ice,electric,ground,fire,psychic,dark,water,rock", "r1-kanto"],
        ["bug,grass,flying,psychic,ghost,water,poison,fighting", "r2-galar"],
        ["ice,electric,fighting,dark,fairy,fire,steel,dragon", "r3-johto"],
        ["grass,flying,fairy,dragon,dark,fighting,poison,ground", "r4-sinnoh"],
      ];
      for (const [types, id] of real) {
        expect(matchTemplate(types.split(",") as SyncPairType[])?.template.id).toBe(id);
      }
    });

    it("順序不同也認得出來, 而且每一關對到的是**同屬性**的館主", () => {
      const t = battleTemplate("r4-sinnoh")!;
      const m = matchTemplate([...t.types].reverse())!;
      expect(m.template.id).toBe("r4-sinnoh");
      expect(m.byType.get("dark")?.leader).toBe("梅麗莎");
      expect(m.byType.get("grass")?.leader).toBe("瓢太");
    });

    it("改錯一兩關仍然認得 (改錯的那關沒有規則); 自訂賽事 (全是一般) 不會硬套", () => {
      const t = battleTemplate("r4-sinnoh")!;
      const oneOff = [...t.types];
      oneOff[0] = "normal";
      const m = matchTemplate(oneOff)!;
      expect(m.template.id).toBe("r4-sinnoh");
      expect(m.byType.get("normal")).toBeUndefined();
      expect(matchTemplate(Array(8).fill("normal") as SyncPairType[])).toBe(null);
    });
  });

  it("battleTemplate() 查得到, 查不到回 null (不要回 undefined 讓呼叫端分不清)", () => {
    expect(battleTemplate(BATTLE_TEMPLATES[0]!.id)?.name).toBe(BATTLE_TEMPLATES[0]!.name);
    expect(battleTemplate("不存在的")).toBe(null);
    expect(battleTemplate(null)).toBe(null);
  });
});
