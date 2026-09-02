// Google One Tap 的 nonce 契約 —— 給反了就是 401「Nonces mismatch」, 而且錯誤訊息
// 完全看不出是方向問題。這支測試把「格式」與「兩份不同」釘住。
//
// 契約來源 (gotrue 的實作, 不是文件推測):
//   hash := fmt.Sprintf("%x", sha256.Sum256([]byte(params.Nonce)))
//   if hash != idToken.Nonce { ... "Nonces mismatch" }
// → hashed = SHA-256 的**小寫 hex**; 給 Google 的是 hashed, 給 Supabase 的是 raw。

import { describe, expect, it } from "vitest";

import { generateOneTapNonce, sha256Hex } from "@/lib/auth/one-tap-nonce";

describe("sha256Hex", () => {
  it("是小寫 hex, 不是 base64 (gotrue 用 %x)", async () => {
    // 已知向量: sha256("abc")
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("固定 64 字元且只有 0-9a-f", async () => {
    const hex = await sha256Hex("pm-gym");
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateOneTapNonce", () => {
  it("hashed 必須等於 sha256Hex(raw) —— 這就是 Supabase 那頭會做的比對", async () => {
    const { raw, hashed } = await generateOneTapNonce();
    expect(hashed).toBe(await sha256Hex(raw));
  });

  it("raw 與 hashed 不同 (給反了才會兩個一樣, 那就是 bug)", async () => {
    const { raw, hashed } = await generateOneTapNonce();
    expect(raw).not.toBe(hashed);
    expect(raw.length).toBeGreaterThan(0);
  });

  it("每次都不一樣 (nonce 是一次性的, 不可以被快取)", async () => {
    const a = await generateOneTapNonce();
    const b = await generateOneTapNonce();
    expect(a.raw).not.toBe(b.raw);
  });
});
