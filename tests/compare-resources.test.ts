// 成員頁「比較」的資源 (2026-11-06 使用者:「可以再幫我加比較資源的部分嗎?」):
// 選了誰 × 背包的道具 (數量) / 投入屬性。兩個壞法都沒有徵兆 —— 分組跟背包對不起來 (少一種道具),
// 或是單發查詢被截在 1000 列 (某幾個人那一列整排空白, 看起來就像「他沒有」)。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANDY_GROUPS } from "@/components/gym/candy";
import { COMPARE_RES_KEYS, parseCompareRes, serializeCompareRes } from "@/lib/gym/compare-params";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const view = strip(read("src/app/gyms/[id]/members/compare-view.tsx"));
const image = strip(read("src/app/gyms/[id]/members/compare-image.ts"));
const fnBody = (name: string) => {
  const at = view.indexOf(`function ${name}(`);
  return view.slice(at, view.indexOf("\nfunction ", at + 10));
};

describe("?res=", () => {
  it("手抄的 key = 背包的分組 (同一個順序) + 投入屬性", () => {
    expect([...COMPARE_RES_KEYS]).toEqual([...CANDY_GROUPS.map((g) => g.key), "focus"]);
  });

  it("照固定順序讀寫, 不認得的丟掉, 沒選就不留", () => {
    expect(parseCompareRes("focus,candy,candy,<x>")).toEqual(["candy", "focus"]);
    expect(serializeCompareRes(["focus", "candy"])).toBe("candy,focus");
    expect(serializeCompareRes([])).toBeNull();
    expect(parseCompareRes(undefined)).toEqual([]);
  });

  it("compare-params 沒有 import candy.tsx (那支是 use client, server 的 page.tsx 會讀到 client reference)", () => {
    expect(read("src/lib/gym/compare-params.ts")).not.toMatch(/from "@\/components\/gym\/candy"/);
  });
});

describe("資源那一排 = 背包的分組 + 投入屬性", () => {
  it("chips 吃 CANDY_GROUPS (與 /resources、成員頁的「資源」分頁同一份), 最後一顆是投入屬性", () => {
    expect(view).toMatch(/<PickRow label="資源">\s*\{CANDY_GROUPS\.map\(\(g\) => \(\s*<Chip/);
    expect(view).toMatch(/<Chip active=\{res\.includes\("focus"\)\} onClick=\{\(\) => toggleRes\("focus"\)\}/);
  });

  it("全館一次抓, 兩張表都走 fetchAllRows + order(id) (單發會被截在 1000 列)", () => {
    for (const table of ["member_candies", "member_type_focus"]) {
      expect(view).toMatch(
        new RegExp(`fetchAllRows[\\s\\S]{0,200}\\.from\\("${table}"\\)[\\s\\S]{0,120}\\.eq\\("gym_id", gymId\\)\\s*\\.order\\("id"\\)\\s*\\.range\\(a, b\\)`),
      );
    }
  });

  it("取消一組道具, 那幾種道具的排序跟著拿掉 (與拿掉指定拍組同一個做法)", () => {
    expect(view).toMatch(/sort: s\.sort\.filter\(\(x\) => !items\.has\(x\)\)/);
  });
});

describe("資源表", () => {
  it("成員順序是全部表格共用的那一份; 這張表什麼都沒有的人收成下面一行", () => {
    expect(view).toMatch(/const cols = ordered\.filter\(has\);[\s\S]{0,300}rest: ordered\.filter\(\(m\) => !has\(m\)\)/);
  });

  it("道具欄的值 = 數量, 跟拍組的寶數疊在同一串排序裡", () => {
    expect(view).toMatch(/candyKeys\.has\(key\)\s*\?\s*\(candyOf\?\.get\(m\.id\)\?\.\[key as CandyType\] \?\? 0\)/);
  });

  it("欄頭是背包那一格 (CandyPlate), 也是排序鈕; 0 就空著", () => {
    const t = fnBody("ItemTable");
    expect(t).toMatch(/<SortButton[\s\S]{0,600}<CandyPlate type=\{t\}/);
    expect(t).toMatch(/n > 0 \? \(\s*<span data-compare-count/);
    expect(t).toContain("<MemberHead m={m} />");
  });

  it("投入屬性: 兩欄 (想投入 / 已投入較多), 欄名是 /resources 那兩塊的同一組字", () => {
    const t = fnBody("FocusTable");
    expect(t).toMatch(/TYPE_FOCUS_KINDS\.map[\s\S]{0,400}TYPE_FOCUS_LABELS\[k\]/);
    expect(t).toMatch(/<TypeIcon type=\{t\}/);
  });
});

describe("下載圖片也畫資源表", () => {
  it("畫面上的資源表一起進圖 (同一份 resGroups)", () => {
    expect(view).toMatch(/\.\.\.resGroups\.map\(\(g\) =>/);
  });

  it("道具圖與圓盤跟畫面同一支 (candyIconSrc / candyPlateSrc), 不要自己拼路徑", () => {
    expect(image).toMatch(/candyPlateSrc\(t\)/);
    expect(image).toMatch(/candyIconSrc\(t\)/);
    expect(image).not.toMatch(/\/reference\/ui\//);
    const candy = strip(read("src/components/gym/candy.tsx"));
    expect(candy).toMatch(/src=\{candyIconSrc\(type\)\}/);
    expect(candy).toMatch(/src=\{candyPlateSrc\(type\)\}/);
  });
});
