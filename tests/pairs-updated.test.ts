// 成員「拍組最後更新」: 名冊講區間, 明細給精確時間 (2026-11-05 使用者指定); 時間來源 = 0086
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { daysSince, formatTaipeiDateTime, pairsUpdatedAgo } from "@/lib/gym/pairs-updated";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 台北時間 → ISO */
const tpe = (s: string) => new Date(`${s}+08:00`).toISOString();
const NOW = Date.parse("2026-11-05T09:00:00+08:00");

describe("名冊第二行的區間", () => {
  it("用台北的日曆日算: 昨晚 23:50 改的, 今天早上看是 1 天前", () => {
    expect(daysSince(tpe("2026-11-04T23:50:00"), NOW)).toBe(1);
    expect(daysSince(tpe("2026-11-05T00:10:00"), NOW)).toBe(0);
    // UTC 已經是 11/05、台北還是 11/04 的那一段 (UTC 16:00 前後) 也要對
    expect(daysSince("2026-11-04T15:59:00Z", NOW)).toBe(1);
    expect(daysSince("2026-11-04T16:01:00Z", NOW)).toBe(0);
  });

  it("今天 / N 天前 / N 週前 / 30 / 60 / 90 天前", () => {
    const at = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
    expect(pairsUpdatedAgo(at(0), NOW)).toBe("今天更新");
    expect(pairsUpdatedAgo(at(1), NOW)).toBe("1 天前更新");
    expect(pairsUpdatedAgo(at(2), NOW)).toBe("2 天前更新");
    expect(pairsUpdatedAgo(at(6), NOW)).toBe("6 天前更新");
    expect(pairsUpdatedAgo(at(7), NOW)).toBe("1 週前更新");
    expect(pairsUpdatedAgo(at(13), NOW)).toBe("1 週前更新");
    expect(pairsUpdatedAgo(at(14), NOW)).toBe("2 週前更新");
    expect(pairsUpdatedAgo(at(29), NOW)).toBe("4 週前更新");
    expect(pairsUpdatedAgo(at(30), NOW)).toBe("30 天前更新");
    expect(pairsUpdatedAgo(at(59), NOW)).toBe("30 天前更新");
    expect(pairsUpdatedAgo(at(60), NOW)).toBe("60 天前更新");
    expect(pairsUpdatedAgo(at(90), NOW)).toBe("90 天前更新");
    expect(pairsUpdatedAgo(at(400), NOW)).toBe("90 天前更新");
  });

  it("沒有時間 / 讀不懂 → 不畫那一行; 未來的時間 (時鐘差) 當今天", () => {
    expect(pairsUpdatedAgo(null, NOW)).toBeNull();
    expect(pairsUpdatedAgo("not a date", NOW)).toBeNull();
    expect(pairsUpdatedAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe("今天更新");
  });
});

describe("明細的精確時間", () => {
  it("台北時間, 固定 YYYY/MM/DD HH:mm (不靠執行環境的 locale)", () => {
    expect(formatTaipeiDateTime("2026-11-04T13:58:59Z")).toBe("2026/11/04 21:58");
    expect(formatTaipeiDateTime("2026-12-31T16:05:00Z")).toBe("2027/01/01 00:05");
    expect(formatTaipeiDateTime(null)).toBeNull();
  });
});

describe("接線", () => {
  it("pairs-updated.ts 是中立模組 (page.tsx 要 import)", () => {
    expect(read("src/lib/gym/pairs-updated.ts")).not.toMatch(/^\s*["']use client["']/m);
  });

  it("page.tsx 打 0086 的 RPC, 讀不到不擋整頁; 「現在」由 server 給", () => {
    const page = read("src/app/gyms/[id]/members/page.tsx");
    expect(page).toContain('rpc("gym_pairs_last_updated"');
    expect(page).toMatch(/r\.error \? \[\]/);
    expect(page).toContain("nowMs={requestNowMs()}");
  });

  it("名冊第二行 + 明細精確時間都有畫", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(client).toMatch(/subline=\{[\s\S]{0,200}data-pairs-updated/);
    expect(client).toContain("data-pairs-updated-exact");
    expect(read("src/components/gym/member-card.tsx")).toContain("{subline}");
  });

  it("0086: 時間取帳號那一份; anon 收權限; 只回這一館的正式成員", () => {
    const sql = read("supabase/migrations/0086_gym_pairs_last_updated.sql");
    expect(sql).toMatch(/max\(c\.updated_at\) from public\.user_collection/);
    expect(sql).toMatch(/revoke all on function public\.gym_pairs_last_updated\(uuid\) from public, anon/);
    expect(sql).toMatch(/is_gym_member\(p_gym\)/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/role <> 'advisor'/);
  });
});
