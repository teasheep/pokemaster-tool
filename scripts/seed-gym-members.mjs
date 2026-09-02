#!/usr/bin/env node
/**
 * 建立道館成員帳號並匯入各自的拍組收藏 (測試/上線前置)。
 *
 * 資料來源: scratchpad 抽出的 form-members.json (從打手 Excel 的「表單回覆」
 * sheet 取 email / 遊戲名 / LINE 名 / 各拍組持有等級)。
 *
 * 用法:
 *   node scripts/seed-gym-members.mjs --input <form-members.json> \
 *     --password <新帳號密碼> [--gym "館主跑路自救會"] [--confirm-remote]
 *
 *   密碼也可以走環境變數 GYM_MEMBER_PASSWORD (別寫進 shell 歷史時用)。
 *   **沒有預設值**: 以前這裡放了一個寫死的共用密碼, 等於 20 個帳號共用一把明文鑰匙,
 *   而且還會印在 stdout。要什麼密碼由執行的人當場給。
 *
 * 行為 (全程冪等):
 *   - auth 帳號: email 已存在就沿用 (不改密碼); 沒有才建立 (email_confirm=true)
 *   - gym_members: 依遊戲名對應, 綁 user_id + 補 line_name
 *   - user_collection: 依表單持有寫入 (寶N → potential=N; 超覺醒(10) → 寶5+覺5;
 *     一律 Lv200 / 6★ / EX 解鎖 — 與網站點亮預設一致)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { buildMatcher } from "./gym-import-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].replace(/^--/, "");
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
    else args[k] = true;
  }
}
if (!args.input) {
  console.error(
    "用法: --input <form-members.json> --password <密碼> [--gym 名稱] [--confirm-remote]"
  );
  process.exit(1);
}
const GYM_NAME = args.gym ?? "館主跑路自救會";
// 新帳號的密碼: 一定要當場給, 沒有 fallback (見檔頭)。
const PASSWORD = typeof args.password === "string" ? args.password : process.env.GYM_MEMBER_PASSWORD;
if (!PASSWORD) {
  console.error(
    "缺少密碼: 建立新帳號需要密碼, 請用 --password <密碼> 或環境變數 GYM_MEMBER_PASSWORD 提供。"
  );
  process.exit(1);
}

const envText = readFileSync(join(repoRoot, ".env.local"), "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const isLocal = /127\.0\.0\.1|localhost/.test(env.DATABASE_URL ?? "");
if (!isLocal && args["confirm-remote"] !== true) {
  console.error("目標是遠端資料庫 (會建立帳號與寫入收藏), 請加 --confirm-remote");
  process.exit(1);
}

const members = JSON.parse(readFileSync(args.input, "utf-8"));
const catalog = JSON.parse(
  readFileSync(join(repoRoot, "src", "data", "pomatools-pairs.json"), "utf-8")
).records;
const match = buildMatcher(catalog);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await db.connect();

try {
  const { rows: gyms } = await db.query(`select id from public.gyms where name = $1`, [GYM_NAME]);
  if (gyms.length === 0) throw new Error(`道館不存在: ${GYM_NAME}`);
  const gymId = gyms[0].id;

  // 既有帳號 email → id
  const existing = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }

  let created = 0, reused = 0, bound = 0, collectionRows = 0;
  const unmatched = new Set();

  for (const m of members) {
    if (!m.email || !m.gameName) {
      console.warn(`  ! 略過 (缺 email 或遊戲名): ${JSON.stringify(m.gameName)}`);
      continue;
    }
    const email = m.email.trim().toLowerCase();
    let userId = existing.get(email);
    if (userId) {
      reused++;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: m.gameName },
      });
      if (error) {
        console.warn(`  ! 建立帳號失敗 ${email}: ${error.message}`);
        continue;
      }
      userId = data.user.id;
      existing.set(email, userId);
      created++;
    }

    // 綁定 gym_members (依遊戲名; 沒有這個成員就建一筆)
    const { rowCount } = await db.query(
      `update public.gym_members set user_id = $1, line_name = coalesce(line_name, $2)
       where gym_id = $3 and display_name = $4`,
      [userId, m.lineName, gymId, m.gameName]
    );
    if (rowCount === 0) {
      await db.query(
        `insert into public.gym_members (gym_id, user_id, display_name, line_name)
         values ($1, $2, $3, $4)
         on conflict (gym_id, display_name) do update set user_id = excluded.user_id`,
        [gymId, userId, m.gameName, m.lineName]
      );
    }
    bound++;

    // 個人收藏 (只寫有持有的)
    for (const [label, grade] of Object.entries(m.pairs)) {
      if (grade < 1) continue;
      const hit = match(label);
      if (!hit) {
        unmatched.add(label);
        continue;
      }
      const potential = grade === 10 ? 5 : Math.min(grade, 5);
      const superAwakening = grade === 10 ? 5 : 0;
      await db.query(
        // move_level / sync_level 已於 0047 drop (AGENTS: 招式1-5 / 同步1-5 不存在於本站),
        // 留著會讓整支腳本第一筆收藏就炸在 "column does not exist"。
        `insert into public.user_collection
           (user_id, pair_id, owned, level, promotion, potential, super_awakening, ex_unlocked)
         values ($1, $2, true, 200, 6, $3, $4, true)
         on conflict (user_id, pair_id) do update set
           owned = true, potential = excluded.potential, super_awakening = excluded.super_awakening`,
        [userId, hit.pairId, potential, superAwakening]
      );
      collectionRows++;
    }
    process.stdout.write(`  ✓ ${m.gameName} (${email})\n`);
  }

  console.log(
    `\n完成 ✓ 帳號: 新建 ${created} / 沿用 ${reused}; 綁定成員 ${bound}; 收藏 ${collectionRows} 筆`
  );
  if (unmatched.size > 0) {
    console.log(`對不到 catalog 的拍組 (${unmatched.size}): ${[...unmatched].join(", ")}`);
  }
  // 刻意不印密碼 —— stdout 會被複製貼上、被 CI 收走、被截圖。
  if (created > 0) {
    console.log(`\n新帳號已套用你指定的密碼 (未輸出)。請個別轉達, 並提醒成員登入後自行修改。`);
  }
} finally {
  await db.end();
}
