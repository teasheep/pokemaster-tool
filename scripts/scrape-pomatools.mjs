#!/usr/bin/env node
/**
 * 從 pomatools.github.io 撈拍組資料 + 圖片做為圖片比對的參照
 *
 * 用法:
 *   node scripts/scrape-pomatools.mjs              # 預設只撈 normal 系
 *   node scripts/scrape-pomatools.mjs --type=fire  # 撈火系
 *   node scripts/scrape-pomatools.mjs --all        # 撈全部 (18 系)
 *
 * 輸出:
 *   src/data/pomatools-pairs.json           — 結構化拍組元資料
 *   public/reference/pokemon/<id>_128.png   — pokemon 圖
 *   public/reference/trainer/<id>.png       — trainer 圖 (best effort)
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const BASE = "https://pomatools.github.io";
const PAIRS_URL = `${BASE}/assets/data/pairs.json`;
const I18N_URL = `${BASE}/assets/i18n/en.json`;
const I18N_ZH_URL = `${BASE}/assets/i18n/zh.json`;
const PKMN_IMG = (id) => `${BASE}/assets/img/pokemon/${id}_128.png`;
const TRAINER_IMG = (id) => `${BASE}/assets/img/trainer/${id}_00_128.png`;
const TRAINER_IMG_EX = (id) => `${BASE}/assets/img/trainer/${id}_00_128_ex.png`;

const TYPE_THEME = {
  normal: 20010001,
  fire: 20010002,
  water: 20010003,
  electric: 20010004,
  grass: 20010005,
  ice: 20010006,
  fighting: 20010007,
  poison: 20010008,
  ground: 20010009,
  flying: 20010010,
  psychic: 20010011,
  bug: 20010012,
  rock: 20010013,
  ghost: 20010014,
  dragon: 20010015,
  dark: 20010016,
  steel: 20010017,
  fairy: 20010018,
};

const args = process.argv.slice(2);
const all = args.includes("--all");
const typeArg = args.find((a) => a.startsWith("--type="))?.slice("--type=".length) ?? "normal";

const targetTypes = all ? Object.keys(TYPE_THEME) : [typeArg];
for (const t of targetTypes) {
  if (!TYPE_THEME[t]) {
    console.error(`不支援的屬性: ${t}; 有效值: ${Object.keys(TYPE_THEME).join(", ")}`);
    process.exit(1);
  }
}

async function getJson(url) {
  console.log(`fetch: ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function downloadBinary(url, dest) {
  if (existsSync(dest)) return false;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`  skip ${url}: ${r.status}`);
    return false;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return true;
}

function findTypeTheme(themes) {
  for (const code of themes ?? []) {
    for (const [name, themeCode] of Object.entries(TYPE_THEME)) {
      if (code === themeCode) return name;
    }
  }
  return null;
}

function findRegionTheme(themes, allThemes) {
  for (const code of themes ?? []) {
    if (Math.floor(code / 10000) === 2002) {
      return allThemes[String(code)] ?? null;
    }
  }
  return null;
}

function findTrainerGroupTheme(themes, allThemes) {
  for (const code of themes ?? []) {
    if (Math.floor(code / 10000) === 2003) {
      return allThemes[String(code)] ?? null;
    }
  }
  return null;
}

async function main() {
  const MOVES_URL = `${BASE}/assets/data/moves.json`;
  const [pairs, i18n, i18nZh, moves] = await Promise.all([
    getJson(PAIRS_URL),
    getJson(I18N_URL),
    getJson(I18N_ZH_URL),
    getJson(MOVES_URL),
  ]);
  const PKMN = i18n.DATA.PKMN;
  const CHAR = i18n.DATA.CHAR;
  const THEMES = i18n.DATA.THEMES;
  const PKMN_ZH = i18nZh.DATA?.PKMN ?? {};
  const CHAR_ZH = i18nZh.DATA?.CHAR ?? {};

  console.log(`\ntotal pairs in source: ${pairs.length}`);

  const wantedThemeCodes = new Set(targetTypes.map((t) => TYPE_THEME[t]));
  const filtered = pairs.filter((p) =>
    (p.themes ?? []).some((c) => wantedThemeCodes.has(c))
  );

  console.log(`pairs matching ${targetTypes.join("/")}: ${filtered.length}\n`);

  const pokemonDir = join(repoRoot, "public", "reference", "pokemon");
  const trainerDir = join(repoRoot, "public", "reference", "trainer");
  const cardDir = join(repoRoot, "public", "reference", "syncpair");
  mkdirSync(pokemonDir, { recursive: true });
  mkdirSync(trainerDir, { recursive: true });
  mkdirSync(cardDir, { recursive: true });

  const records = [];

  for (const p of filtered) {
    const trainerId = p.trainerId;
    const pokemonId = p.pokemon?.[0]?.id;
    if (!pokemonId) continue;

    const trainerName = CHAR[trainerId] ?? `trainer_${trainerId}`;
    const pokemonName = PKMN[pokemonId] ?? `pokemon_${pokemonId}`;
    const trainerNameZh = CHAR_ZH[trainerId] ?? null;
    const pokemonNameZh = PKMN_ZH[pokemonId] ?? null;
    const type = findTypeTheme(p.themes);
    const region = findRegionTheme(p.themes, THEMES);
    const group = findTrainerGroupTheme(p.themes, THEMES);

    // 額外抓: 角色定位 (role/exRole), 形態變身 (pokemon[1..N]), change 類型
    // ROLE_001 有 P/S 變體, 從 pokemon[0].moves[4] 判斷 (pomatools main.js: <4e4=P, 否則=S)
    let roleAsset = p.role;
    if (p.role === "ROLE_001") {
      const move4 = p.pokemon?.[0]?.moves?.[4] ?? 0;
      roleAsset = move4 < 40000 ? "ROLE_001P" : "ROLE_001S";
    }

    // 解析 TERA_XX kind 取出變身後屬性
    const TYPE_INDEX_TO_NAME = ["", "normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
    const forms = (p.pokemon ?? []).map((pk, idx) => {
      let formType = null;
      if (pk.kind?.startsWith("TERA_")) {
        const ti = parseInt(pk.kind.slice(5), 10);
        formType = TYPE_INDEX_TO_NAME[ti] ?? null;
      }
      return {
        index: idx,
        id: pk.id,
        kind: pk.kind,
        weak: pk.weak,           // 弱點屬性
        formType,                 // tera 後屬性 (僅 TERA_XX)
      };
    });

    // moveTypes: 從 BASE form 的所有招式 (moves[0..4]) 蒐集獨特屬性, 順序保留
    // moves.json 結構: { "id": { type: "TYPE_XXX", kind: "MV"/"SY"/"PA", ... } }
    const TYPEID_TO_NAME = {
      TYPE_001: "normal", TYPE_002: "fire", TYPE_003: "water", TYPE_004: "electric",
      TYPE_005: "grass", TYPE_006: "ice", TYPE_007: "fighting", TYPE_008: "poison",
      TYPE_009: "ground", TYPE_010: "flying", TYPE_011: "psychic", TYPE_012: "bug",
      TYPE_013: "rock", TYPE_014: "ghost", TYPE_015: "dragon", TYPE_016: "dark",
      TYPE_017: "steel", TYPE_018: "fairy",
    };
    const moveTypes = [];
    const seenTypes = new Set();
    const baseMoves = p.pokemon?.[0]?.moves ?? [];
    for (const moveId of baseMoves) {
      if (moveId <= 0) continue;
      const mv = moves[String(moveId)];
      if (!mv) continue;
      // 變化招 (power=0) 不算入屬性顯示 — 一般系變化招不該多出一個一般 icon
      if ((mv.power ?? 0) <= 0) continue;
      const typeName = TYPEID_TO_NAME[mv.type];
      if (typeName && !seenTypes.has(typeName)) {
        seenTypes.add(typeName);
        moveTypes.push(typeName);
      }
    }

    // pairKind: main.js 原邏輯 — 只有 28e5 < r < 2903e3 區間有徽章
    // (之前漏了上限, 導致一般拍組被誤標 arc)
    let pairKind = "none";
    const r = p.pokemon?.[0]?.skills?.length ? p.pokemon[0].skills[0][0] : 9999999;
    if (r > 2800000 && r < 2903000) {
      pairKind = r > 2900000 ? "arc" : r > 2804000 ? "exmaster" : "master";
    }

    const record = {
      pairId: p.id,
      trainerId,
      pokemonId,
      trainerName,
      pokemonName,
      trainerNameZh,
      pokemonNameZh,
      type,
      region,
      group,
      basePotential: p.promotion ?? 3,
      exMode: p.exMode ?? 0,
      // 新欄位
      role: p.role ?? null,
      roleAsset,                          // ROLE_001P / ROLE_001S / ROLE_002 ...
      exRole: p.exRole || null,
      change: p.change ?? "NONE",         // ALTR/SYNC/TERA/EVOL/NONE
      forms,                              // 全部形態
      moveTypes,                          // BASE form 招式屬性 (排除變化招 power=0)
      pairKind,                           // master / exmaster / arc / egg / academy / none
      themes: p.themes ?? [],             // 原始 themes (給未來 theme color 解析用)
      hasSixEx: (p.date6ex ?? 0) > 0,     // 6EX 可達
      hasExRole: (p.dateExRole ?? 0) > 0, // EX role 可解
      hasAwakening: (p.dateAwakening ?? 0) > 0, // 超覺醒可達 (Lv 200)
      acquisition: p.acquisition ?? null, // 取得方式
      // 圖片路徑 (既有)
      pokemonImagePath: `/reference/pokemon/${pokemonId}_128.png`,
      pokemonImageUrl: PKMN_IMG(pokemonId),
      trainerImagePath: `/reference/trainer/${trainerId}_00_128.png`,
      trainerImageUrl: TRAINER_IMG(trainerId),
      trainerImageExUrl: TRAINER_IMG_EX(trainerId),
      cardImagePath: `/reference/syncpair/${p.id}_card.png`,
      trainerFacePath: `/reference/trainer-face/${trainerId}_face.png`,
      trainerCirclePath: `/reference/trainer-circle/${trainerId}_circle.png`,
      pokemonCirclePath: `/reference/pokemon-circle/${pokemonId}_circle.png`,
    };
    records.push(record);
  }

  console.log("downloading images...");
  let pkmnDownloaded = 0;
  let trainerDownloaded = 0;
  const seenPkmn = new Set();
  const seenTrainer = new Set();

  for (const r of records) {
    if (!seenPkmn.has(r.pokemonId)) {
      seenPkmn.add(r.pokemonId);
      if (await downloadBinary(r.pokemonImageUrl, join(pokemonDir, `${r.pokemonId}_128.png`))) {
        pkmnDownloaded++;
      }
    }
    if (!seenTrainer.has(r.trainerId)) {
      seenTrainer.add(r.trainerId);
      if (
        await downloadBinary(
          r.trainerImageUrl,
          join(trainerDir, `${r.trainerId}_00_128.png`)
        )
      ) {
        trainerDownloaded++;
      }
    }
  }

  console.log(`\ndownloaded ${pkmnDownloaded} pokemon images (${seenPkmn.size} unique)`);
  console.log(`downloaded ${trainerDownloaded} trainer images (${seenTrainer.size} unique)`);

  // 強制重新合成 (因為版面變了)
  console.log("\ncompositing sync pair cards (in-game style)...");
  let cardCount = 0;
  const CARD_SIZE = 200;
  // trainer 放 (10, 40), 128×128 — 讓 face 落在 (74, 64) 即 (0.37, 0.32),
  //   接近遊戲卡片內 face 中心 (~0.45, 0.40)
  const TRAINER_X = 10;
  const TRAINER_Y = 40;
  const TRAINER_SIZE = 128;
  const POKEMON_SIZE = 56;
  const POKEMON_MARGIN = 4;
  const POKEMON_X = CARD_SIZE - POKEMON_SIZE - POKEMON_MARGIN;
  const POKEMON_Y = CARD_SIZE - POKEMON_SIZE - POKEMON_MARGIN;

  // 白色圓圈背景 + 灰色外框 (模擬遊戲內 pokemon overlay 圈)
  const circleSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${POKEMON_SIZE}" height="${POKEMON_SIZE}">` +
      `<circle cx="${POKEMON_SIZE / 2}" cy="${POKEMON_SIZE / 2}" r="${POKEMON_SIZE / 2 - 2}" fill="#f5f5f5" stroke="#999" stroke-width="1.5"/>` +
      `</svg>`
  );

  for (const r of records) {
    const trainerPath = join(trainerDir, `${r.trainerId}_00_128.png`);
    const pokemonPath = join(pokemonDir, `${r.pokemonId}_128.png`);
    const cardPath = join(cardDir, `${r.pairId}_card.png`);
    if (!existsSync(trainerPath) || !existsSync(pokemonPath)) continue;

    try {
      const trainerBuf = readFileSync(trainerPath);
      const pokemonBuf = readFileSync(pokemonPath);

      // trainer 縮 128×128 放在 (10, 40) — face 對齊遊戲卡片內位置
      const trainerScaled = await sharp(trainerBuf)
        .resize(TRAINER_SIZE, TRAINER_SIZE, { fit: "cover" })
        .toBuffer();

      // pokemon 縮成 ~48px (POKEMON_SIZE - 8 padding for circle ring)
      const pokemonInner = POKEMON_SIZE - 8;
      const pokemonScaled = await sharp(pokemonBuf)
        .resize(pokemonInner, pokemonInner, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .toBuffer();

      await sharp({
        create: {
          width: CARD_SIZE,
          height: CARD_SIZE,
          channels: 4,
          background: { r: 255, g: 243, b: 209, alpha: 1 },
        },
      })
        .composite([
          { input: trainerScaled, left: TRAINER_X, top: TRAINER_Y },
          { input: circleSvg, left: POKEMON_X, top: POKEMON_Y },
          {
            input: pokemonScaled,
            left: POKEMON_X + 4,
            top: POKEMON_Y + 4,
          },
        ])
        .png()
        .toFile(cardPath);
      cardCount++;
    } catch (e) {
      console.warn(`  failed ${r.pairId}: ${e.message}`);
    }
  }
  console.log(`composited ${cardCount} sync pair cards`);

  // === circle-masked references (跟 cell 用同樣遮罩, 比對才公平) ===
  console.log("\ngenerating circle-masked references...");

  const faceDir = join(repoRoot, "public", "reference", "trainer-face");
  const faceMaskedDir = join(repoRoot, "public", "reference", "trainer-circle");
  const pokeMaskedDir = join(repoRoot, "public", "reference", "pokemon-circle");
  mkdirSync(faceDir, { recursive: true });
  mkdirSync(faceMaskedDir, { recursive: true });
  mkdirSync(pokeMaskedDir, { recursive: true });

  // trainer face: 對齊版本 (face 在 96x96 canvas 中央) + 圓形遮罩
  const FACE_SIZE = 96;
  const faceCircleMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_SIZE}" height="${FACE_SIZE}"><circle cx="${FACE_SIZE / 2}" cy="${FACE_SIZE / 2}" r="${FACE_SIZE / 2 - 2}" fill="white"/></svg>`
  );

  let faceCount = 0;
  for (const tid of seenTrainer) {
    const src = join(trainerDir, `${tid}_00_128.png`);
    if (!existsSync(src)) continue;
    try {
      // 取 pomatools 128x128 trainer 圖的中央上半部 (頭臉) — face center 估計在 (64, 40)
      // 裁出 80x80 方塊 face 中心在 (40, 40), 然後 resize 到 96x96
      const faceCrop = await sharp(src)
        .extract({ left: 24, top: 0, width: 80, height: 80 })
        .resize(FACE_SIZE, FACE_SIZE, { fit: "fill" })
        .toBuffer();

      // 套圓形 mask, 圓外塗黑
      await sharp({
        create: {
          width: FACE_SIZE,
          height: FACE_SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .composite([
          { input: faceCrop, top: 0, left: 0 },
          { input: faceCircleMask, blend: "dest-in" },
        ])
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .png()
        .toFile(join(faceMaskedDir, `${tid}_circle.png`));

      // 也保留無 mask 版本給除錯參考
      await sharp(faceCrop)
        .flatten({ background: { r: 255, g: 243, b: 209 } })
        .png()
        .toFile(join(faceDir, `${tid}_face.png`));

      faceCount++;
    } catch (e) {
      console.warn(`  face mask failed ${tid}: ${e.message}`);
    }
  }
  console.log(`generated ${faceCount} circle-masked trainer faces`);

  // pokemon: trim 透明 + 等比例縮放置中 + 圓形遮罩
  const POKE_SIZE = 128;
  const pokeCircleMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${POKE_SIZE}" height="${POKE_SIZE}"><circle cx="${POKE_SIZE / 2}" cy="${POKE_SIZE / 2}" r="${POKE_SIZE / 2 - 4}" fill="white"/></svg>`
  );

  let pokeCount = 0;
  for (const pid of seenPkmn) {
    const src = join(pokemonDir, `${pid}_128.png`);
    if (!existsSync(src)) continue;
    try {
      // trim transparent, scale to fit in 110x110, centered in 128x128
      const trimmed = await sharp(src)
        .trim({ threshold: 5 })
        .resize(110, 110, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .toBuffer();

      await sharp({
        create: {
          width: POKE_SIZE,
          height: POKE_SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .composite([
          { input: trimmed, top: 9, left: 9 },
          { input: pokeCircleMask, blend: "dest-in" },
        ])
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .png()
        .toFile(join(pokeMaskedDir, `${pid}_circle.png`));

      pokeCount++;
    } catch (e) {
      console.warn(`  poke mask failed ${pid}: ${e.message}`);
    }
  }
  console.log(`generated ${pokeCount} circle-masked pokemons`);

  const outPath = join(repoRoot, "src", "data", "pomatools-pairs.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        source: "https://pomatools.github.io/assets/data/pairs.json",
        generatedAt: new Date().toISOString(),
        types: targetTypes,
        count: records.length,
        records,
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${records.length} records → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
