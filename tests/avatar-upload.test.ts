// 頭貼上傳 (2026-09-29 成員回報「個人設定沒辦法上傳更改頭貼」)。
//
// uploadAvatar() 用 upsert:true (換頭貼 = 覆蓋同一個 `{uid}.webp`), 而 Supabase Storage 的 upsert
// 需要 **INSERT + UPDATE + SELECT** 三種 policy。少了 SELECT 的症狀是每一次上傳都
// `new row violates row-level security policy` —— 0024 到 0076 這段期間就是這樣, 上線以來一個檔都沒傳成功,
// 而且沒有人察覺 (有 Google 頭貼墊著, 畫面看起來正常)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "supabase", "migrations");
const all = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
  .join("\n");

describe("avatars bucket 的 storage policy", () => {
  it("upsert 要的三種都有: insert / update / select", () => {
    for (const cmd of ["insert", "update", "select"]) {
      expect(all, `缺 avatars 的 ${cmd} policy`).toMatch(
        new RegExp(`create policy \\w+ on storage\\.objects\\s+for ${cmd} to authenticated[\\s\\S]{0,200}bucket_id = 'avatars'`)
      );
    }
  });
  it("SELECT 只看得到自己的那一個檔 (讀頭貼走公開網址, 不需要更寬)", () => {
    const sel = all.match(/for select to authenticated[\s\S]*?\);/)![0];
    expect(sel).toMatch(/auth\.uid\(\)::text \|\| '\.webp'/);
    expect(sel).not.toMatch(/like/);
  });
  it("前端仍然是 upsert (換頭貼覆蓋同一個檔) —— 改掉的話這條 policy 的理由要重看", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src", "lib", "profile.ts"), "utf8");
    expect(code).toMatch(/upsert: true/);
  });
});
