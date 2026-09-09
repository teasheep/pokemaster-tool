// 發一組建館碼 (封測)。**這是作者發碼的唯一工具** —— 站上刻意沒有管理後台:
// 為了一個人做一套權限系統不划算, 而發碼這個動作本來就發生在賴群裡。
//
// 用法:
//   npm run gym:code -- "給小明"      發一組 (備註隨意, 只給自己看)
//   npm run gym:code -- --list        列出目前的碼 (用掉的會標示是誰、開了哪一館)
//
// 需要 .env.local 的 SUPABASE_SERVICE_ROLE_KEY —— `gym_create_codes` 沒有任何 RLS policy,
// 連已登入者都讀不到, 只有 service role 與 create_gym (security definer) 碰得到。
// 檔名 .node.mjs = 本機工具, 與線上無關。

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const tw = (t) => (t ? new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }) : "");

if (args.includes("--list")) {
  const { data, error } = await db
    .from("gym_create_codes")
    .select("code, note, created_at, used_by, used_at, used_gym")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data.length) {
    console.log("還沒有發過任何建館碼。");
  } else {
    const gyms = new Map();
    const ids = data.map((r) => r.used_gym).filter(Boolean);
    if (ids.length) {
      const { data: g } = await db.from("gyms").select("id, name").in("id", ids);
      for (const row of g ?? []) gyms.set(row.id, row.name);
    }
    console.log(`共 ${data.length} 組 (未使用 ${data.filter((r) => !r.used_by).length} 組):\n`);
    for (const r of data) {
      const state = r.used_by
        ? `已用 ${tw(r.used_at)}${r.used_gym ? ` → ${gyms.get(r.used_gym) ?? "(道館已刪除)"}` : ""}`
        : "未使用";
      console.log(`  ${r.code}  ${state}${r.note ? `  [${r.note}]` : ""}`);
    }
  }
} else {
  const note = args.filter((a) => !a.startsWith("--")).join(" ") || null;
  // code 的預設值是 new_invite_code() (0053 的 CSPRNG, 與邀請碼同一套格式)
  const { data, error } = await db
    .from("gym_create_codes")
    .insert({ note })
    .select("code")
    .single();
  if (error) throw new Error(error.message);
  console.log(`\n  建館碼: ${data.code}${note ? `   (${note})` : ""}`);
  console.log("  一組只能用一次。貼給對方, 他在「建立道館」對話框填這一組。\n");
}
