import { describe, expect, it } from "vitest";

import {
  buildMatcher,
  extractConst,
  normKey,
  parseCategoryKey,
  parseSkillKey,
  transformAttackerPage,
  transformDebuffPage,
} from "../scripts/gym-import-lib.mjs";

describe("normKey", () => {
  it("NFKC 統一全形符號與數字", () => {
    expect(normKey("大吾（偵探）＆長毛狗")).toBe(normKey("大吾(偵探)&長毛狗"));
    expect(normKey("鬥子（２０２２夏季）")).toBe(normKey("鬥子(2022夏季)"));
    expect(normKey("多邊獸Ｚ")).toBe(normKey("多邊獸Z"));
  });
  it("CJK 中點與空白不影響比對", () => {
    expect(normKey("卡璞・蝶蝶")).toBe(normKey("卡璞·蝶蝶"));
    expect(normKey("青木 & 土龍節節")).toBe(normKey("青木&土龍節節"));
  });
});

describe("parseSkillKey", () => {
  it("標準格式", () => {
    expect(parseSkillKey("火特攻 [阿爾套裝丹帝&噴火龍]")).toEqual({
      type: "fire",
      kind: "sp_atk",
      label: "阿爾套裝丹帝&噴火龍",
      matchLabel: "阿爾套裝丹帝&噴火龍",
    });
    expect(parseSkillKey("一般降抗 [青木&土龍節節]")?.type).toBe("normal");
    expect(parseSkillKey("龍降抗 [阿爾套裝阿渡&快龍]")?.kind).toBe("debuff");
  });
  it("尾碼 ']2' 保留為獨立 label, matchLabel 去掉尾碼", () => {
    const p = parseSkillKey("格降抗 [小優(競技服)&閃焰王牌]2");
    expect(p?.type).toBe("fighting");
    expect(p?.label).toBe("小優(競技服)&閃焰王牌 (2)");
    expect(p?.matchLabel).toBe("小優(競技服)&閃焰王牌");
  });
  it("不合格式回 null", () => {
    expect(parseSkillKey("亂七八糟")).toBeNull();
    expect(parseSkillKey("光降抗 [某人&某獸]")).toBeNull(); // 不存在的屬性
  });
});

describe("parseCategoryKey", () => {
  it("屬性 + 物/特", () => {
    expect(parseCategoryKey("一般物")).toEqual({ type: "normal", category: "physical" });
    expect(parseCategoryKey("龍特")).toEqual({ type: "dragon", category: "special" });
    expect(parseCategoryKey("怪物")).toBeNull();
  });
});

describe("extractConst", () => {
  it("取出單行 JSON 常數", () => {
    const html = `<script>\nconst FOO = {"a": 1};\nconst BAR = [1,2];\n</script>`;
    expect(extractConst(html, "FOO")).toEqual({ a: 1 });
    expect(extractConst(html, "BAR")).toEqual([1, 2]);
  });
  it("找不到或非 JSON 時丟錯", () => {
    expect(() => extractConst("", "FOO")).toThrow("找不到");
    expect(() => extractConst("const FOO = {broken;", "FOO")).toThrow("不是合法 JSON");
  });
});

// ── catalog 比對 ──

const RECORDS = [
  { pairId: "10090410000", trainerNameZh: "大吾（偵探）", pokemonNameZh: "長毛狗" },
  { pairId: "10111900000", trainerNameZh: "阿爾套裝阿渡", pokemonNameZh: "快龍" },
  { pairId: "10112000001", trainerNameZh: "阿響", pokemonNameZh: "鳳王" },
  { pairId: "10301000000", trainerNameZh: "哈奇庫", pokemonNameZh: "索羅亞克" },
  { pairId: "10089900000", trainerNameZh: "阿爾套裝N", pokemonNameZh: "索羅亞克" },
  { pairId: "10019400000", trainerNameZh: "小悠（學院）", pokemonNameZh: "沼躍魚" },
  { pairId: "10243410000", trainerNameZh: "小優（2025週年慶）", pokemonNameZh: "閃焰王牌" },
  { pairId: "10243810000", trainerNameZh: "小優（競技服）", pokemonNameZh: "閃焰王牌" },
  { pairId: "10245000003", trainerNameZh: "瑪俐", pokemonNameZh: "閃焰王牌" },
  { pairId: "10066000002", trainerNameZh: "鎯琊", pokemonNameZh: "胡帕" },
  { pairId: "10066000001", trainerNameZh: "鎯琊", pokemonNameZh: "胡帕" },
  { pairId: "10160100000", trainerNameZh: "美極套裝水蓮", pokemonNameZh: "卡璞・蝶蝶" },
];

