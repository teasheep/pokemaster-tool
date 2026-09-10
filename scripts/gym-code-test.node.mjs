// 建館碼 (封測) 的端對端驗證 —— 用真的 Chrome 點下去。
//
// 這條路沒辦法只靠單元測試驗: 它橫跨 RPC 簽章、RLS、前端對話框、教學的分叉,
// 而且失敗的樣子多半是「畫面沒反應」或「跳一句英文」, SSR 探測看不到。
//
// 會建**隔離的測試帳號與測試道館**, 跑完 (含失敗) 一定刪掉 —— 不碰那 20 位真實成員。
// 用法: npm run qa:gymcode              打本機 (dev server 要在 3030 跑著)
//       QA_BASE=https://pokemaster-tool.com npm run qa:gymcode   打線上 (部署後驗收)

import fs from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.QA_BASE ?? "http://localhost:3030";
const DOMAIN = new URL(BASE).hostname;
const EMAIL = "qa-gymcode@example.invalid";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(SB).hostname.split(".")[0];
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const results = [];
const check = (ok, name, detail = "") => {
  results.push({ ok: Boolean(ok), name });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
};

let userId = null, gymId = null, browser = null;
const codes = [];

try {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL, email_confirm: true, password: crypto.randomUUID(),
  });
  if (cErr) throw new Error("建帳號: " + cErr.message);
  userId = created.user.id;
  await admin.from("profiles").update({ display_name: "建館碼 QA", onboarded_at: new Date().toISOString() }).eq("id", userId);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  const { data: sess } = await anon.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });

  const raw = "base64-" + Buffer.from(JSON.stringify(sess.session), "utf8").toString("base64url");
  const NAME = `sb-${ref}-auth-token`;
  const parts = raw.length <= 3180 ? [[NAME, raw]] : raw.match(/.{1,3180}/g).map((c, i) => [`${NAME}.${i}`, c]);
  browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(parts.map(([name, value]) => ({ name, value, domain: DOMAIN, path: "/" })));
  // 教學會自己跳出來, 而且教學開著時所有寫入都被吞掉 → 先標記成看過, 建館那幾步才驗得到真的行為
  await ctx.addInitScript((k) => { try { localStorage.setItem(k, "1"); } catch {} }, `pm-gym:tour-seen:v1:${userId}`);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message).split("\n")[0]));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

  const openCreate = async () => {
    await page.goto(`${BASE}/gyms?list=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "建立道館" }).first().click();
    await page.waitForTimeout(600);
  };
  const submit = async (name, code) => {
    await page.locator("#gym-name").fill(name);
    await page.locator("#gym-create-code").fill(code);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await page.waitForTimeout(2200);
    return (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
  };
  const gymCount = async () => (await admin.from("gyms").select("id", { count: "exact", head: true })).count;

  // 1. 對話框有建館碼欄位, 而且說明講了封測
  await openCreate();
  check(await page.locator("#gym-create-code").count(), "建館對話框有建館碼欄位");
  const dialogText = await page.locator("[role=dialog]").first().innerText();
  check(dialogText.includes("封測"), "對話框說明講了封測與一次性", dialogText.split("\n")[1]?.slice(0, 40));

  // 2. 沒有碼 → 建不起來 (而且不能是一句英文)
  const before = await gymCount();
  let toast = await submit("沒有碼的道館", "BADCODE00000");
  check(/建館碼無效|已經用過/.test(toast), "碼錯 → 中文錯誤, 不是資料庫原文", toast.replace(/\s+/g, " ").slice(0, 60));
  check((await gymCount()) === before, "碼錯時沒有建出道館");

  // 3. 有碼 → 建得起來, 而且進到那一館
  const { data: made } = await admin.from("gym_create_codes").insert({ note: "QA 建館碼測試" }).select("code").single();
  codes.push(made.code);
  toast = await submit("建館碼 QA 道館", made.code.toLowerCase()); // 故意小寫: RPC 會正規化
  await page.waitForTimeout(1500);
  const path = new URL(page.url()).pathname;
  check(/^\/gyms\/[0-9a-f-]{36}/.test(path), "有碼 → 建起來並進入該館", path);
  gymId = path.split("/")[2] ?? null;
  check(gymId && (await admin.from("gym_members").select("role").eq("gym_id", gymId).eq("user_id", userId).single()).data?.role === "admin",
    "建的人是管理員");

  // 4. 同一組碼再用一次 → 擋掉
  await openCreate();
  toast = await submit("想再開一館", made.code);
  check(/建館碼無效|已經用過/.test(toast), "同一組碼用第二次 → 擋掉 (一次性)", toast.replace(/\s+/g, " ").slice(0, 60));

  // 5. 連續試錯 → 節流 (第 6 次要變成「試太多次」)
  for (let i = 0; i < 4; i++) {
    await page.locator("#gym-create-code").fill("WRONG" + i);
    await page.getByRole("button", { name: "建立", exact: true }).click();
    await page.waitForTimeout(1200);
  }
  toast = await submit("再試一次", "WRONGAGAIN");
  check(/試太多次/.test(toast), "連續試錯 → 被節流擋下", toast.replace(/\s+/g, " ").slice(0, 60));

  // 6. 被鎖住時, 一組真的有效的碼也不會被燒掉
  const { data: fresh } = await admin.from("gym_create_codes").insert({ note: "QA 節流測試" }).select("code").single();
  codes.push(fresh.code);
  toast = await submit("鎖住時用好碼", fresh.code);
  check(/試太多次/.test(toast), "鎖住期間正確的碼也擋");
  const { data: still } = await admin.from("gym_create_codes").select("used_by").eq("code", fresh.code).single();
  check(still.used_by === null, "  ↳ 那組碼仍然是未使用 (沒被燒掉)");

  // 7. 教學的分叉: 沒有建館碼的人會被導到封測說明, 而且不提信箱/GitHub
  await page.evaluate(() => { try { localStorage.removeItem("pm-gym:tour-seen:v1"); } catch {} });
  await page.goto(`${BASE}/gyms?list=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(800);
  // 從頭像選單叫教學 (入口只有這一個)
  // ⚠ 不要 .catch(() => {}) —— 選擇器過期時會靜靜點不到, 然後在下一條檢查變成
  // 「找不到使用教學」這種看起來像功能壞掉的紅字 (2026-09-10 就這樣誤判了一次)。
  await page.getByRole("button", { name: "帳號選單" }).click();
  await page.waitForTimeout(500);
  const tourItem = page.getByRole("menuitem", { name: /使用教學/ });
  if (await tourItem.count()) {
    await tourItem.first().click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /我是道館負責人/ }).first().click();
    await page.waitForTimeout(700);
    const gateText = await page.locator("[role=dialog], [aria-labelledby=tour-title]").first().innerText();
    check(/建館碼/.test(gateText), "教學第一步就問建館碼", gateText.split("\n").slice(0, 2).join(" ").slice(0, 50));
    await page.getByRole("button", { name: "我沒有" }).click();
    await page.waitForTimeout(600);
    const denied = await page.locator("[aria-labelledby=tour-title]").first().innerText();
    check(/封測/.test(denied), "選「我沒有」→ 封測說明", denied.replace(/\s+/g, " ").slice(0, 50));
    check(!/@|github/i.test(denied), "  ↳ 沒有洩漏信箱或 GitHub");
  } else {
    check(false, "找得到頭像選單裡的「使用教學」");
  }

  check(errs.length === 0, "沒有前端未捕捉的錯誤", errs.slice(0, 2).join(" | "));
} finally {
  if (browser) await browser.close();
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  for (const c of codes) await admin.from("gym_create_codes").delete().eq("code", c);
  if (userId) {
    await admin.from("code_attempts").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} 通過` +
    (fail.length ? " — 要看的: " + fail.map((f) => f.name).join(", ") : ""));
  console.log("已清除測試道館、測試帳號與 QA 用的建館碼");
  if (fail.length) process.exitCode = 1;
}
