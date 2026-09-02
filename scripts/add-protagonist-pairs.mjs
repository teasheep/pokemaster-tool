#!/usr/bin/env node
/**
 * 補「主角 (Player) 拍組」— brybry/pomatools 都不收錄, 但道館賽很常用
 * (雷吉斯奇魯/勾帕路翁/艾姆利多/雷吉洛克/雷公/爆肌蚊 這些大師任務的傳說輔助)。
 *
 * 主角在遊戲裡可自訂外觀, 這裡固定用官方預設男主角 (Scottie) 立繪當代表形象,
 * 全部拍組共用同一張圖 (public/reference/trainer/chp000_00_player_128.png)。
 *
 * 資料來源: fandom wiki roster (src/data/wiki-ex-style.json 的 protagonist 條目) —
 * 屬性/角色/原始星級/上架日期都對得上; 寶可夢繪圖走 PokeAPI official-artwork。
 * 冪等可重跑: 已存在的 pairId 會覆蓋更新, 圖檔存在就不重抓。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { toTrainer128 } from "./lib-trainer-image.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const catalogPath = join(repoRoot, "src", "data", "pomatools-pairs.json");
const pub = (...p) => join(repoRoot, "public", ...p);

const WIKI_UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } };
const orig = (u) => `${u}${u.includes("?") ? "&" : "?"}format=original`;

/** 官方預設男主角 (Scottie) — 主角所有拍組共用這張 */
const PLAYER_TRAINER_ID = "chp000_00_player";
const PLAYER_IMAGE =
  "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/4/4b/Scottie.png/revision/latest";

/**
 * 主角拍組 (wiki roster 去重後 11 筆; 每年 8/28 的大師任務拍組會多一隻, 見下面的漏收偵測)。
 * dex = 全國圖鑑編號 (PokeAPI official-artwork 用)
 * star = 原始星級, six = 可 6★EX, awak = 可超覺醒
 */
