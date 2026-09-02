// 登入後的導向 —— 兩條登入路徑 (signInWithOAuth 的 /auth/callback、One Tap 的 /auth/one-tap)
// 共用同一支 safeNextPath()。它同時是 **open redirect 的防線** (AGENTS.md 安全紅線:
// 「login redirect 參數只接受 / 開頭且非 //」), 所以規則寫成測試釘住, 不要只靠人眼。

import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/post-login-destination";

describe("safeNextPath — 只接受站內路徑", () => {
  it("站內路徑原樣通過", () => {
    expect(safeNextPath("/pairs")).toBe("/pairs");
    expect(safeNextPath("/gyms/abc/members")).toBe("/gyms/abc/members");
    expect(safeNextPath("/pairs?scope=all")).toBe("/pairs?scope=all");
  });

  it("擋掉協定相對網址 (//host = 瀏覽器會當成外站)", () => {
    expect(safeNextPath("//evil.example")).toBe("/gyms");
    expect(safeNextPath("///evil.example")).toBe("/gyms");
  });

  it("擋掉絕對網址與其他協定", () => {
    expect(safeNextPath("https://evil.example")).toBe("/gyms");
    expect(safeNextPath("http://evil.example")).toBe("/gyms");
    expect(safeNextPath("javascript:alert(1)")).toBe("/gyms");
  });

  it("空值 / 沒帶參數 → 預設值", () => {
    expect(safeNextPath(null)).toBe("/gyms");
    expect(safeNextPath(undefined)).toBe("/gyms");
    expect(safeNextPath("")).toBe("/gyms");
  });

  it("呼叫端可以指定自己的 fallback (/auth/callback 沿用原本的 /pairs)", () => {
    expect(safeNextPath(null, "/pairs")).toBe("/pairs");
    expect(safeNextPath("//evil.example", "/pairs")).toBe("/pairs");
  });
});
