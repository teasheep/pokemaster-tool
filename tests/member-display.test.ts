// 成員的「怎麼稱呼、圓圈顯示什麼」—— 兩條全站慣例。
//
// 2026-09-09 成員的意見 (使用者轉述):
//   「大家比較習慣用 LINE 社群名字稱呼彼此, 建議社群的名字放在前面」
//   「圓圈醒目文字可以替每一位會友選定特別的文字, 看到圈圈就可以馬上知道是哪一位會友」
//
// 為什麼值得寫測試: 這兩個函式散在全站幾十個地方 (名冊、看板、下拉、活動紀錄),
// 改壞了不會有錯誤 —— 只是每個人的名字順序反了、或圓圈全部變成同一個字,
// 而那種事沒有人會回報成 bug。

import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { avatarText, memberCallName, memberLabel } from "@/components/gym/member-card";

const 阿呆 = { id: "1", displayName: "ChinHan", lineName: "傑瑞" };

describe("成員顯示名: 社群名在前", () => {
  it("兩個名字都有 → 社群名(遊戲名)", () => {
    expect(memberLabel(阿呆)).toBe("傑瑞(ChinHan)");
  });

  it("沒有社群名 → 只有遊戲名, 不要長出空括號", () => {
    expect(memberLabel({ displayName: "小鳴", lineName: null })).toBe("小鳴");
    expect(memberLabel({ displayName: "小鳴", lineName: "" })).toBe("小鳴");
  });

  it("兩個名字一樣 → 不重複顯示", () => {
    expect(memberLabel({ displayName: "Opal", lineName: "Opal" })).toBe("Opal");
  });

  it("認人用的名字 = 社群名優先", () => {
    expect(memberCallName(阿呆)).toBe("傑瑞");
    expect(memberCallName({ displayName: "小鳴", lineName: null })).toBe("小鳴");
  });
});

describe("頭像圓圈的文字", () => {
  it("有自訂就用自訂 (整段照原樣, 不截斷)", () => {
    expect(avatarText({ ...阿呆, badgeText: "傑瑞" })).toBe("傑瑞");
  });

  it("沒自訂 → 中文取社群名第一個字 (不是遊戲名)", () => {
    expect(avatarText(阿呆)).toBe("傑");
  });

  it("英文取前兩個字母 (一個字母在圓圈裡認不出是誰)", () => {
    expect(avatarText({ id: "2", displayName: "Norman", lineName: null })).toBe("No");
  });

  it("空白的自訂文字當成沒設", () => {
    expect(avatarText({ ...阿呆, badgeText: "   " })).toBe("傑");
  });
});

describe("圓圈文字的長度上限 SQL 與程式碼要一致", () => {
  // 前端 maxLength 與 DB 的 check 對不起來時, 症狀是「存的時候才跳一句英文」——
  // 而那個錯誤訊息使用者看不懂, 也不會知道是長度問題。
  it("資料庫擋 1-3 字, 對話框的 maxLength 也是 3", () => {
    const sql = fs.readFileSync("supabase/migrations/0062_member_badge_text.sql", "utf8");
    expect(sql).toContain("char_length(badge_text) between 1 and 3");
    const ui = fs.readFileSync("src/app/gyms/[id]/members/members-client.tsx", "utf8");
    expect(ui).toMatch(/value=\{badgeText\}[\s\S]{0,200}maxLength=\{3\}/);
  });
});
