// 拍組繁中名不可以出現全形英數字 (2026-09-10 使用者:「有些是全形有些半形, 我想要統一半形」)。
//
// 為什麼值得測: 這條壞掉的方式是**上游更新把它帶回來**, 而畫面照樣渲染 ——
// 只有剛好看到「琴音（２０２０夏季）」與「赤紅（2025週年慶）」並排的人才會發現。
// 而且它不只是好不好看: pairName() 的產出會被寫進 member_pairs / gym_pairs 的 pair_label,
// 那兩張表的唯一鍵就是 label —— 名字一改, upsert 就對不上舊列, 同一張卡會長出第二列 (0070 的檔頭)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type Rec = { pairId: string; trainerNameZh?: string | null; pokemonNameZh?: string | null };

const records: Rec[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src/data/pomatools-pairs.json"), "utf8")
).records;

/** 全形英數字 (Ａ-Ｚ ａ-ｚ ０-９); 全形括號刻意不管 —— 中文排版本來就用全形 */
const FULLWIDTH = /[Ａ-Ｚａ-ｚ０-９]/;

describe("拍組名的全形英數字", () => {
  it("catalog 裡一個都不剩", () => {
    const bad = records
      .filter((r) => FULLWIDTH.test(`${r.trainerNameZh ?? ""}${r.pokemonNameZh ?? ""}`))
      .map((r) => `${r.pairId} ${r.trainerNameZh} & ${r.pokemonNameZh}`);
    expect(bad, `還有全形英數字 (重跑 npm run data:names):\n${bad.join("\n")}`).toEqual([]);
  });

  it("轉換那一步還留在資料管線裡", () => {
    // 只改一次沒有用 —— 下次 data:update 從上游抓回來又會是全形
    const pipeline = fs.readFileSync(
      path.join(process.cwd(), "scripts/update-catalog.mjs"),
      "utf8"
    );
    expect(pipeline).toContain("normalize-pair-names.mjs");
  });

  it("全形括號維持原樣 (那個本來就一致, 不是要統一的東西)", () => {
    const full = records.filter((r) => /[（）]/.test(r.trainerNameZh ?? "")).length;
    const half = records.filter((r) => /[()]/.test(r.trainerNameZh ?? "")).length;
    expect(full).toBeGreaterThan(100);
    expect(half).toBe(0);
  });
});