const PAIRS = [
  { dex: 25, en: "Pikachu", zh: "皮卡丘", type: "electric", roleAsset: "ROLE_001S", star: 3, six: true, awak: true, released: "2019-08-29", series: "story" },
  { dex: 255, en: "Torchic", zh: "火稚雞", type: "fire", roleAsset: "ROLE_002", star: 3, six: false, awak: false, released: "2019-11-07", series: "story" },
  { dex: 791, en: "Solgaleo", zh: "索爾迦雷歐", type: "steel", roleAsset: "ROLE_001P", star: 5, six: true, awak: false, released: "2020-01-01", series: "legendary" },
  { dex: 377, en: "Regirock", zh: "雷吉洛克", type: "rock", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2021-05-27", series: "master" },
  { dex: 638, en: "Cobalion", zh: "勾帕路翁", type: "fighting", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2021-05-27", series: "master" },
  { dex: 481, en: "Mesprit", zh: "艾姆利多", type: "psychic", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2022-08-28", series: "master" },
  { dex: 379, en: "Registeel", zh: "雷吉斯奇魯", type: "steel", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2023-08-28", series: "master" },
  { dex: 869, en: "Alcremie", zh: "霜奶仙", type: "fairy", roleAsset: "ROLE_002", star: 4, six: false, awak: false, released: "2024-02-14", series: "event" },
  { dex: 243, en: "Raikou", zh: "雷公", type: "electric", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2024-08-28", series: "master" },
  { dex: 794, en: "Buzzwole", zh: "爆肌蚊", type: "bug", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2025-08-28", series: "master" },
  // 2026 週年慶 (BP 兌換)。datamine 佐證: Trainer.json 18000021021 —
  // type=8(毒) / role=2(support) / rarity=5 / exScheduleId=NEVER / 不在 TrainerExRole 也不在
  // TrainerSpecialAwaking → six=false, awak=false; scheduleId chara_8080_0828 接續
  // 艾姆利多(4080)→雷吉斯奇魯(5080)→雷公(6080)→爆肌蚊(7080) 那條年度線。
  { dex: 803, en: "Poipole", zh: "毒貝比", type: "poison", roleAsset: "ROLE_002", star: 5, six: false, awak: false, released: "2026-08-28", series: "master", acq: ["bp"] },
];

/**
 * 漏收偵測 —— 這份 PAIRS 是手寫的, 每年 8/28 多一隻就會落後 (2026-09 就漏掉毒貝比,
 * 而 reconcile 的「候選新拍組」把它夾在 10 筆既有主角拍組中間, 看報告根本分辨不出來)。
 *
 * datamine 裡主角拍組是 trainerId 開頭 18 的列, 其中 rarity=5 的恰好就是這幾隻大師任務拍組
 * —— 數量對不上就出聲。用 datamine 而不是 wiki: 不依賴 fandom 表格排版, wiki 落後時也抓得到。
 * (為什麼不直接自動產: 18xxx 列的 trainerNameId 是 ch8000 hero, trainer_name_en.json 沒有這個鍵,
 *  scrape-brybry 會整批丟掉 —— 名字/繁中名/系列還是得手寫, 這裡只負責提醒。)
 */
function warnIfProtagonistPairsMissing() {
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot, "src", "data", "brybry", "Trainer.json"), "utf8"));
    const rows = Array.isArray(raw) ? raw : Object.values(raw)[0];
    const heroes = rows.filter((t) => String(t.trainerId).startsWith("18") && t.rarity === 5);
    if (heroes.length > PAIRS.length) {
      console.warn(
        `⚠ datamine 有 ${heroes.length} 筆 rarity=5 的主角拍組, 但這支腳本只寫了 ${PAIRS.length} 筆 —` +
          ` 可能又有新的沒補 (對照 src/data/brybry/Trainer.json 的 18xxx 列)。`
      );
    }
  } catch {
    // datamine 還沒抓下來 (單獨跑這支腳本時) — 純提醒功能, 靜默略過
  }
}

const ROLE_OF = {
  ROLE_001P: "strike",
  ROLE_001S: "strike",
  ROLE_002: "support",
  ROLE_004: "tech",
  ROLE_008: "sprint",
  ROLE_016: "field",
};

async function download(url, useOriginal) {
  const res = await fetch(useOriginal ? orig(url) : url, WIKI_UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

warnIfProtagonistPairsMissing();

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

// ── 主角立繪 (共用) ──
const tPath = pub("reference", "trainer", `${PLAYER_TRAINER_ID}_128.png`);
if (!existsSync(tPath)) {
  writeFileSync(tPath, await toTrainer128(await download(PLAYER_IMAGE, true)));
  console.log(`主角立繪已下載 → ${PLAYER_TRAINER_ID}_128.png`);
}

let added = 0;
let updated = 0;
for (const p of PAIRS) {
  const pokemonId = `pmp${String(p.dex).padStart(3, "0")}_00_${p.en.toLowerCase()}`;
  const pairId = `player-${p.en.toLowerCase()}`;
  const record = {
    pairId,
    trainerId: PLAYER_TRAINER_ID,
    pokemonId,
    trainerName: "Player",
    pokemonName: p.en,
    trainerNameZh: "主角",
    pokemonNameZh: p.zh,
    type: p.type,
    region: "Pasio",
    group: null,
    basePotential: p.star,
    role: ROLE_OF[p.roleAsset],
    roleAsset: p.roleAsset,
    exRole: null,
    hasExRole: false,
    change: "NONE",
    forms: [{ index: 0, id: "base", kind: "BASE" }],
    moveTypes: [p.type],
    hasSixEx: p.six,
    hasAwakening: p.awak,
    hasExStyle: false,
    releaseDate: p.released,
    series: p.series,
    // 取得管道 —— 大師徽章會蓋掉 series (AGENTS.md: 有拍組掛大師徽章其實是 BP 兌換),
    // 篩選 series 與 acquisitions 兩邊都吃, 所以手寫時要一起給。pomatools 收錄後 4c 會覆蓋。
    ...(p.acq ? { acquisitions: p.acq } : {}),
    // 卡面徽章看的是 pairKind 而不是 series (sync-pair-card.tsx) —— 大師任務拍組要給 "master",
    // 否則卡片沒有大師徽章。pomatools 收錄後 4c 會用它自己的值覆蓋。
    pairKind: p.series === "master" ? "master" : "none",
    manualSource: "protagonist",
  };

  // 寶可夢繪圖 (PokeAPI official-artwork → 128 透明 PNG)
  const pPath = pub("reference", "pokemon", `${pokemonId}_128.png`);
  if (!existsSync(pPath)) {
    const art = await download(
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.dex}.png`,
      false
    );
    writeFileSync(
      pPath,
      await sharp(art).trim().resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    );
    console.log(`寶可夢圖 ${p.zh} → ${pokemonId}_128.png`);
  }

  const idx = catalog.records.findIndex((r) => r.pairId === pairId);
  if (idx >= 0) {
    // pomatools 其實有收 Player 拍組的 meta (series/日期/取得管道) — 已經被 4c 補上的
    // 就別用這裡的手寫值蓋回去, 手寫值只當 pomatools 沒有時的 fallback。
    //
    // ⚠ `series: "upcoming"` / `pairKind: "none"` **不算 pomatools 有值**: 那是 4c 在
    // 「pomatools 查無此拍組」時填的佔位值 (見 patch-pomatools-meta.mjs 的 oldRelease 分支)。
    // 用 `??` 判斷會讓佔位值贏過手寫值 —— 2026-09 新補的「主角 & 毒貝比」就這樣從
    // series=master 掉成 upcoming, 結果卡片沒有大師徽章、系列篩選按哪個 chip 都找不到。
    const prev = catalog.records[idx];
    const pomaKnows = prev.series && prev.series !== "upcoming";
    catalog.records[idx] = {
      ...record,
      series: pomaKnows ? prev.series : record.series,
      releaseDate: prev.releaseDate ?? record.releaseDate,
      ...(prev.acquisitions ? { acquisitions: prev.acquisitions } : {}),
      ...(prev.pairKind && prev.pairKind !== "none" ? { pairKind: prev.pairKind } : {}),
    };
    updated++;
  } else {
    catalog.records.push(record);
    added++;
  }
}

catalog.records.sort((a, b) => String(a.pairId).localeCompare(String(b.pairId)));
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`主角拍組: 新增 ${added} ・ 更新 ${updated} ・ catalog 共 ${catalog.records.length} 筆`);
