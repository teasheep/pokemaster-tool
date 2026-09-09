// 兩個管理員同時改道館拍組名單 —— 這一類 bug 用一個帳號怎麼點都點不出來。
//
// 2026-09-09 使用者回報的兩個症狀, 根因是同一件事 (名單是**多人同時在改**的東西):
//   1.「管理員設定完道館拍組, 我的道館拍組分頁沒有一起變」
//   2.「duplicate key value violates unique constraint gym_pairs_gym_id_pair_label_key」
//      (使用者自己的判斷:「有可能是兩個管理員同時進去新增造成的」—— 正是如此)
//
// 這支會建**兩個**隔離的測試管理員與一個測試道館, 跑完 (含失敗) 一定刪掉 ——
// 不碰那 20 位真實成員的任何資料。登入照 AGENTS 的 render-probe (service key 產
// magiclink → verifyOtp → 合成 @supabase/ssr 的 cookie)。
//
// 用法: npm run qa:gympair                     打本機 (dev server 要在 3030 跑著)
//       QA_BASE=https://pokemaster-tool.com npm run qa:gympair   打線上 (部署後驗收用)
// 檔名 .node.mjs = 本機工具 (需要 playwright + service key), 與線上無關。
import fs from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
const BASE = process.env.QA_BASE ?? "http://localhost:3030", E1 = "qa-race-a@example.invalid", E2 = "qa-race-b@example.invalid";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const DOMAIN = new URL(BASE).hostname;
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ref = new URL(SB).hostname.split(".")[0];
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const newAnon = () => createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const recs = JSON.parse(fs.readFileSync("src/data/pomatools-pairs.json", "utf8")).records;
const lab = p => `${p.trainerNameZh || p.trainerName}&${p.pokemonNameZh || p.pokemonName}`;
const nameOf = p => `${p.trainerNameZh || p.trainerName} & ${p.pokemonNameZh || p.pokemonName}`;
const ids = [];
let gymId = null, browser = null;
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
  const A = await mkUser(E1, "管理員甲");
  const B = await mkUser(E2, "管理員乙");
  const { data: gid } = await A.cli.rpc("create_gym", { p_name: "同時新增測試" });
  gymId = gid;
  const { data: inv } = await admin.from("gym_invites").select("code").eq("gym_id", gymId).single();
  await B.cli.rpc("join_gym", { p_code: inv.code });
  const { data: bm } = await admin.from("gym_members").select("id").eq("gym_id", gymId).eq("user_id", B.userId).single();
  await admin.from("gym_members").update({ role: "admin" }).eq("id", bm.id);
  const seed = [recs[0], recs[5], recs[9]];
  for (const p of seed) await A.cli.from("gym_pairs").insert({ gym_id: gymId, pair_label: lab(p), pair_id: p.pairId, type: p.type });
  const dbCount = async () => (await admin.from("gym_pairs").select("id").eq("gym_id", gymId)).data.length;

  const raw = "base64-" + Buffer.from(JSON.stringify(A.session), "utf8").toString("base64url");
  const NAME = `sb-${ref}-auth-token`;
  const parts = raw.length <= 3180 ? [[NAME, raw]] : raw.match(/.{1,3180}/g).map((x, i) => [`${NAME}.${i}`, x]);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.addCookies(parts.map(([name, value]) => ({ name, value, domain: DOMAIN, path: "/" })));
  await ctx.addInitScript(k => { try { localStorage.setItem(k, "1"); } catch {} }, `pm-gym:tour-seen:v1:${A.userId}`);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + String(e.message).split("\n")[0]));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
  const cards = () => page.locator("div.relative.w-24").count();

  // 甲開著「成員與拍組」→ 自己 →「道館拍組」
  await page.goto(`${BASE}/gyms/${gymId}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  check(await cards() === 3, "甲一開始看到 3 張", `${await cards()} 張`);

  // 乙 (另一位管理員) 加了一隻 —— 甲的頁面**沒有重新整理**
  const added = recs[30];
  await B.cli.from("gym_pairs").insert({ gym_id: gymId, pair_label: lab(added), pair_id: added.pairId, type: added.type });
  await page.waitForTimeout(6000);   // 超過 5 秒節流
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));  // = 使用者切回這個分頁
  await page.waitForTimeout(2500);
  const n = await cards();
  check(n === 4, "乙加的拍組, 甲回到分頁就看得到 (不必重新整理)", `${n} 張 / DB ${await dbCount()}`);

  // 兩人同時點同一張卡: 甲開著側板, 乙先按下去, 甲再按
  await page.getByRole("button", { name: "全館拍組" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "所有遊戲拍組" }).first().click();
  await page.waitForTimeout(2500);
  const same = recs[40];
  await page.getByPlaceholder(/搜尋/).first().fill(nameOf(same).split(" & ")[0]);
  await page.waitForTimeout(1800);
  const target = page.locator("div.relative.w-24").filter({ hasText: (same.pokemonNameZh || same.pokemonName) }).first();
  const card = (await target.count()) ? target : page.locator("div.relative.w-24").first();
  await card.click({ position: { x: 45, y: 45 } });
  await page.waitForTimeout(1500);
  const title = (await page.locator("[data-tour='side-panel']").first().innerText()).split("\n")[0].trim();
  const rec = recs.find(p => nameOf(p) === title);
  check(Boolean(rec), "側板打開的是圖鑑裡的拍組", title);
  if (rec) {
    const { error: bErr } = await B.cli.from("gym_pairs").insert({ gym_id: gymId, pair_label: lab(rec), pair_id: rec.pairId, type: rec.type });
    check(!bErr, "乙搶先加了同一隻", bErr ? bErr.message : lab(rec));
    const before = await dbCount();
    const star = page.getByRole("button", { name: /設為道館拍組/ });
    await star.first().click();
    await page.waitForTimeout(2500);
    const toasts = (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
    check(!/失敗|duplicate|violates/i.test(toasts), "甲按下★不會看到 duplicate key 錯誤", toasts.replace(/\s+/g, " ").slice(0, 80));
    check(await dbCount() === before, "資料庫沒有多出重複列", `${await dbCount()} 列`);
  }
  check(errs.length === 0, "沒有前端錯誤", errs.join(" | "));
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
} finally {
  if (browser) await browser.close();
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log("已清除測試道館與帳號");
}
