// 拍檔石盤 (同步能力盤能量上限) 的規則測試。
//
// 遊戲規則由使用者確認 (2026-09-09, 他是實際在玩的人):
//   六段 60/62/64/66/68/70, 存索引 0-5;
//   **能升到第幾段受寶數限制**: 上限 = 索引 = 寶數。
//
// 為什麼要測: 這條規則寫錯的話會產生「遊戲裡不可能存在」的資料 (例如寶1 卻滿盤),
// 而畫面照樣渲染得出來 —— 沒有任何徵兆, 只有懂遊戲的人看到才會覺得怪。
//
// 資料庫欄位 (0063) 與 set_member_pair 的新簽章 (0066) 已於 2026-09-10 套用到線上;
// **上限那條在兩條寫入路徑各有一份** (RPC 的 v_grid_cap 與 syncMemberPair 的 clamp),
// 因為兩條路可以各自被用到 —— 這裡測的是程式碼那一份。

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SYNC_GRID_CAPS,
  clampSyncGrid,
  cycleSyncGrid,
  maxSyncGrid,
} from "@/lib/collection-entry";

describe("拍檔石盤段數", () => {
  it("六段對應 60 到 70", () => {
    expect([...SYNC_GRID_CAPS]).toEqual([60, 62, 64, 66, 68, 70]);
  });

  it("上限索引 = 寶數 (寶1→62 … 寶5→70)", () => {
    // 2026-09-10 使用者更正:「上限應該都多 2」—— 第一版是 min(4, 寶數) + 1, 每段都多開一格。
    expect(maxSyncGrid(0)).toBe(0); // 寶0 只有 60 = 還沒開始升
    expect(maxSyncGrid(1)).toBe(1); // 62
    expect(maxSyncGrid(2)).toBe(2); // 64
    expect(maxSyncGrid(3)).toBe(3); // 66
    expect(maxSyncGrid(4)).toBe(4); // 68
    expect(maxSyncGrid(5)).toBe(5); // 70
    // 超覺醒那條軸傳進來的是夾過的 5, 不會再往上開
    expect(maxSyncGrid(10)).toBe(5);
  });

  it("SQL 端 (set_member_pair) 與程式碼是同一條規則", () => {
    // 兩條寫入路徑可以各自被用到 —— 只改一邊的話, 另一邊會寫進遊戲裡不可能的值,
    // 而且畫面照樣渲染得出來 (0066 就是這樣把上限寫成 least(4, v_pot) + 1 的)。
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0067_sync_grid_cap_fix.sql"),
      "utf8"
    );
    // 先剝掉 -- 註解: 檔頭本來就會引用舊公式來說明它為什麼是錯的
    const code = sql.replace(/--.*/g, "");
    expect(code).toContain("v_grid_cap := v_pot;");
    expect(code, "0067 又寫回舊公式了").not.toContain("least(4, v_pot) + 1");
  });

  it("循環到上限就繞回 0", () => {
    // 寶5: 0 → 1 → … → 5 → 0
    expect(cycleSyncGrid(0, 5)).toBe(1);
    expect(cycleSyncGrid(4, 5)).toBe(5);
    expect(cycleSyncGrid(5, 5)).toBe(0);
    // 寶1: 只能到索引 1 (62), 再點就歸零
    expect(cycleSyncGrid(0, 1)).toBe(1);
    expect(cycleSyncGrid(1, 1)).toBe(0);
    // 寶0: 根本沒得升
    expect(cycleSyncGrid(0, 0)).toBe(0);
  });

  it("寶數退回去時拍檔石盤跟著夾回合法範圍", () => {
    // 本來滿盤 (5), 寶數掉到 1 → 上限剩 1
    expect(clampSyncGrid(5, 1)).toBe(1);
    expect(clampSyncGrid(5, 0)).toBe(0);
    // 沒超過就不動
    expect(clampSyncGrid(1, 4)).toBe(1);
  });

  it("髒值一律夾回合法範圍, 不要丟出去", () => {
    expect(cycleSyncGrid(-3, 4)).toBe(1);
    expect(clampSyncGrid(99, 4)).toBe(4);
    expect(maxSyncGrid(-1)).toBe(0);
  });
});
