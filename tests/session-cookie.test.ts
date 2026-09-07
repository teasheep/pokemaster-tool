// middleware 的樂觀檢查 —— 這是**安全性相關**的測試, 紅了不要改測試去配合程式。
//
// 背景: 已登入的每一次導覽原本要付兩趟 auth 往返, middleware 那趟實測 77-973ms。
// 現在只有「快到期 / 已過期 / 讀不出來 / 登入註冊頁」才打網路, 其餘樂觀放行。
//
// 這裡釘住的是**失效方向**: 任何看不懂的東西都必須回 "authoritative" (走完整流程),
// 絕對不可以因為讀不出 cookie 就樂觀放行。
// 真正的授權不在這裡 (在各頁的 getSessionUser() 與 RLS), 但這一層放寬了的話,
// 「多渲染一次就被導走」會變成「一直渲染都不被導走」—— 那才是使用者看得到的壞法。

import { describe, expect, it } from "vitest";

import {
  REFRESH_MARGIN_S,
  hasSupabaseAuthCookie,
  proxyMode,
  readSessionExpiry,
} from "@/lib/supabase/session-cookie";

const KEY = "sb-abcdefghijklmnop-auth-token";
const NOW = 1_757_000_000_000; // 固定時間, 測試不吃系統時鐘
const NOW_S = NOW / 1000;

/** 造一個 @supabase/ssr 格式的 cookie (base64- 前綴 + base64url 的 session JSON) */
function sessionCookie(expiresAt: number, extra: Record<string, unknown> = {}) {
  const json = JSON.stringify({
    access_token: "fake",
    refresh_token: "fake",
    expires_at: expiresAt,
    user: { id: "u1", name: "小霞與皮卡丘" }, // 故意放中文: UTF-8 要解得開
    ...extra,
  });
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .split("+")
    .join("-")
    .split("/")
    .join("_")
    .split("=")
    .join("");
  return [{ name: KEY, value: "base64-" + b64 }];
}

describe("hasSupabaseAuthCookie", () => {
  it("認得 sb-<ref>-auth-token 與它的分塊", () => {
    expect(hasSupabaseAuthCookie([{ name: KEY }])).toBe(true);
    expect(hasSupabaseAuthCookie([{ name: KEY + ".0" }])).toBe(true);
    expect(hasSupabaseAuthCookie([{ name: "other" }])).toBe(false);
    expect(hasSupabaseAuthCookie([])).toBe(false);
  });
});

describe("readSessionExpiry", () => {
  it("讀得出 base64 的 session (含中文)", () => {
    expect(readSessionExpiry(sessionCookie(NOW_S + 3600))).toBe(NOW_S + 3600);
  });

  it("讀得出沒有 base64 前綴的舊格式 (純 JSON)", () => {
    const json = JSON.stringify({ expires_at: 12345 });
    expect(readSessionExpiry([{ name: KEY, value: json }])).toBe(12345);
  });

  it("分塊依數字接回去 (超過 10 塊時字串排序會接錯)", () => {
    const json = JSON.stringify({ expires_at: 999 });
    const parts = json.match(/.{1,3}/g)!;
    const cookies = parts.map((value, i) => ({ name: `${KEY}.${i}`, value }));
    expect(cookies.length).toBeGreaterThan(1);
    expect(readSessionExpiry(cookies)).toBe(999);
    // 順序打亂也要接得回來 (瀏覽器送 cookie 的順序沒有保證)
    expect(readSessionExpiry([...cookies].reverse())).toBe(999);
  });

  it("看不懂的一律回 null (呼叫端會因此走完整流程)", () => {
    expect(readSessionExpiry([])).toBe(null);
    expect(readSessionExpiry([{ name: KEY, value: "" }])).toBe(null);
    expect(readSessionExpiry([{ name: KEY, value: "not-json" }])).toBe(null);
    expect(readSessionExpiry([{ name: KEY, value: "base64-!!!!" }])).toBe(null);
    // expires_at 不是數字
    expect(readSessionExpiry([{ name: KEY, value: JSON.stringify({ expires_at: "soon" }) }])).toBe(
      null
    );
    // 沒有 expires_at
    expect(readSessionExpiry([{ name: KEY, value: JSON.stringify({ access_token: "x" }) }])).toBe(
      null
    );
  });
});

describe("proxyMode", () => {
  it("沒有 cookie = 訪客", () => {
    expect(proxyMode([], "/gyms", NOW)).toBe("guest");
  });

  it("token 還很新 → 樂觀放行 (不打網路)", () => {
    expect(proxyMode(sessionCookie(NOW_S + 3600), "/gyms", NOW)).toBe("optimistic");
    expect(proxyMode(sessionCookie(NOW_S + REFRESH_MARGIN_S + 1), "/pairs", NOW)).toBe("optimistic");
  });

  it("快到期 / 已過期 → 走完整流程 (要刷新並輪替 cookie)", () => {
    expect(proxyMode(sessionCookie(NOW_S + REFRESH_MARGIN_S), "/gyms", NOW)).toBe("authoritative");
    expect(proxyMode(sessionCookie(NOW_S + 10), "/gyms", NOW)).toBe("authoritative");
    expect(proxyMode(sessionCookie(NOW_S - 1), "/gyms", NOW)).toBe("authoritative");
    expect(proxyMode(sessionCookie(NOW_S - 86400), "/gyms", NOW)).toBe("authoritative");
  });

  it("/login 與 /register 一律權威判斷 (否則壞掉的 cookie 會在兩頁之間彈跳)", () => {
    expect(proxyMode(sessionCookie(NOW_S + 3600), "/login", NOW)).toBe("authoritative");
    expect(proxyMode(sessionCookie(NOW_S + 3600), "/register", NOW)).toBe("authoritative");
  });

  it("讀不出來的 cookie 一律走完整流程 —— 失效方向是「慢但正確」", () => {
    for (const value of ["", "not-json", "base64-!!!!", JSON.stringify({ foo: 1 })]) {
      expect(proxyMode([{ name: KEY, value }], "/gyms", NOW)).toBe("authoritative");
    }
  });

  it("偽造的 cookie 只會拿到樂觀放行, 不是授權 —— 這一層本來就不驗簽", () => {
    // 這條是文件也是提醒: 任何人都能造出這個 cookie。擋住他的是頁面的 getSessionUser()
    // 與 RLS, 不是這裡。這一層放寬的代價是「多渲染一次馬上被導走的頁面」。
    const forged = [{ name: KEY, value: JSON.stringify({ expires_at: NOW_S + 99999 }) }];
    expect(proxyMode(forged, "/gyms", NOW)).toBe("optimistic");
  });
});
