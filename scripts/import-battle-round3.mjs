#!/usr/bin/env node
/**
 * 匯入第三次道館戰 (2026/08/03-08/10) 的完整出刀紀錄。
 *
 * 資料來源: 出刀作戰儀表板 (hostmyclaudehtml) 內嵌的 __APP_DATA__ JSON —
 *   basic_rounds (3 輪, 每關 1 人 3 券) + extra_rounds (12 輪, 降/主1/主2/支 各記實際張數)
 *   member_totals (每人總用券) → 期末剩券 = 30 - 用券
 *
 * 用法: node scripts/import-battle-round3.mjs --data <round3-data.json> [--confirm-remote]
 * 冪等: 依名稱找既有「第三次道館戰」先刪後建。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
if (!args.data) {
  console.error("用法: --data <round3-data.json> [--confirm-remote]");
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
  console.error("目標是遠端資料庫, 請加 --confirm-remote");
  process.exit(1);
}

const data = JSON.parse(readFileSync(args.data, "utf-8"));

const BATTLE_NAME = "第三次道館戰";
const GYM_NAME = "館主跑路自救會";

/** 儀表板屬性順序 → 關卡 seq 與 weak_type */
const ATTRS = ["冰", "電", "格", "惡", "妖", "火", "鋼", "龍"];
const ATTR_TYPE = {
  冰: "ice", 電: "electric", 格: "fighting", 惡: "dark",
  妖: "fairy", 火: "fire", 鋼: "steel", 龍: "dragon",
};
/** 儀表板 role → battle_logs.role */
const ROLE_MAP = { 基本: "main", 主1: "main", 主2: "main", 降: "debuff", 支: "assist" };
/** 名字別名 (儀表板打字誤差) */
const NAME_ALIAS = { 小伊步: "小伊布" };

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await db.connect();

try {
  const { rows: gyms } = await db.query(`select id from public.gyms where name = $1`, [GYM_NAME]);
  if (gyms.length === 0) throw new Error(`道館不存在: ${GYM_NAME}`);
  const gymId = gyms[0].id;

  // 成員: 儀表板用的是慣用名 (display_name 或 line_name 皆可能)
  const { rows: members } = await db.query(
    `select id, display_name, line_name from public.gym_members where gym_id = $1`,
    [gymId]
  );
  const memberByName = new Map();
  for (const m of members) {
    memberByName.set(m.display_name, m.id);
    if (m.line_name) memberByName.set(m.line_name, m.id);
  }
  const resolveMember = (name) => {
    const n = NAME_ALIAS[name] ?? name;
    const id = memberByName.get(n);
    if (!id) throw new Error(`找不到成員: ${name}`);
    return id;
  };
  // 先驗證全部名字可對應
  for (const name of data.members) resolveMember(name);

  // 冪等: 刪掉舊的同名賽事 (cascade 清 stages/logs/tickets)
  await db.query(`delete from public.gym_battles where gym_id = $1 and name = $2`, [
    gymId,
    BATTLE_NAME,
  ]);

  const {
    rows: [battle],
  } = await db.query(
    `insert into public.gym_battles (gym_id, name, status, starts_on, ends_on, current_round)
     values ($1, $2, 'finished', '2026-08-03', '2026-08-10', 15)
     returning id`,
    [gymId, BATTLE_NAME]
  );

  // trigger 已自動建 8 關 (weak_type=normal) → 改成儀表板屬性 + 主打手當館主欄註記
  const { rows: stages } = await db.query(
    `select id, seq from public.battle_stages where battle_id = $1 order by seq`,
    [battle.id]
  );
  const stageByAttr = new Map();
  for (const [i, attr] of ATTRS.entries()) {
    const s = stages[i];
    const a = data.assignment[attr] ?? {};
    await db.query(
      `update public.battle_stages set weak_type = $1, leader_name = $2 where id = $3`,
      [ATTR_TYPE[attr], `${attr}館`, s.id]
    );
    stageByAttr.set(attr, s.id);
    void a;
  }

  // 出刀紀錄: 基本 1-3 → round 1-3; 額外 N → round N+3
  let logCount = 0;
  let ticketSum = 0;
  const insertLog = async (attr, roundNo, roundLabel, role, memberName, tickets) => {
    await db.query(
      `insert into public.battle_logs
         (gym_id, battle_id, member_id, stage_id, round, round_label, role, tickets_used)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        gymId,
        battle.id,
        resolveMember(memberName),
        stageByAttr.get(attr),
        roundNo,
        roundLabel,
        ROLE_MAP[role] ?? "main",
        tickets,
      ]
    );
    logCount++;
    ticketSum += tickets;
  };

  for (const [i, r] of data.basic_rounds.entries()) {
    for (const e of r.entries) {
      await insertLog(e.attribute, i + 1, r.round, "基本", e.member, e.tickets);
    }
  }
  for (const [i, r] of data.extra_rounds.entries()) {
    for (const e of r.entries) {
      await insertLog(e.attribute, i + 4, r.round, e.role, e.member, e.tickets);
    }
  }

  // 期末剩券 = 30 - 個人總用券
  for (const [name, used] of Object.entries(data.member_totals)) {
    await db.query(
      `insert into public.member_tickets (gym_id, battle_id, member_id, remaining)
       values ($1, $2, $3, $4)
       on conflict (battle_id, member_id) do update set remaining = excluded.remaining`,
      [gymId, battle.id, resolveMember(name), Math.max(0, 30 - used)]
    );
  }

  const expect = data.ticket_stat?.total;
  console.log(
    `完成 ✓ 賽事 ${BATTLE_NAME}: 8 關, ${logCount} 筆出刀, 共 ${ticketSum} 券` +
      (expect ? ` (儀表板統計 ${expect} 券 ${ticketSum === expect ? "一致" : "⚠ 不一致"})` : "")
  );
} finally {
  await db.end();
}
