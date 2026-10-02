// 排刀表 (0083) 端對端: 一般成員 (不是管理員) 用真的瀏覽器排人、寫備註、加欄位、寫敘述,
// 另一位成員同時從 API 改 —— 回到分頁就看得到; 重新整理後全部還在; 匯出圖片下載得到。
//
// 會建兩個隔離的測試帳號與一個測試道館, 跑完 (含失敗) 一定刪掉, 不碰真實成員的資料。
// 用法: node scripts/battle-plan-test.node.mjs   (dev server 要在 3030 跑著)
//       QA_BASE=https://pokemaster-tool.com node scripts/battle-plan-test.node.mjs   (部署後驗收)
import fs from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createTestGym, dropTestGymCode } from "./qa-lib-gym.mjs";
const BASE = process.env.QA_BASE ?? "http://localhost:3030";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const DOMAIN = new URL(BASE).hostname;
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ref = new URL(SB).hostname.split(".")[0];
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const newAnon = () => createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const ids = [];
let gymId = null, browser = null, createCode = null;
const results = [];
const check = (ok, name, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); };

async function mkUser(email, display) {
  const { data: c, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() });
  if (error) throw new Error(email + ": " + error.message);
  ids.push(c.user.id);
  await admin.from("profiles").update({ display_name: display, onboarded_at: new Date().toISOString() }).eq("id", c.user.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: sess } = await newAnon().auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  const cli = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } } });
  return { userId: c.user.id, session: sess.session, cli };
}

