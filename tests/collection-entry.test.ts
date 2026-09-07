// 等級的合法值。
//
// 規則 (2026-09-07 使用者指定): 只有 1 / 140 / 150 / 180 / 200 五個值,
// **Lv1 = 還沒設定**, 其餘一律收回 1。
//
// 為什麼值得寫測試: 這個壞法**完全沒有徵兆** —— Radix 的 Select 在 value 找不到對應的
// SelectItem 時, trigger 會渲染成一片空白 (不是 placeholder, 也不會報錯)。
// 於是「某些人的等級下拉是空的」只有那些人自己看得到, 而且他隨手選一個就把舊值蓋掉了
// (側板是即改即存, 沒有儲存鈕)。所以顯示與寫入都必須先過 normalizeLevel。
//
// Lv1 當預設是刻意的三邊對齊: defaultEntry、user_collection.level 的 DB 預設 (0002)、
// set_member_pair 建列時吃到的值 —— 三個都是 1, 那 167 列 Lv1 才不會看起來像壞掉。

import { describe, expect, it } from "vitest";

import { LEVEL_OPTIONS, defaultEntry, normalizeLevel } from "@/lib/collection-entry";

describe("等級", () => {
  it("合法值就是使用者指定的那五個, Lv1 排第一", () => {
    expect([...LEVEL_OPTIONS]).toEqual([1, 140, 150, 180, 200]);
  });

  it("合法值原樣留著", () => {
    for (const lv of LEVEL_OPTIONS) expect(normalizeLevel(lv)).toBe(lv);
  });

  it("**不在清單裡的一律回 1** — 不補成新選項 (使用者:「其他不是選項內的數字不留」)", () => {
    for (const lv of [100, 130, 175, 199, 2, 141]) {
      expect(normalizeLevel(lv), `Lv${lv}`).toBe(1);
    }
  });

  it("讀不出等級時也回 1, 不要生出 Lv0 / LvNaN", () => {
    expect(normalizeLevel(0)).toBe(1);
    expect(normalizeLevel(Number.NaN)).toBe(1);
    expect(normalizeLevel(-5)).toBe(1);
  });

  it("新點亮拍組的預設是 Lv1 = 還沒設定 (要與 DB 預設一致, 見 0057)", () => {
    const entry = defaultEntry({ pairId: "x", basePotential: 5 } as never);
    expect(entry.level).toBe(1);
    expect(normalizeLevel(entry.level)).toBe(entry.level);
  });

  it("migration 0057 收斂的值與程式碼的清單是同一組", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync("supabase/migrations/0057_member_pairs_level.sql", "utf8");
    // SQL 裡的 not in (...) 必須逐字等於 LEVEL_OPTIONS, 否則資料與畫面會對不起來
    expect(sql).toContain(`level not in (${LEVEL_OPTIONS.join(", ")})`);
  });
});
