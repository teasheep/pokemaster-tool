#!/usr/bin/env node
/**
 * 抓 brybry datamine 的核心 proto JSON 到 src/data/brybry/。
 * 這是「新拍組」進入系統的源頭 — scrape-brybry.mjs 讀這些檔產生 catalog。
 *
 * 來源: https://pokemon.brybry.ch/masters/data/proto/<File>.json (結構)
 *       https://pokemon.brybry.ch/masters/data/lsd/<File>.json   (在地化名稱)
 *
 * **在地化名稱檔一定要一起更新**: scrape-brybry 沒有英文名就整筆丟掉, 而變體拍組
 * (阿爾套裝/冠軍/季節…) 的全名只存在 trainer_verbose_name_*, 缺了就會退回本尊的名字 —
 * 2026-08 就因此讓「阿爾套裝卡露妮 & 沙奈朵」顯示成「卡露妮 & 沙奈朵」(與本尊撞名,
 * 還連帶繼承了本尊的超覺醒旗標), 另有 5 隻拍組整個沒進 catalog。詳見 docs/data-update.md。
 *
 * 失敗 (brybry 掛掉) 時保留既有本機檔, 不覆寫。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const brybryDir = join(__dirname, "..", "src", "data", "brybry");
const BASE = "https://pokemon.brybry.ch/masters/data/proto";
const LSD = "https://pokemon.brybry.ch/masters/data/lsd";

const FILES = [
  "Trainer",
  "TrainerBase",
  "TrainerExRole",
  "Monster",
  "MonsterBase",
  "Move",
  // 超覺醒名單 (誰能超覺醒的唯一權威; pomatools 的 dateAwakening 會落後)
  "TrainerSpecialAwaking",
];

/** 在地化名稱 (lsd 路徑) — 檔名即輸出檔名 */
const LSD_FILES = [
  "trainer_name_zh-TW",
  "trainer_name_en",
  "trainer_verbose_name_zh-TW",
  "trainer_verbose_name_en",
  "monster_name_zh-TW",
  "monster_name_en",
  // 形態名 (春天的樣子/化身形態…) — 同名拍組要靠它區分
  "monster_form_zh-TW",
  "monster_form_en",
];

async function fetchJsonText(name, base = BASE) {
  const url = `${base}/${name}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const text = await r.text();
  JSON.parse(text); // 驗證是合法 JSON 才寫
  return text;
}

async function main() {
  mkdirSync(brybryDir, { recursive: true });
  let ok = 0;
  let failed = 0;
  for (const name of FILES) {
    try {
      const text = await fetchJsonText(name);
      writeFileSync(join(brybryDir, `${name}.json`), text, "utf8");
      const count = JSON.parse(text).entries?.length ?? "?";
      console.log(`  ✓ ${name}.json (${count} entries)`);
      ok++;
    } catch (e) {
      console.warn(`  ⚠ ${name}.json 抓取失敗 (${e.message}) — 保留既有本機檔`);
      failed++;
    }
  }
  for (const name of LSD_FILES) {
    try {
      const text = await fetchJsonText(name, LSD);
      writeFileSync(join(brybryDir, `${name}.json`), text, "utf8");
      console.log(`  ✓ ${name}.json (${Object.keys(JSON.parse(text)).length} names)`);
      ok++;
    } catch (e) {
      console.warn(`  ⚠ ${name}.json 抓取失敗 (${e.message}) — 保留既有本機檔`);
      failed++;
    }
  }
  console.log(`brybry proto+lsd: ${ok} 更新, ${failed} 失敗 (沿用本機)`);
  // 全部失敗才算錯 (一個都沒抓到); 部分失敗沿用本機繼續
  if (ok === 0) {
    console.error("✖ brybry proto 全部抓取失敗 — 改用既有本機資料 (不會有新拍組)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("✖ fetch-brybry-proto 失敗:", e);
  process.exit(1);
});
