// 等級下拉的選項。
//
// 為什麼值得寫測試: 這個壞法**完全沒有徵兆** —— Radix 的 Select 在 value 找不到對應的
// SelectItem 時, trigger 會渲染成一片空白 (不是 placeholder, 也不會報錯)。
// 於是「某些人的等級下拉是空的」只有那些人自己看得到, 而且他隨手選一個就把舊值蓋掉了
// (側板是即改即存, 沒有儲存鈕)。
//
// 線上實測 (2026-09-07, user_collection 2077 列): Lv200 有 1906 列, 但另有 Lv1 167 列、
// Lv100 與 Lv130 各 1 列 —— 都不在「140/150/180/200」這份標準選單裡。
// (Lv1 的來源: set_member_pair 替沒有收藏列的成員新增時, level 吃 DB 預設值 1。)

import { describe, expect, it } from "vitest";

import { LEVEL_OPTIONS, defaultEntry, levelOptions } from "@/lib/collection-entry";

describe("等級選項", () => {
  it("標準選項就是使用者指定的那四個", () => {
    expect([...LEVEL_OPTIONS]).toEqual([140, 150, 180, 200]);
  });

  it("現值已經在標準選項裡 → 不多長一格", () => {
    for (const lv of LEVEL_OPTIONS) {
      expect(levelOptions(lv)).toEqual([...LEVEL_OPTIONS]);
    }
  });

  it("**現值不在標準選項裡 → 一定要補進來** (不補的話那一列的下拉是空白的)", () => {
    expect(levelOptions(175)).toEqual([140, 150, 175, 180, 200]);
    expect(levelOptions(1)).toEqual([1, 140, 150, 180, 200]);
    expect(levelOptions(130)).toEqual([130, 140, 150, 180, 200]);
  });

  it("由小到大 — 補進來的那一格不能掉到最後面", () => {
    for (const lv of [1, 100, 130, 175, 199]) {
      const list = levelOptions(lv);
      expect([...list].sort((a, b) => a - b)).toEqual(list);
    }
  });

  it("讀不出等級時不要生出 Lv0 / LvNaN 這種選項", () => {
    expect(levelOptions(0)).toEqual([...LEVEL_OPTIONS]);
    expect(levelOptions(Number.NaN)).toEqual([...LEVEL_OPTIONS]);
  });

  it("新點亮拍組的預設等級必須是標準選項之一 (不然一點亮就多一格)", () => {
    const entry = defaultEntry({ pairId: "x", basePotential: 5 } as never);
    expect(LEVEL_OPTIONS).toContain(entry.level as (typeof LEVEL_OPTIONS)[number]);
  });
});
