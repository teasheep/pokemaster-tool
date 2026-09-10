// 「顧問的練度不屬於這一館」的端對端證明 (0072)。
//
// 2026-09-10 使用者:「理論上是看不到顧問的拍組的才對吧? 顧問互相也不應該看得到對吧?」
//
// 這支要證明的是**顧問寫不進去**, 而不是畫面上沒顯示 —— 畫面沒顯示只代表沒畫,
// 資料還在的話, 匯出、其他顧問、以後任何一個新頁面都還是拿得到。
// 顧問**照舊讀得到全館成員的練度** (那是這個角色的用途), 這裡也一起驗。
//
// 另外驗一條今天就按得到的路: 管理員把成員降級成顧問 —— 舊資料**刻意留著**
// (改回成員時要回得來), 但從那一刻起寫不進去了。
//
// 會建 3 個隔離的測試帳號與 1 個測試道館, 跑完 (含失敗) 一定刪掉。
// 用法: npm run qa:advisor
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createTestGym, dropTestGymCode } from "./qa-lib-gym.mjs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const newAnon = () => createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const results = [];
const check = (ok, name, detail = "") => {
  results.push({ ok, name });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};
const ids = [];
let gymId = null, createCode = null;

async function mkUser(email, display) {
  const found = (await admin.auth.admin.listUsers()).data?.users?.find((u) => u.email === email);
  if (found) await admin.auth.admin.deleteUser(found.id).catch(() => {});
  const { data: c, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() });
  if (error) throw new Error(email + ": " + error.message);
  ids.push(c.user.id);
  await admin.from("profiles").update({ display_name: display, onboarded_at: new Date().toISOString() }).eq("id", c.user.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: sess } = await newAnon().auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  const cli = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
  return { userId: c.user.id, cli };
}

const rowOf = async (uid) =>
  (await admin.from("gym_members").select("id, role").eq("gym_id", gymId).eq("user_id", uid).single()).data;

