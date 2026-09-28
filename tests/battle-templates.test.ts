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
  templateStageRules,
} from "@/lib/gym/battle-templates";

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

    it("每一則都塞得進 stage_round_notes (1..100 字, 輪次 1..20 —— 0044 的 check)", () => {
      for (const t of BATTLE_TEMPLATES) {
        for (const st of templateStageRules(t) ?? []) {
          const rounds = st.notes.map((n) => n.round);
          expect(new Set(rounds).size, `${t.name} ${st.leader}: 輪次重複`).toBe(rounds.length);
          for (const n of st.notes) {
            expect(n.round).toBeGreaterThanOrEqual(1);
            expect(n.round).toBeLessThanOrEqual(20);
            expect(n.note.length).toBeGreaterThan(0);
            expect(n.note.length, n.note).toBeLessThanOrEqual(100);
          }
        }
      }
    });

    it("第 1 輪一定寫著館主, Ex 輪 (第 4 輪起) 一定有限制 —— 資料格式變了會在這裡被抓到", () => {
      for (const t of BATTLE_TEMPLATES) {
        for (const st of templateStageRules(t) ?? []) {
          expect(st.notes.find((n) => n.round === 1)?.note, t.name).toContain(`館主 ${st.leader}`);
          expect(st.notes.some((n) => n.round >= 4), `${t.name} ${st.leader}`).toBe(true);
        }
      }
    });
  });

  it("battleTemplate() 查得到, 查不到回 null (不要回 undefined 讓呼叫端分不清)", () => {
    expect(battleTemplate(BATTLE_TEMPLATES[0]!.id)?.name).toBe(BATTLE_TEMPLATES[0]!.name);
    expect(battleTemplate("不存在的")).toBe(null);
    expect(battleTemplate(null)).toBe(null);
  });
});
