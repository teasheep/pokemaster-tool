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

  it("battleTemplate() 查得到, 查不到回 null (不要回 undefined 讓呼叫端分不清)", () => {
    expect(battleTemplate(BATTLE_TEMPLATES[0]!.id)?.name).toBe(BATTLE_TEMPLATES[0]!.name);
    expect(battleTemplate("不存在的")).toBe(null);
    expect(battleTemplate(null)).toBe(null);
  });
});
