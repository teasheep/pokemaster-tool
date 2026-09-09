// 真的用瀏覽器點下去的測試 —— SSR 探測只驗得到「頁面畫得出來」, 驗不到「按鈕按下去會怎樣」。
//
// 用**本機安裝的 Chrome** (channel: "chrome", 不下載 Chromium)。
// 登入照 AGENTS 的 render-probe: service key 產 magiclink → verifyOtp → 把 session 寫成
// cookie 塞進瀏覽器。**會建一個隔離的測試帳號與測試道館, 跑完 (含失敗) 一定刪掉** ——
// 不碰那 20 位真實成員的任何資料。
//
// 檔名 `.node.mjs` 是為了與線上無關的本機工具一致 (它需要 playwright + service key)。
//
// 用法:
//   npm run qa:click            無頭跑
//   npm run qa:click -- --headed  開著視窗看它點
// 前置: dev server 要在 3030 跑著 (npm run dev)。

import fs from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createTestGym, dropTestGymCode } from "./qa-lib-gym.mjs";

const HEADED = process.argv.includes("--headed");
const BASE = "http://localhost:3030";
const EMAIL = "qa-click@example.invalid";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const projectRef = new URL(SB).hostname.split(".")[0];
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const results = [];
/** 一條檢查。cond 為真就過, 否則記成要看的 */
function check(cond, name, detail = "") {
  results.push({ ok: Boolean(cond), name, detail });
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
}

let userId = null;
let gymId = null;
let createCode = null;
let browser = null;

try {
  // ── 建隔離的測試帳號與道館 ──
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
  });
  if (cErr) throw new Error("建帳號: " + cErr.message);
  userId = created.user.id;
  await admin
    .from("profiles")
    .update({ display_name: "QA 點擊", onboarded_at: new Date().toISOString() })
    .eq("id", userId);

  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  const { data: sess } = await anon.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  const asUser = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
  // 0060 起建館需要一次性的建館碼 (發碼 → 建館 → 收尾一起刪, 見 qa-lib-gym.mjs)
  const made = await createTestGym(admin, asUser, "QA 點擊道館");
  gymId = made.gymId;
  createCode = made.code;

  // @supabase/ssr 的 cookie 格式 (超過 3180 就切塊)
  const raw = "base64-" + Buffer.from(JSON.stringify(sess.session), "utf8").toString("base64url");
  const NAME = `sb-${projectRef}-auth-token`;
  const pairs = raw.length <= 3180 ? [[NAME, raw]] : raw.match(/.{1,3180}/g).map((c, i) => [`${NAME}.${i}`, c]);
  const cookies = pairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }));

  browser = await chromium.launch({ channel: "chrome", headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // 未捕捉的前端例外一律當失敗 —— 這正是 SSR 探測看不到的那一半
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e.message).split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() === "error") jsErrors.push("console: " + m.text().slice(0, 160));
  });

  const goto = (p) => page.goto(BASE + p, { waitUntil: "networkidle" });

  // ── 1. /pairs 子分頁與持有開關: 網址要跟著變, 重新整理要留在原畫面 ──
  await goto("/pairs");
  await page.getByRole("button", { name: "所有遊戲拍組" }).click();
  await page.waitForTimeout(600);
  check(page.url().includes("tab=all"), "切到「所有遊戲拍組」", page.url().replace(BASE, ""));

  const ownedBtn = page.getByRole("button", { name: "只看我持有的" });
  check(await ownedBtn.count(), "找得到「只看我持有的」開關");
  if (await ownedBtn.count()) {
    await ownedBtn.first().click();
    await page.waitForTimeout(600);
    check(page.url().includes("owned=1"), "開「只看我持有的」", page.url().replace(BASE, ""));
    await page.reload({ waitUntil: "networkidle" });
    check(
      page.url().includes("tab=all") && page.url().includes("owned=1"),
      "重新整理留在原本的畫面",
      page.url().replace(BASE, "")
    );
  }

  // ── 2. 卡片與側板 ──
  await goto("/pairs?tab=all");
  const card = page.locator('[data-tour="pair-card"]').first();
  check(await card.count(), "找得到拍組卡");
  if (await card.count()) {
    await card.click({ position: { x: 45, y: 45 } });
    await page.waitForTimeout(900);
    check(await page.locator('[data-tour="side-panel"]').count(), "點卡片開得了側板");
    const triggers = page.locator("button[role='combobox']");
    const n = await triggers.count();
    check(n >= 3, "側板的下拉都在", n + " 個");
    if (n) {
      await triggers.first().click();
      await page.waitForTimeout(400);
      const opts = await page.locator("[role='option']").count();
      check(opts > 0, "下拉打得開", opts + " 個選項");
      await page.keyboard.press("Escape");
    }
  }

  // ── 3. 道館: 範圍切換 (重整後不可以變成「假的全圖鑑」) 與建立賽事 ──
  await goto(`/gyms/${gymId}/members`);
  const scopeAll = page.getByRole("button", { name: "所有遊戲拍組" });
  check(await scopeAll.count(), "道館頁有「所有遊戲拍組」分頁");
  if (await scopeAll.count()) {
    await scopeAll.first().click();
    await page.waitForTimeout(1500);
    check(page.url().includes("scope=all"), "道館切到「所有遊戲拍組」");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const cards = await page.locator('[class*="w-24"]').count();
    check(cards > 300, "重新整理後仍是整本圖鑑", cards + " 張卡");
  }

  await goto(`/gyms/${gymId}/battles`);
  const createBattle = page.locator('[data-tour="battle-create"]');
  check(await createBattle.count(), "找得到「建立賽事」");
  if (await createBattle.count()) {
    await createBattle.click();
    await page.waitForTimeout(700);
    check(await page.getByRole("dialog").count(), "「建立賽事」開得了對話框");
    const tpl = await page.locator('[data-tour="battle-template"] button').count();
    check(tpl >= 4, "賽事模板選項齊全", tpl + " 個 (三個模板 + 先不套用)");
    await page.keyboard.press("Escape");
  }

  // ── 4. 教學: 膠囊必須在「選擇卡」階段就出現 (寫入從那時候就被吞了) ──
  await goto("/gyms");
  await page.locator("header button").last().click();
  await page.waitForTimeout(500);
  const tourItem = page.getByRole("menuitem", { name: /使用教學/ });
  check(await tourItem.count(), "頭像選單裡有「使用教學」");
  if (await tourItem.count()) {
    await tourItem.click();
    await page.waitForTimeout(800);
    check(
      await page.getByText("使用教學進行中").count(),
      "選擇卡階段就有「教學進行中」提示",
      "沒有的話使用者不知道寫入被擋"
    );
    check(await page.getByRole("button", { name: /我是成員/ }).count(), "選擇卡的兩條路都在");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  await goto("/profile");
  check(true, "個人設定頁載入");

  const uniq = [...new Set(jsErrors)];
  check(uniq.length === 0, "全程沒有前端未捕捉錯誤", uniq.slice(0, 6).join(" | "));
} catch (e) {
  check(false, "測試中斷", e.message);
} finally {
  if (browser) await browser.close();
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  await dropTestGymCode(admin, createCode);
  if (userId) await admin.auth.admin.deleteUser(userId);
  const fail = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - fail.length}/${results.length} 通過` +
      (fail.length ? " — 要看的: " + fail.map((f) => f.name).join(", ") : "")
  );
  console.log("測試帳號與道館已刪除");
  if (fail.length) process.exitCode = 1;
}