try {
  const recs = JSON.parse(fs.readFileSync("src/data/pomatools-pairs.json", "utf8")).records;
  const p = recs[0], p2 = recs[7];
  const lab = (x) => `${x.trainerNameZh || x.trainerName}&${x.pokemonNameZh || x.pokemonName}`;

  const A = await mkUser("qa-adv-admin@example.invalid", "管理員甲");
  const B = await mkUser("qa-adv-member@example.invalid", "成員乙");
  const C = await mkUser("qa-adv-advisor@example.invalid", "顧問丙");
  const made = await createTestGym(admin, A.cli, "顧問範圍測試");
  gymId = made.gymId; createCode = made.code;

  const { data: inv } = await admin.from("gym_invites").select("code, advisor_code").eq("gym_id", gymId).single();
  await B.cli.rpc("join_gym", { p_code: inv.code });
  await C.cli.rpc("join_gym", { p_code: inv.advisor_code });
  // 0071: 兩個都要先被放行才進得來
  await admin.from("gym_members").update({ status: "active" }).eq("gym_id", gymId).in("user_id", [B.userId, C.userId]);
  const bRow = await rowOf(B.userId), cRow = await rowOf(C.userId);
  check(bRow.role === "member" && cRow.role === "advisor", "乙=成員, 丙=顧問");

  // 乙有一張卡 (拿來當「顧問看得到別人的練度」的實驗對象)
  await admin.from("member_pairs").insert({
    gym_id: gymId, member_id: bRow.id, pair_label: lab(p), pair_id: p.pairId, grade: 5,
  });

  // ── 1. 顧問照舊讀得到全館 (這是他的用途, 不可以一起收掉) ──
  const { data: cRead } = await C.cli.from("member_pairs").select("id").eq("gym_id", gymId);
  check((cRead ?? []).length === 1, "顧問讀得到成員的練度 (角色用途沒被收掉)", `${(cRead ?? []).length} 列`);

  // ── 2. 但他寫不進自己那一列 ──
  const { error: cIns } = await C.cli.from("member_pairs").insert({
    gym_id: gymId, member_id: cRow.id, pair_label: lab(p2), pair_id: p2.pairId, grade: 3,
  });
  check(!!cIns, "顧問寫不進自己的 member_pairs", cIns?.message?.slice(0, 60) ?? "**居然成功了**");

  const { error: cRpc } = await C.cli.rpc("set_member_pair", {
    p_member: cRow.id, p_pair_id: p2.pairId, p_pair_label: lab(p2), p_potential: 3, p_super_awakening: 0,
  });
  check(!!cRpc, "set_member_pair 也擋 (security definer, RLS 對它無效)", cRpc?.message?.slice(0, 60) ?? "**居然成功了**");

  const { error: cCandy } = await C.cli.from("member_candies").insert({
    gym_id: gymId, member_id: cRow.id, candy_type: "universal", count: 5,
  });
  check(!!cCandy, "背包 (member_candies) 也擋", cCandy?.message?.slice(0, 50) ?? "**居然成功了**");

  const { error: cFocus } = await C.cli.from("member_type_focus").insert({
    gym_id: gymId, member_id: cRow.id, kind: "want", type: "fire",
  });
  check(!!cFocus, "屬性資源方向 (member_type_focus) 也擋", cFocus?.message?.slice(0, 50) ?? "**居然成功了**");

  // ── 3. 管理員也不能替顧問建練度 (規則是對稱的) ──
  const { error: aOnC } = await A.cli.from("member_pairs").insert({
    gym_id: gymId, member_id: cRow.id, pair_label: lab(p2), pair_id: p2.pairId, grade: 3,
  });
  check(!!aOnC, "管理員也不能把練度寫到顧問那一列", aOnC?.message?.slice(0, 50) ?? "**居然成功了**");

  // ── 4. 顧問自己的個人收藏完全不受影響 ──
  const { error: cCol } = await C.cli.from("user_collection").upsert(
    { user_id: C.userId, pair_id: p2.pairId, owned: true, potential: 4 }, { onConflict: "user_id,pair_id" });
  check(!cCol, "顧問照樣編得動自己的 /pairs 收藏", cCol?.message ?? "");

  // ── 5. 成員照舊寫得進去 (別把大家一起擋掉了) ──
  const { error: bIns } = await B.cli.from("member_pairs").insert({
    gym_id: gymId, member_id: bRow.id, pair_label: lab(p2), pair_id: p2.pairId, grade: 2,
  });
  check(!bIns, "一般成員照舊寫得進自己的練度", bIns?.message ?? "");
  const { error: aOnB } = await A.cli.rpc("set_member_pair", {
    p_member: bRow.id, p_pair_id: p.pairId, p_pair_label: lab(p), p_potential: 4, p_super_awakening: 0,
  });
  check(!aOnB, "管理員照舊代改得動成員的練度", aOnB?.message ?? "");

  // ── 6. 降級: 舊資料留著, 但從此寫不進去 ──
  await A.cli.from("gym_members").update({ role: "advisor" }).eq("id", bRow.id);
  const { count: keptRows } = await admin
    .from("member_pairs").select("id", { count: "exact", head: true }).eq("member_id", bRow.id);
  check(keptRows === 2, "降級成顧問之後**舊練度還在** (改回成員要回得來)", `${keptRows} 列`);
  const { error: bAfter } = await B.cli.from("member_pairs").update({ grade: 1 }).eq("member_id", bRow.id);
  const { data: unchanged } = await admin
    .from("member_pairs").select("grade").eq("member_id", bRow.id).eq("pair_id", p2.pairId).single();
  check(unchanged?.grade === 2, "但從那一刻起他改不動了", bAfter?.message?.slice(0, 50) ?? "沒報錯但也沒改到");

  // ── 7. 改回成員 → 又寫得動了 (證明 0072 擋的是身分不是資料) ──
  await A.cli.from("gym_members").update({ role: "member" }).eq("id", bRow.id);
  const { error: bBack } = await B.cli.from("member_pairs").update({ grade: 1 }).eq("member_id", bRow.id).eq("pair_id", p2.pairId);
  check(!bBack, "改回成員之後又寫得動了", bBack?.message ?? "");
} finally {
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  await dropTestGymCode(admin, createCode);
  for (const id of ids) {
    await admin.from("code_attempts").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log("已清除測試道館與測試帳號");
}

const fail = results.filter((r) => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} 通過` +
  (fail.length ? " — 要看的: " + fail.map((f) => f.name).join(", ") : ""));
process.exit(fail.length ? 1 : 0);