describe("buildMatcher", () => {
  const match = buildMatcher(RECORDS);

  it("全形/半形差異仍精確比對", () => {
    expect(match("大吾(偵探)&長毛狗")?.pairId).toBe("10090410000");
    expect(match("阿爾套裝阿渡&快龍")?.via).toBe("exact");
  });
  it("綽號別名: 鳳凰→鳳王, 哈奇酷俠→哈奇庫", () => {
    expect(match("阿響&鳳凰")?.pairId).toBe("10112000001");
    expect(match("哈奇酷俠&索羅亞克")?.pairId).toBe("10301000000");
  });
  it("寶可夢名尾端備註去除後比對", () => {
    expect(match("小悠(學院)&沼躍魚(可過水塔27層)")?.pairId).toBe("10019400000");
  });
  it("括號註記不完全一致時用 base+註記包含縮小", () => {
    expect(match("小優(2025週年)&閃焰王牌")?.pairId).toBe("10243410000");
  });
  it("同名多型態取最小 pairId (穩定)", () => {
    expect(match("鎯琊&胡帕")?.pairId).toBe("10066000001");
  });
  it("中點字元差異", () => {
    expect(match("美極套裝水蓮&卡璞·蝶蝶")?.pairId).toBe("10160100000");
  });
  it("catalog 沒有的拍組回 null", () => {
    expect(match("山葵&超甲狂犀")).toBeNull();
  });
  it("無法分辨的多候選 (不同訓練家變體) 寧可回 null, 不硬配", () => {
    // 小優&閃焰王牌: 競技服與 2025週年慶 兩個變體, 沒有註記可縮小 → null
    expect(match("小優&閃焰王牌")).toBeNull();
  });
});

// ── 頁面轉換 ──

const DEBUFF_HTML = [
  "<script>",
  `const MEMBERS_DATA = {"請假王": {"火降抗 [葉子(冠軍)&火焰鳥]": 4, "火特攻 [阿爾套裝丹帝&噴火龍]": 6, "岩降抗 [某人&某獸]": 0}};`,
  `const SUMMARY_DATA = [{"name": "請假王", "火": 10}];`,
  `const MEMBERS_LIST = ["請假王"];`,
  "</script>",
].join("\n");

describe("transformDebuffPage", () => {
  const out = transformDebuffPage(DEBUFF_HTML);
  it("值 0 略過, 其餘轉為 rows", () => {
    expect(out.members).toEqual(["請假王"]);
    expect(out.debuffs).toHaveLength(2);
    expect(out.debuffs[0]).toMatchObject({ member: "請假王", type: "fire", kind: "debuff", value: 4 });
  });
});

const ATTACKER_HTML = [
  "<script>",
  `const scores = {"火物": [{"name": "請假王", "score": 88.5}], "火特": [{"name": "請假王", "score": 70}]};`,
  `const pokemon_data = {"請假王": {"火物": [{"pokemon": "小優(競技服)&閃焰王牌", "value": "寶2"}], "火特": [{"pokemon": "小優(競技服)&閃焰王牌", "value": "寶5"}, {"pokemon": "葉子(冠軍)&火焰鳥", "value": "無持有"}]}};`,
  `const overview = [{"type": "火物", "members": ["請假王"]}];`,
  "</script>",
].join("\n");

describe("transformAttackerPage", () => {
  const out = transformAttackerPage(ATTACKER_HTML);
  it("36 類別分數攤平", () => {
    expect(out.scores).toHaveLength(2);
    expect(out.scores[0]).toMatchObject({ member: "請假王", type: "fire", category: "physical", score: 88.5 });
  });
  it("同拍組跨類別以 (member, 拍組) 去重取最高等級", () => {
    const pair = out.pairs.find((p: { label: string }) => p.label.includes("閃焰王牌"));
    expect(pair?.grade).toBe(5); // 寶2 vs 寶5 → 取 5
    expect(out.pairs).toHaveLength(2);
  });
  it("無持有以 grade 0 保留", () => {
    const none = out.pairs.find((p: { label: string }) => p.label.includes("火焰鳥"));
    expect(none?.grade).toBe(0);
  });
});
