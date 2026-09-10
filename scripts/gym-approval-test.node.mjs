// 「貼了碼還要管理員按確認」的端對端證明 (0071)。
//
// 2026-09-10 使用者:「碼確實有可能被外流, 此時再踢出, 已經被看光了。」
// —— 所以這支要證明的**不是**畫面上有勾勾叉叉, 而是**待確認的那個帳號真的一列都讀不到**。
// 那件事用眼睛看不出來 (他的畫面本來就是空的), 只有拿他自己的 JWT 去打 PostgREST 才知道。
//
// 這支不開瀏覽器: 它驗的是 RLS, 而 RLS 在資料庫那一層。要驗畫面請看 npm run qa:click。
//
// 會建 3 個隔離的測試帳號與 1 個測試道館, 跑完 (含失敗) 一定刪掉 ——
// **不碰那 20 位真實成員的任何資料**。
//
// 用法: npm run qa:approval
//       QA_BASE=http://localhost:3030 npm run qa:approval   (多驗一條 /api/export)
// 檔名 .node.mjs = 本機工具 (需要 service key), 線上建置不會碰到它。
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createTestGym, dropTestGymCode } from "./qa-lib-gym.mjs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const newAnon = () =>
  createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const results = [];
const check = (ok, name, detail = "") => {
  results.push({ ok, name });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

const userIds = [];
let gymId = null;
let createCode = null;

async function mkUser(email, display) {
  await admin.auth.admin
    .listUsers()
    .then(({ data }) => data?.users?.find((u) => u.email === email))
    .then((u) => (u ? admin.auth.admin.deleteUser(u.id) : null))
    .catch(() => {});
  const { data: c, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID(),
  });
  if (error) throw new Error(email + ": " + error.message);
  userIds.push(c.user.id);
  await admin
    .from("profiles")
    .update({ display_name: display, onboarded_at: new Date().toISOString() })
    .eq("id", c.user.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: sess } = await newAnon().auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  const cli = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
  return { userId: c.user.id, cli };
}

/** 這個帳號在這一館看得到幾列 (每一張道館資料表各問一次) */
async function visibleRows(cli, gym) {
  const out = {};
  for (const [table, filter] of [
    ["gyms", (q) => q.eq("id", gym)],
    ["gym_members", (q) => q.eq("gym_id", gym)],
    ["member_pairs", (q) => q.eq("gym_id", gym)],
    ["gym_pairs", (q) => q.eq("gym_id", gym)],
    ["gym_battles", (q) => q.eq("gym_id", gym)],
    ["gym_teams", (q) => q.eq("gym_id", gym)],
    ["member_candies", (q) => q.eq("gym_id", gym)],
    ["gym_activity", (q) => q.eq("gym_id", gym)],
    ["gym_invites", (q) => q.eq("gym_id", gym)],
  ]) {
    const { data } = await filter(cli.from(table).select("*"));
    out[table] = (data ?? []).length;
  }
  return out;
}

