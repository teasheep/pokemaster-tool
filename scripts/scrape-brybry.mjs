#!/usr/bin/env node
/**
 * 從 brybry.ch 的 datamined proto 資料建 sync pair 收藏
 * 1089 個 trainer entries (vs pomatools 659)
 *
 * 輸出: src/data/pomatools-pairs.json (覆蓋舊版, 同 schema 保持 consumer 不變)
 * 圖片: 嘗試從 pomatools CDN 下載到 public/reference/{trainer,pokemon}/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const brybryDir = join(repoRoot, "src", "data", "brybry");

// ====== 載入 brybry 資料 ======
const trainerData = JSON.parse(readFileSync(join(brybryDir, "Trainer.json"), "utf-8"));
const trainerBase = JSON.parse(readFileSync(join(brybryDir, "TrainerBase.json"), "utf-8"));
const trainerExRole = JSON.parse(readFileSync(join(brybryDir, "TrainerExRole.json"), "utf-8"));
const monsterData = JSON.parse(readFileSync(join(brybryDir, "Monster.json"), "utf-8"));
const monsterBase = JSON.parse(readFileSync(join(brybryDir, "MonsterBase.json"), "utf-8"));
const moveData = JSON.parse(readFileSync(join(brybryDir, "Move.json"), "utf-8"));
// 超覺醒名單 (誰能超覺醒) — datamine 是唯一權威, pomatools 的 dateAwakening 會落後
const specialAwaking = existsSync(join(brybryDir, "TrainerSpecialAwaking.json"))
  ? JSON.parse(readFileSync(join(brybryDir, "TrainerSpecialAwaking.json"), "utf-8"))
  : { entries: [] };

const tzh = JSON.parse(readFileSync(join(brybryDir, "trainer_name_zh-TW.json"), "utf-8"));
const ten = JSON.parse(readFileSync(join(brybryDir, "trainer_name_en.json"), "utf-8"));
const vzh = JSON.parse(readFileSync(join(brybryDir, "trainer_verbose_name_zh-TW.json"), "utf-8"));
const ven = JSON.parse(readFileSync(join(brybryDir, "trainer_verbose_name_en.json"), "utf-8"));
const mzh = JSON.parse(readFileSync(join(brybryDir, "monster_name_zh-TW.json"), "utf-8"));
const men = JSON.parse(readFileSync(join(brybryDir, "monster_name_en.json"), "utf-8"));
// (形態名在管線最後一步才用 — disambiguate-pair-names.mjs)

// ====== 索引 ======
const tbById = new Map(trainerBase.entries.map((e) => [String(e.id), e]));
const exRoleByTrainerId = new Map(trainerExRole.entries.map((e) => [String(e.trainerId), e]));
const monById = new Map(monsterData.entries.map((e) => [String(e.monsterId), e]));
const monBaseById = new Map(monsterBase.entries.map((e) => [String(e.monsterBaseId), e]));
const moveById = new Map(moveData.entries.map((e) => [String(e.moveId), e]));
const awakeningIds = new Set((specialAwaking.entries ?? []).map((e) => String(e.trainerId)));

// ====== 對照表 ======
const TYPE_NAMES = [
  "", "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon",
  "dark", "steel", "fairy",
];
// brybry role enum (確認自 brybry locale role_names):
//   0=攻擊型(物理) 1=攻擊型(特殊) 2=輔助型 3=技術型 4=速戰型 5=場地型 6=複合型
// ROLE_*.png 用 power-of-2 命名 (ROLE_001=Strike, 002=Support, 004=Tech, 008=Sprint, 016=Field, 032=Multi)
function roleToAsset(role) {
  switch (role) {
    case 0: return "ROLE_001P"; // 物理攻擊
    case 1: return "ROLE_001S"; // 特殊攻擊
    case 2: return "ROLE_002";  // 輔助型 Support (愛心)
    case 3: return "ROLE_004";  // 技術型 Tech (眼睛)
    case 4: return "ROLE_008";  // 速戰型 Sprint (雙箭頭)
    case 5: return "ROLE_016";  // 場地型 Field (山形)
    case 6: return "ROLE_032";  // 複合型 Multi (雙圈)
    default: return null;
  }
}
// 泛用 role (不分 P/S, 給 type-skill 等用)
function roleToGeneric(role) {
  if (role === 0 || role === 1) return "ROLE_001";
  return roleToAsset(role);
}

// ====== 建記錄 ======
const records = [];
let missingTrainer = 0;
let missingMon = 0;
let npcSkipped = 0;
let missingBase = 0;

for (const t of trainerData.entries) {
  // number=111 是 datamine 的「劇情/NPC 版」哨兵值 (鎯琊/棘兒/螺伯 的 _00 版與 hero 雜項),
  // 玩家拿不到, 卻會跟真正的 _01 拍組同名 → 直接不收 (前科: 鎯琊 & 胡帕 收了三筆, 還留錯那筆)
  if (t.number === 111) { npcSkipped++; continue; }
  const base = tbById.get(String(t.trainerBaseId));
  if (!base) { missingBase++; continue; }
  const m = monById.get(String(t.monsterId));
  if (!m) { missingMon++; continue; }
  const mb = monBaseById.get(String(m.monsterBaseId));
  if (!mb) { missingMon++; continue; }

  const trainerEn = (ven[t.trainerId] || ten[base.trainerNameId] || "").replace(/\s+/g, " ").trim();
  const trainerZh = (vzh[t.trainerId] || tzh[base.trainerNameId] || "").replace(/\s+/g, "").trim();
  if (!trainerEn) { missingTrainer++; continue; }
  const pokeEn = men[String(mb.monsterNameId)] || "";
  const pokeZh = mzh[String(mb.monsterNameId)] || "";

  // 用 actorId 當檔名 — 保證 unique (slice(-6) 對 10-digit mb 會衝突, 334 個寶可夢被誤覆蓋)
  // 範例: ch0360_00_kakitsubata (杜若), pm1018_00_00_briduras (鋁鋼橋龍)
  const trainerActor = base.actorId;
  const monsterActor = mb.actorId;
  const trainerImgId = trainerActor;
  const pokeImgId = monsterActor;

  const type = TYPE_NAMES[t.type] || "normal";

  // Role + EX role — 直接用 brybry role enum (0/1=物理/特殊攻擊, 2-6=其他)
  const role = roleToGeneric(t.role);     // 泛用 (ROLE_001 不分 P/S)
  const roleAsset = roleToAsset(t.role);  // 含 P/S (ROLE_001P / ROLE_001S)
  const exr = exRoleByTrainerId.get(t.trainerId);
  const exRole = exr ? roleToAsset(exr.role) : null;

  // moveTypes: 從 4 招過濾 power>0 取 unique type
  const moveIds = [t.move1Id, t.move2Id, t.move3Id, t.move4Id].filter((x) => x > 0);
  const moveTypes = [];
  const seen = new Set();
  for (const mid of moveIds) {
    const mv = moveById.get(String(mid));
    if (!mv) continue;
    if ((mv.power || 0) <= 0) continue;
    const tn = TYPE_NAMES[mv.type];
    if (tn && !seen.has(tn)) {
      seen.add(tn);
      moveTypes.push(tn);
    }
  }

  // 拍組類別: brybry 沒有直接欄位, 用 trainerKind + role 推
  // trainerKind: 2 = 大師? (pomatools master 對應的 entries 多是 special pairs)
  // 暫時都標 none, 之後可以加邏輯
  let pairKind = "none";
  // exMode 推: 有 ExRole 的高機率有 EX
  const exMode = exr ? 1 : 0;

  records.push({
    pairId: t.trainerId,            // 11-digit (brybry)
    trainerId: trainerImgId,         // 6-digit (pomatools-style for image)
    pokemonId: pokeImgId,
    trainerName: trainerEn,
    pokemonName: pokeEn,
    trainerNameZh: trainerZh || null,
    pokemonNameZh: pokeZh || null,
    type,
    region: null,
    group: null,
    basePotential: t.rarity ?? 5,
    exMode,
    role,
    roleAsset,
    exRole,
    change: "NONE",
    forms: [],
    moveTypes,
    pairKind,
    hasSixEx: !!exr,
    hasExRole: !!exr,
    hasAwakening: awakeningIds.has(String(t.trainerId)),
    // 檔名 = actorId (避免 ID 衝突)
    pokemonImagePath: `/reference/pokemon/${pokeImgId}_128.png`,
    pokemonImageUrl: `https://pokemon.brybry.ch/masters/data/actor/Monster/${monsterActor}/${monsterActor}_128.png`,
    // 形態 id — 同名拍組要靠它補形態名 (disambiguate-pair-names.mjs, 管線最後一步)
    formId: mb.formId || null,
    trainerImagePath: `/reference/trainer/${trainerImgId}_128.png`,
    trainerImageUrl: `https://pokemon.brybry.ch/masters/data/actor/Trainer/${trainerActor}/${trainerActor}_128.png`,
  });
}

console.log(`built ${records.length} records`);
console.log(
  `  skipped: missingBase=${missingBase}, missingMon=${missingMon}, missingTrainer=${missingTrainer}, npc(number=111)=${npcSkipped}`
);

// ====== 下載缺漏圖片 ======
const trainerDir = join(repoRoot, "public", "reference", "trainer");
const pokemonDir = join(repoRoot, "public", "reference", "pokemon");
mkdirSync(trainerDir, { recursive: true });
mkdirSync(pokemonDir, { recursive: true });

async function dl(url, dest) {
  if (existsSync(dest)) return "cached";
  try {
    const r = await fetch(url);
    if (!r.ok) return `404:${r.status}`;
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return "ok";
  } catch (e) {
    return `err:${e.message}`;
  }
}

// Serebii fallback: 用英文 first name 做 slug (Teddy/Eve/Petey 等 NPC trainer brybry 沒收圖)
async function dlSerebiiTrainer(trainerEn, dest) {
  if (existsSync(dest)) return "cached";
  const firstName = trainerEn.split(/[\s(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!firstName) return "skip";
  try {
    const r = await fetch(`https://www.serebii.net/pokemonmasters/syncpairs/icons/${firstName}.png`);
    if (!r.ok) return `serebii_404:${r.status}`;
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return "serebii_ok";
  } catch (e) {
    return `err:${e.message}`;
  }
}

const args = process.argv.slice(2);
const skipImages = args.includes("--no-images");
let okT = 0, okP = 0, failT = 0, failP = 0;
const seenT = new Set();
const seenP = new Set();
const failedTrainerIds = [];
const failedPokemonIds = [];

if (!skipImages) {
  console.log("\ndownloading images (this takes a while if many new)...");
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!seenT.has(r.trainerId)) {
      seenT.add(r.trainerId);
      const s = await dl(r.trainerImageUrl, join(trainerDir, `${r.trainerId}_128.png`));
      if (s === "ok") okT++;
      else if (s !== "cached") { failT++; failedTrainerIds.push(r.trainerId); }
    }
    if (!seenP.has(r.pokemonId)) {
      seenP.add(r.pokemonId);
      const s = await dl(r.pokemonImageUrl, join(pokemonDir, `${r.pokemonId}_128.png`));
      if (s === "ok") okP++;
      else if (s !== "cached") { failP++; failedPokemonIds.push(r.pokemonId); }
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${records.length} processed (T: ${okT} new, ${failT} fail; P: ${okP} new, ${failP} fail)`);
  }
  console.log(`\ndownload done: trainer ${okT} new + ${failT} fail; pokemon ${okP} new + ${failP} fail`);
  if (failedTrainerIds.length > 0) console.log("failed trainer IDs:", failedTrainerIds.slice(0, 20));
  if (failedPokemonIds.length > 0) console.log("failed pokemon IDs:", failedPokemonIds.slice(0, 20));
}

// ====== 寫 JSON ======
const out = join(repoRoot, "src", "data", "pomatools-pairs.json");
writeFileSync(
  out,
  JSON.stringify({ records, source: "brybry", generatedAt: new Date().toISOString() }, null, 0)
);
console.log(`\nwrote ${records.length} records → ${out}`);
