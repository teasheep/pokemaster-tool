// 屬性資源方向 (0056) 的兩條不變量。
//
// 為什麼值得寫測試: 這兩條壞掉都不會有畫面上的徵兆 ——
//   - migration 的 check 與 UI 的 18 屬性對不上 → 那個屬性按了會 toast「更新失敗」,
//     而且只有那一格壞, 其他 17 格正常, 沒有人會想到是資料庫的 check 少一種;
//   - kind 對不上 → 選了存不進去 (insert 被 check 擋), 或是存進去了但畫面讀不出來
//     (load 時 next[kind] 不存在, 那一列被默默丟掉)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_TYPES } from "@/data/sync-pairs";
import { TYPE_FOCUS_KINDS, emptyTypeFocus, toggleType } from "@/components/gym/type-focus";
import type { SyncPairType } from "@/lib/supabase/types";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/0056_member_type_focus.sql"),
  "utf8"
);

/** 抓 migration 裡 `<欄位> in ('a', 'b', ...)` 的字串清單 (單引號的奇數段就是值) */
function checkValues(column: string): string[] {
  const head = column + " in (";
  const i = sql.indexOf(head);
  if (i < 0) throw new Error("0056 找不到 " + column + " 的 check");
  const body = sql.slice(i + head.length, sql.indexOf(")", i));
  return body.split("'").filter((_, k) => k % 2 === 1);
}

describe("0056 的 check 與程式碼同一份", () => {
  it("18 屬性 = ALL_TYPES", () => {
    expect(checkValues("type").sort()).toEqual([...ALL_TYPES].sort());
  });

  it("kind = TYPE_FOCUS_KINDS", () => {
    expect(checkValues("kind").sort()).toEqual([...TYPE_FOCUS_KINDS].sort());
  });

  it("兩種 kind 在空白狀態下都有自己的陣列", () => {
    const empty = emptyTypeFocus();
    for (const k of TYPE_FOCUS_KINDS) expect(empty[k]).toEqual([]);
    // 每次都要是新陣列, 不然兩個呼叫端會共用同一份
    expect(emptyTypeFocus().want).not.toBe(empty.want);
  });
});

describe("toggleType", () => {
  const fire = "fire" as SyncPairType;
  const water = "water" as SyncPairType;

  it("沒有就加, 有就拿掉", () => {
    expect(toggleType([], fire)).toEqual([fire]);
    expect(toggleType([fire], fire)).toEqual([]);
  });

  it("一律照 ALL_TYPES 的順序排 — 點選先後不影響顯示", () => {
    // water 在 ALL_TYPES 裡排在 fire 後面, 先點 water 也要排回去
    expect(toggleType([water], fire)).toEqual([fire, water]);
  });

  it("不改動傳進來的陣列", () => {
    const list = [fire];
    toggleType(list, water);
    expect(list).toEqual([fire]);
  });
});