try {
  const A = await mkUser("qa-plan-a@example.invalid", "排刀甲");
  const B = await mkUser("qa-plan-b@example.invalid", "排刀乙");
  const made = await createTestGym(admin, A.cli, "排刀表測試");
  gymId = made.gymId;
  createCode = made.code;
  const { data: inv } = await admin.from("gym_invites").select("code").eq("gym_id", gymId).single();
  await B.cli.rpc("join_gym", { p_code: inv.code });
  await admin.from("gym_members").update({ status: "active" }).eq("gym_id", gymId).eq("user_id", B.userId);
  const { data: mems } = await admin.from("gym_members").select("id, user_id, role").eq("gym_id", gymId);
  const mA = mems.find((m) => m.user_id === A.userId), mB = mems.find((m) => m.user_id === B.userId);
  check(mB.role === "member", "乙是一般成員 (不是管理員)", mB.role);

  const { data: battle } = await A.cli.from("gym_battles").insert({ gym_id: gymId, name: "排刀測試賽" }).select("id").single();
  const fields = async () => (await admin.from("battle_plan_fields").select("id, label, wide").eq("battle_id", battle.id).order("sort_order")).data;
  const slots = async () => (await admin.from("battle_plan_slots").select("field_id, stage_id, member_id, note").eq("battle_id", battle.id)).data;
  check((await fields()).map((f) => f.label).join(",") === "物攻,特攻,降抗", "新賽事自帶 物攻 / 特攻 / 降抗");

  const raw = "base64-" + Buffer.from(JSON.stringify(B.session), "utf8").toString("base64url");
  const NAME = `sb-${ref}-auth-token`;
  const parts = raw.length <= 3180 ? [[NAME, raw]] : raw.match(/.{1,3180}/g).map((x, i) => [`${NAME}.${i}`, x]);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  await ctx.addCookies(parts.map(([name, value]) => ({ name, value, domain: DOMAIN, path: "/" })));
  await ctx.addInitScript((k) => { try { localStorage.setItem(k, "1"); } catch {} }, `pm-gym:tour-seen:v1:${B.userId}`);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message).split("\n")[0]));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

  await page.goto(`${BASE}/gyms/${gymId}/battles/${battle.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (process.env.QA_OUT) await page.screenshot({ path: `${process.env.QA_OUT}/plan-qa-open.png` });
  await page.getByRole("button", { name: "排刀表", exact: true }).click();
  await page.waitForTimeout(800);
  check(page.url().includes("plan=1"), "點標題展開, 網址帶 plan=1");
  const sec = page.locator("section", { hasText: "新增關卡欄位" });
  check(await sec.count() === 1, "一般成員看得到編輯控制 (新增關卡欄位)");

  // 排人: 第一關的物攻 → 選甲
  await sec.getByRole("button", { name: /＋ 指派/ }).first().click();
  await page.waitForTimeout(800);
  const panel = page.locator("[data-tour='side-panel']");
  await panel.getByRole("button", { name: /排刀甲/ }).first().click();
  await page.waitForTimeout(1500);
  const fP = (await fields()).find((f) => f.label === "物攻");
  let s = await slots();
  check(s.some((x) => x.field_id === fP.id && x.member_id === mA.id && x.stage_id), "點選 → 寫進資料庫 (物攻 × 第一關 × 甲)");
  // 備註
  await panel.locator("textarea").fill("備用");
  await panel.locator("textarea").blur();
  await page.waitForTimeout(1500);
  s = await slots();
  check(s.some((x) => x.field_id === fP.id && x.note === "備用"), "那一格的備註存進去");
  await panel.getByRole("button", { name: "關閉" }).click();
  await page.waitForTimeout(600);

  // 加欄位 + 改名
  await sec.getByRole("button", { name: "新增關卡欄位" }).click();
  await page.waitForTimeout(1500);
  // 上面那排 (每關欄位) 的第三格 = 剛新增的; 最後一格是下面那排的「降抗」, 不要點錯
  const newInput = sec.locator('input[placeholder="欄位名稱"]').nth(2);
  await newInput.fill("補刀");
  await newInput.press("Enter");
  await page.waitForTimeout(1500);
  check((await fields()).some((f) => f.label === "補刀" && !f.wide), "新增關卡欄位 + 改名「補刀」存進去");

  // 敘述
  const note = sec.locator('textarea[placeholder="例：降抗順序、注意事項"]');
  await note.fill("草關先降抗");
  await note.blur();
  await page.waitForTimeout(1500);
  const { data: plan } = await admin.from("battle_plans").select("note").eq("battle_id", battle.id).maybeSingle();
  check(plan?.note === "草關先降抗", "敘述存進去", JSON.stringify(plan));

  // 甲 (另一個人) 同時從 API 把乙排進降抗 —— 乙回到分頁就看得到
  const fD = (await fields()).find((f) => f.wide);
  const { error: aErr } = await A.cli.from("battle_plan_slots").insert({ gym_id: gymId, battle_id: battle.id, field_id: fD.id, stage_id: null, member_id: mB.id });
  check(!aErr, "甲從另一邊把乙排進降抗", aErr?.message ?? "");
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2500);
  const wideCard = sec.locator("div.rounded-xl", { hasText: "降抗" }).filter({ hasText: "排刀乙" });
  check(await wideCard.count() > 0, "乙回到分頁就看到自己被排進降抗 (不必重新整理)");

  // 重新整理: 全部還在
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const txt = await page.locator("section", { hasText: "新增關卡欄位" }).innerText();
  check(/排刀甲/.test(txt) && /備用/.test(txt) && /補刀/.test(txt) && /排刀乙/.test(txt), "重新整理後排的人、備註、欄位都還在");

  // 拿掉甲 (再點一次)
  await page.locator("section", { hasText: "新增關卡欄位" }).getByRole("button", { name: /排刀甲/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator("[data-tour='side-panel']").getByRole("button", { name: /排刀甲/ }).first().click();
  await page.waitForTimeout(1500);
  s = await slots();
  check(!s.some((x) => x.member_id === mA.id), "再點一次 → 從資料庫拿掉");
  await page.locator("[data-tour='side-panel']").getByRole("button", { name: "關閉" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // 匯出
  const out = process.env.QA_OUT ?? ".";
  if (process.env.QA_OUT) await page.screenshot({ path: `${out}/plan-qa-before-export.png` });
  try {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "匯出圖片" }).click()]);
    await dl.saveAs(`${out}/plan-qa-export.png`);
    check(fs.statSync(`${out}/plan-qa-export.png`).size > 10000, "匯出圖片下載得到");
  } catch (e) {
    check(false, "匯出圖片下載得到", String(e.message).split(String.fromCharCode(10))[0]);
  }

  check(errs.length === 0, "沒有前端錯誤", errs.join(" | "));
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
} finally {
  if (browser) await browser.close();
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  await dropTestGymCode(admin, createCode);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("已清除測試道館與帳號");
}
