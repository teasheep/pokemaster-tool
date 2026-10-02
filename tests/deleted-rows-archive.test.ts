// 道館資料刪了要救得回來 (0082, 2026-10-01 使用者:「救不回來? 你應該要有之前的紀錄才對 這個問題得修」)。
// 這個壞法完全沒有徵兆 —— 封存漏了一張表, 平常什麼事都沒有, 要等到真的誤刪那天才發現救不回來。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const M = read("supabase/migrations/0082_deleted_rows_archive.sql");
/**
 * 封存清單 = 0082 那份 + 之後每一支 migration 自己補掛的 (同一個 foreach … archive_deleted_rows 寫法)。
 * 之後的表**不能**加進 0082 的清單: 新專案從頭重建時 0082 先跑, 那時候表還不存在 (0083 起是這樣)。
 */
const archived = (() => {
  const out = new Set<string>();
  for (const f of fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).sort()) {
    if (f < "0082") continue;
    const sql = read(`supabase/migrations/${f}`);
    if (!sql.includes("archive_deleted_rows()")) continue;
    for (const m of sql.matchAll(/foreach t in array array\[([\s\S]*?)\] loop/g))
      for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) out.add(t[1]!);
  }
  return out;
})();

/** migrations 裡建過、有 gym_id 欄位的道館資料表 (create table … gym_id) */
function gymTables(): string[] {
  const out = new Set<string>();
  for (const f of fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).sort()) {
    const sql = read(`supabase/migrations/${f}`);
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+) \(([\s\S]*?)\n\);/g)) {
      if (/\bgym_id uuid\b/.test(m[2]!)) out.add(m[1]!);
    }
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.([a-z_]+)/g)) out.delete(m[1]!);
  }
  return [...out];
}

describe("0082 刪除封存", () => {
  it("每一張道館資料表都有封存 (新增道館資料表時要加進清單)", () => {
    // gym_activity 本身就是紀錄; deleted_rows 是封存本身; gym_invites 是邀請碼 (換碼就是刪舊的)
    const exempt = new Set(["gym_activity", "deleted_rows", "gym_invites"]);
    for (const t of gymTables().filter((t) => !exempt.has(t))) {
      expect(archived.has(t), `${t} 沒有掛刪除封存`).toBe(true);
    }
    expect(archived.has("gyms")).toBe(true);
  });
  it("個人帳號資料刻意不封存 (刪帳號是隱私權)", () => {
    for (const t of ["profiles", "user_collection", "shares"]) expect(archived.has(t), t).toBe(false);
  });
  it("連 cascade 都接得到: AFTER DELETE statement 級 + transition table", () => {
    expect(M).toMatch(/after delete on public\.%I referencing old table as old_rows/);
    expect(M).toMatch(/for each statement execute function public\.archive_deleted_rows\(\)/);
  });
  it("封存沒有外鍵 (整館刪掉也要留著), 一般使用者讀寫都不行", () => {
    expect(M).toMatch(/gym_id uuid,\s+-- /);
    expect(M).not.toMatch(/deleted_rows[\s\S]{0,400}references public\.gyms/);
    expect(M).toMatch(/revoke all on public\.deleted_rows from anon, authenticated/);
    expect(M).not.toMatch(/create policy [a-z_]+ on public\.deleted_rows/);
  });
});