const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const nonZero = (counts) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}:${n}`)
    .join(" ");

try {
  const A = await mkUser("qa-approve-admin@example.invalid", "管理員甲");
  const B = await mkUser("qa-approve-member@example.invalid", "申請人乙");
  const C = await mkUser("qa-approve-advisor@example.invalid", "顧問丙");

  const made = await createTestGym(admin, A.cli, "確認加入測試");
  gymId = made.gymId;
  createCode = made.code;

  // 館內先放一點東西, 「讀不到」才有意義 (空的道館看不出差別)
  const recs = JSON.parse(fs.readFileSync("src/data/pomatools-pairs.json", "utf8")).records;
  const p = recs[0];
  const label = `${p.trainerNameZh || p.trainerName}&${p.pokemonNameZh || p.pokemonName}`;
  await A.cli.from("gym_pairs").insert({ gym_id: gymId, pair_label: label, pair_id: p.pairId, type: p.type });
  const { data: am } = await admin.from("gym_members").select("id").eq("gym_id", gymId).eq("user_id", A.userId).single();
  await admin.from("member_pairs").insert({
    gym_id: gymId, member_id: am.id, pair_label: label, pair_id: p.pairId, grade: 5,
  });

  const { data: inv } = await admin
    .from("gym_invites")
    .select("code, advisor_code")
    .eq("gym_id", gymId)
    .single();

  // ── 1. 貼碼 = 送出申請, 不是加入 ──
  const { data: joined, error: jErr } = await B.cli.rpc("join_gym", { p_code: inv.code });
  check(!jErr, "乙貼成員碼: RPC 沒有報錯", jErr?.message ?? "");
  check(joined?.gym_id === gymId && joined?.pending === true, "回傳帶 pending:true", JSON.stringify(joined));

  const { data: bRow } = await admin
    .from("gym_members")
    .select("status, role")
    .eq("gym_id", gymId)
    .eq("user_id", B.userId)
    .single();
  check(bRow?.status === "pending" && bRow?.role === "member", "資料庫裡是 pending 的成員列", JSON.stringify(bRow));

  // ── 2. **核心**: 待確認的人一列都讀不到 ──
  const before = await visibleRows(B.cli, gymId);
  check(total(before) === 0, "乙在確認前讀不到這一館的任何一列", nonZero(before) || "全部 0 列");

  // ── 3. 但他自己的東西完全不受影響 ──
  const { error: colErr } = await B.cli
    .from("user_collection")
    .upsert({ user_id: B.userId, pair_id: p.pairId, owned: true, potential: 3 }, { onConflict: "user_id,pair_id" });
  check(!colErr, "乙照樣編得動自己的收藏 (/pairs 不受影響)", colErr?.message ?? "");

  // ── 4. 自己不能把自己核准掉 (RLS 沒有欄位粒度, 靠 with check 釘住 status) ──
  const { error: selfErr } = await B.cli
    .from("gym_members")
    .update({ status: "active" })
    .eq("user_id", B.userId);
  const { data: still } = await admin
    .from("gym_members").select("status").eq("gym_id", gymId).eq("user_id", B.userId).single();
  check(still?.status === "pending", "乙自助把自己改成 active 失敗", selfErr?.message?.slice(0, 60) ?? "沒報錯但也沒改到");

  // ── 5. 再貼一次碼: 冪等, 而且照實說還在等 ──
  const { data: again } = await B.cli.rpc("join_gym", { p_code: inv.code });
  check(again?.pending === true, "再貼一次碼還是回 pending (不會把他導進讀不到的道館頁)", JSON.stringify(again));

  // ── 6. 顧問碼同理 ──
  const { data: cJoin } = await C.cli.rpc("join_gym", { p_code: inv.advisor_code });
  const { data: cRow } = await admin
    .from("gym_members").select("status, role").eq("gym_id", gymId).eq("user_id", C.userId).single();
  check(cJoin?.pending === true && cRow?.status === "pending" && cRow?.role === "advisor",
    "顧問碼一樣要等確認", JSON.stringify(cRow));
  const cBefore = await visibleRows(C.cli, gymId);
  check(total(cBefore) === 0, "丙 (顧問) 在確認前也讀不到任何一列", nonZero(cBefore) || "全部 0 列");

  // ── 7. 申請人查得到「我在等哪一館」, 但拿不到 member id ──
  const { data: mine } = await B.cli.rpc("my_pending_gyms");
  check(mine?.length === 1 && mine[0].gym_id === gymId && mine[0].gym_name === "確認加入測試",
    "乙查得到自己在等的那一館 (含館名)", JSON.stringify(mine));
  check(mine?.[0] && !("id" in mine[0]), "my_pending_gyms 不吐 gym_members.id");

  // ── 8. 管理員看得到門外的兩個人 ──
  const { data: seen } = await A.cli.from("gym_members").select("*").eq("gym_id", gymId);
  const pendingSeen = (seen ?? []).filter((m) => m.status === "pending");
  check(pendingSeen.length === 2, "管理員看得到 2 筆待確認", `${pendingSeen.length} 筆`);

  // ── 9. 勾勾: 放行乙 ──
  const { error: okErr } = await A.cli
    .from("gym_members").update({ status: "active" }).eq("gym_id", gymId).eq("user_id", B.userId);
  check(!okErr, "管理員按勾勾 (status → active)", okErr?.message ?? "");
  const after = await visibleRows(B.cli, gymId);
  check(after.gyms === 1 && after.gym_members === 3 && after.member_pairs === 1 && after.gym_pairs === 1,
    "放行後乙讀得到館內資料", JSON.stringify(after));
  check(after.gym_invites === 0, "但一般成員照舊拿不到邀請碼 (0005)");

  // ── 10. 叉叉: 拒絕丙 ──
  const { error: rejErr } = await A.cli.from("gym_members").delete().eq("gym_id", gymId).eq("user_id", C.userId);
  check(!rejErr, "管理員按叉叉 (刪掉那筆申請)", rejErr?.message ?? "");
  const { data: cAfter } = await C.cli.rpc("my_pending_gyms");
  check((cAfter ?? []).length === 0, "丙的等待清單空了");
  check(total(await visibleRows(C.cli, gymId)) === 0, "被拒絕的丙照舊讀不到任何一列");

  // ── 11. 自己取消申請 ──
  const { data: dJoin } = await C.cli.rpc("join_gym", { p_code: inv.advisor_code });
  const { data: cancelled } = await C.cli.rpc("cancel_join_request", { p_gym: gymId });
  const { count: leftover } = await admin
    .from("gym_members")
    .select("id", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("user_id", C.userId);
  check(dJoin?.pending === true && cancelled?.ok === true && leftover === 0,
    "丙自己取消申請, 那一列真的不見了", JSON.stringify(cancelled));

  // ── 12. /api/export 也要濾掉 (service role, RLS 幫不上忙) ──
  const BASE = process.env.QA_BASE;
  if (BASE) {
    const { data: tok } = await B.cli.rpc("rotate_my_export_token");
    // 先把乙退回 pending, 看匯出還撈不撈得到這一館
    await admin.from("gym_members").update({ status: "pending" }).eq("gym_id", gymId).eq("user_id", B.userId);
    const res = await fetch(`${BASE}/api/export`, { headers: { Authorization: `Bearer ${tok}` } });
    const body = await res.json();
    const names = (body.gyms ?? []).map((g) => g.name);
    check(res.ok && !names.includes("確認加入測試"),
      "待確認時 /api/export 撈不到那一館", `HTTP ${res.status} — ${JSON.stringify(names)}`);
    await admin.from("gym_members").update({ status: "active" }).eq("gym_id", gymId).eq("user_id", B.userId);
    const res2 = await fetch(`${BASE}/api/export`, { headers: { Authorization: `Bearer ${tok}` } });
    const body2 = await res2.json();
    check((body2.gyms ?? []).some((g) => g.name === "確認加入測試"), "放行後 /api/export 撈得到");
  } else {
    console.log("· /api/export 這兩條要 QA_BASE=http://localhost:3030 才會跑 (dev server 要開著)");
  }
} finally {
  // 收尾: 跑到哪都要清乾淨 (前科是留下 QA 的道館與帳號)
  if (gymId) await admin.from("gyms").delete().eq("id", gymId);
  await dropTestGymCode(admin, createCode);
  for (const id of userIds) {
    await admin.from("code_attempts").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

const fail = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - fail.length}/${results.length} 通過` +
    (fail.length ? " — 要看的: " + fail.map((f) => f.name).join(", ") : "")
);
process.exit(fail.length ? 1 : 0);
