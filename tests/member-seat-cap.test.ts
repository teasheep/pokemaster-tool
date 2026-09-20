// 道館正式成員上限 20 (0075)。
//
// 背景: 2026-09-20 成員回報「道館可以超過 20 人」。查下來**不是壞掉, 是從來沒實作過** ——
// join_gym 沒檢查、gym_members 沒 constraint 也沒 trigger、核准就是一句 update。
// 線上「九彩」9/12 滿 20, 9/19 被管理員放行第 21 人。
//
// 這一檔釘的三件事, 壞掉都**沒有徵兆**:
//   1. 前端的數字與資料庫的數字對不上 —— 夾得鬆就是管理員看到一句英文 `GYM_FULL`,
//      夾得緊就是按了沒反應。
//   2. 誰佔名額的定義 (顧問不佔、待確認不佔、管理員佔) 與 0028/0072 一致。
//   3. ⚠ trigger 只檢查「這一列**變成**佔名額」, 不檢查既有列 —— 少了這個守門條件,
//      已經 21 人的九彩會連改個名字都撞 GYM_FULL, 整館動不了。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GYM_SEAT_CAP, countSeats, occupiesSeat } from "@/lib/gym/membership";

const MIG = path.join(process.cwd(), "supabase", "migrations", "0075_member_seat_cap.sql");
const sql = fs.readFileSync(MIG, "utf8");

describe("名額怎麼算", () => {
  const rows = [
    { role: "admin", status: "active" },
    { role: "member", status: "active" },
    { role: "advisor", status: "active" },   // 顧問不佔 (0028/0072)
    { role: "member", status: "pending" },   // 還沒放行
    { role: "advisor", status: "pending" },
  ];
  it("管理員算、成員算、顧問不算、待確認不算", () => {
    expect(countSeats(rows)).toBe(2);
    expect(occupiesSeat({ role: "admin", status: "active" })).toBe(true);
    expect(occupiesSeat({ role: "advisor", status: "active" })).toBe(false);
    expect(occupiesSeat({ role: "member", status: "pending" })).toBe(false);
  });
  it("status 讀不到時當成 active（與 isActiveMember 同一條：部署與 migration 不同時落地）", () => {
    expect(occupiesSeat({ role: "member" })).toBe(true);
  });
});

describe("前端與資料庫是同一個數字", () => {
  it("migration 裡的門檻等於 GYM_SEAT_CAP", () => {
    const m = sql.match(/v_seats\s*>=\s*(\d+)/);
    expect(m, "0075 裡找不到 `v_seats >= <數字>`").not.toBeNull();
    expect(Number(m![1])).toBe(GYM_SEAT_CAP);
  });
});

describe("trigger 的守門條件", () => {
  it("掛在 gym_members 的 insert 與 update 上", () => {
    expect(sql).toMatch(/create trigger gym_members_seat_cap/);
    expect(sql).toMatch(/before insert or update on public\.gym_members/);
  });
  it("只算 active 且非顧問", () => {
    expect(sql).toMatch(/status\s*=\s*'active'/);
    expect(sql).toMatch(/role\s*<>\s*'advisor'/);
  });
  it("⚠ 既有佔名額的列要提早放行，否則超額的道館會整館卡死", () => {
    // 這一段就是「九彩 21 人還改得動」的唯一保證
    expect(sql).toMatch(/old\.status\s*=\s*'active'\s*and\s*old\.role\s*<>\s*'advisor'/);
  });
  it("計數要排除自己那一列（UPDATE 時不能把自己算進去）", () => {
    expect(sql).toMatch(/id\s*<>\s*new\.id/);
  });
  it("擋下來時丟的是 GYM_FULL（前端靠它翻成人話）", () => {
    expect(sql).toMatch(/raise exception 'GYM_FULL'/);
  });
});

describe("前端會先擋並說明原因", () => {
  const client = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "gyms", "[id]", "members", "members-client.tsx"), "utf8");
  it("核准前先算名額", () => {
    expect(client).toMatch(/countSeats\(members\)\s*>=\s*GYM_SEAT_CAP/);
  });
  it("也要接住資料庫丟回來的 GYM_FULL（兩個管理員同時按勾勾）", () => {
    expect(client).toMatch(/GYM_FULL/);
  });
});
