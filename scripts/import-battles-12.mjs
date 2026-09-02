#!/usr/bin/env node
/**
 * 建檔第一次/第二次道館賽 (歷史補錄, 冪等可重跑):
 *   關卡資料: wikiwiki.jp/touko_hip 官方關卡表 (LINE 記錄實戰訊息交叉驗證一致)
 *   成績/日期: 館內 LINE 記錄 (第一次全服 49 名; 第二次 47 名, 打到第 17 輪)
 * 同時清除測試用垃圾賽事 (名稱 "1111111111"/"5")。
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: [gym] } = await c.query("select id, name from gyms limit 1");
console.log("道館:", gym.name);

// ── 清除測試垃圾賽事 ──
const { rows: junk } = await c.query(
  "select id, name from gym_battles where gym_id = $1 and name in ('1111111111','5')",
  [gym.id]
);
for (const j of junk) {
  await c.query("delete from battle_logs where battle_id = $1", [j.id]);
  await c.query(
    "delete from stage_assignments where stage_id in (select id from battle_stages where battle_id = $1)",
    [j.id]
  );
  await c.query(
    "delete from stage_plan_pairs where stage_id in (select id from battle_stages where battle_id = $1)",
    [j.id]
  );
  await c.query(
    "delete from stage_teams where stage_id in (select id from battle_stages where battle_id = $1)",
    [j.id]
  );
  await c.query("delete from battle_stages where battle_id = $1", [j.id]);
  await c.query("delete from gym_battles where id = $1", [j.id]);
  console.log(`已刪除測試賽事: ${j.name}`);
}

// ── 兩場歷史賽事 (日期存台北時間零點 = UTC 前一日 16:00, 與第三次一致) ──
const BATTLES = [
  {
    name: "第一次道館戰（集結關都館主）",
    starts: "2026-02-19T16:00:00Z", // 2026-02-20 台北
    ends: "2026-02-26T16:00:00Z", // 2026-02-27 台北
    round: 8,
    summary:
      "全服排名第 49 名。首次參戰 (無排刀自由散打), 100 萬分獎勵全數達成; 賽末發現毒傷磨分戰術。",
    stages: [
      ["ice", "小剛"],
      ["electric", "小霞"],
      ["ground", "馬志士"],
      ["fire", "莉佳"],
      ["psychic", "阿桔"],
      ["dark", "娜姿"],
      ["water", "夏伯"],
      ["rock", "青綠"],
    ],
  },
  {
    name: "第二次道館戰（集結伽勒爾館主）",
    starts: "2026-04-02T16:00:00Z", // 2026-04-03 台北
    ends: "2026-04-09T16:00:00Z", // 2026-04-10 台北
    round: 17,
    summary:
      "全服排名第 47 名 (較上屆進步 2 名), 全館打到第 17 輪。首度導入戰力調查與排刀/催刀制度。",
    stages: [
      ["bug", "亞洛"],
      ["grass", "露璃娜"],
      ["flying", "卡蕪"],
      ["psychic", "彩豆"],
      ["ghost", "彼特"],
      ["water", "瑪瓜"],
      ["poison", "瑪俐"],
      ["fighting", "奇巴納"],
    ],
  },
];

for (const b of BATTLES) {
  let { rows: [battle] } = await c.query(
    "select id from gym_battles where gym_id = $1 and name = $2",
    [gym.id, b.name]
  );
  if (!battle) {
    // insert 會觸發 trigger 自動生 8 關
    ({ rows: [battle] } = await c.query(
      `insert into gym_battles (gym_id, name, status, starts_on, ends_on, current_round, summary)
       values ($1, $2, 'finished', $3, $4, $5, $6) returning id`,
      [gym.id, b.name, b.starts, b.ends, b.round, b.summary]
    ));
    console.log(`已建立: ${b.name}`);
  } else {
    await c.query(
      `update gym_battles set status='finished', starts_on=$2, ends_on=$3, current_round=$4, summary=$5
       where id = $1`,
      [battle.id, b.starts, b.ends, b.round, b.summary]
    );
    console.log(`已更新: ${b.name}`);
  }
  for (let i = 0; i < 8; i++) {
    const [weak, leader] = b.stages[i];
    await c.query(
      "update battle_stages set weak_type = $1, leader_name = $2 where battle_id = $3 and seq = $4",
      [weak, leader, battle.id, i + 1]
    );
  }
  console.log("  8 關已設定:", b.stages.map(([t, l]) => `${l}(${t})`).join(" "));
}

await c.end();
console.log("完成");
