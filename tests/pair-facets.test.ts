// 上游帶進來的四個篩選面向 (弱點 / 招式屬性 / 主題 / 標籤) 的不變量。
//
// 為什麼要測: 這三種壞法在畫面上都很難發現 ——
//   1. 少一個繁中名 → 那顆 chip 直接顯示英文 (AGENTS「使用者看得到的值一律繁中」),
//      而它可能是六十幾顆裡的一顆, 只有剛好篩到的人看得到;
//   2. 標籤沒有列進 TAG_GROUPS → chip 根本不會畫出來, 那個值等於篩不到 (資料在, 但沒有入口);
//   3. 弱點/招式屬性用的是 ALL_TYPES 的小寫值, 上游若改用別的寫法 (Ground vs ground)
//      篩選會靜靜地永遠沒有結果。
// 上游改版加了新標籤時這裡會變紅 —— 那正是要的: 先補譯名再上線。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_TYPES } from "@/data/sync-pairs";
import {
  GENDER_LABELS,
  GENDER_TAGS,
  TAG_LABELS,
  TAG_ORDER,
  THEME_LABELS,
  THEME_ORDER,
} from "@/data/pair-facets";

type Rec = {
  weakType?: string | null;
  themes?: string[];
  tags?: string[];
  moveTypes?: string[];
};

const records: Rec[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/data/pomatools-pairs.json"), "utf8")
).records;

const uniq = (pick: (r: Rec) => string[] | undefined) =>
  [...new Set(records.flatMap((r) => pick(r) ?? []))].sort();

describe("篩選面向 (上游資料)", () => {
  it("catalog 裡每個主題都有繁中名, 而且排得出來", () => {
    const themes = uniq((r) => r.themes);
    expect(themes.length).toBeGreaterThan(50);
    for (const t of themes) {
      expect(THEME_LABELS[t], `主題缺繁中名: ${t}`).toBeTruthy();
      expect(THEME_ORDER, `主題沒有列進顯示順序: ${t}`).toContain(t);
    }
  });

  it("catalog 裡每個標籤都有繁中名, 而且有 chip 畫得出來", () => {
    const tags = uniq((r) => r.tags);
    expect(tags.length).toBeGreaterThan(30);
    for (const t of tags) {
      const isGender = (GENDER_TAGS as readonly string[]).includes(t);
      const label = isGender ? GENDER_LABELS[t] : TAG_LABELS[t];
      expect(label, `標籤缺繁中名: ${t}`).toBeTruthy();
      // 性別自成一個面向, 不在 TAG_GROUPS 裡
      if (!isGender) expect(TAG_ORDER, `標籤沒有列進任何一組: ${t}`).toContain(t);
    }
  });

  it("弱點與招式屬性都是 ALL_TYPES 的小寫值", () => {
    const weaks = [...new Set(records.map((r) => r.weakType).filter(Boolean))] as string[];
    expect(weaks.length).toBeGreaterThan(10);
    for (const w of weaks) expect(ALL_TYPES, `弱點不在屬性表: ${w}`).toContain(w);
    for (const m of uniq((r) => r.moveTypes)) {
      expect(ALL_TYPES, `招式屬性不在屬性表: ${m}`).toContain(m);
    }
  });

  it("招式屬性是真的招式不是拍組自己的屬性", () => {
    // 舊資料 658 筆全是「單一值 = 自己的屬性」, 拿來篩等於白篩。
    // 上游的 MoveType* 標籤補上之後, 應該有一大批拍組的招式屬性與自身屬性不同。
    const different = records.filter((r) => {
      const m = r.moveTypes ?? [];
      return m.length > 1 || (m.length === 1 && m[0] !== (r as { type?: string }).type);
    }).length;
    expect(different).toBeGreaterThan(100);
  });
});
