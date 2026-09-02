#!/usr/bin/env node
/**
 * 補「brybry 還沒收錄但已實裝」的拍組 (wiki 為權威來源)。冪等可重跑:
 *   - brybry 已收錄同名拍組 (EN trainer+pokemon) 時, 自動移除這裡的手動紀錄讓位
 *   - 圖: 訓練家立繪 (fandom 模型圖, 處理成 brybry 128 規格) + 寶可夢 (PokeAPI 官方繪)
 *
 * 目前收錄: 生彩(Harmony)&大力鱷、蓋伊(Urbain)&大竺葵 (2026-08 EX Fair, 傳說 Z-A 角色;
 * zh 名出處 Bulbapedia)。brybry/pomatools 跟上後這兩筆會自動讓位, 屆時可清掉 PAIRS。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const catalogPath = join(repoRoot, "src", "data", "pomatools-pairs.json");
const pub = (...p) => join(repoRoot, "public", ...p);

const WIKI_UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } };
// fandom CDN 對非瀏覽器 client 回 WebP — 帶 format=original 才拿原 PNG
const orig = (u) => `${u}${u.includes("?") ? "&" : "?"}format=original`;

/**
 * brybry 已有紀錄但 i18n 缺寶可夢名的 stub (卡片會顯示「??? 」) — 依 datamine
 * pokemonId 與官方新聞補名。brybry 補上 i18n 後值相同, 無害。
 */
const STUB_FIXES = {
  10026000002: { pokemonName: "Girafarig", pokemonNameZh: "麒麟奇" }, // 小茜 & 麒麟奇 (datamine)
  10291400000: { pokemonName: "Manaphy", pokemonNameZh: "瑪納霏" }, // 小照 (2026夏季) — 2026-07-30 實裝
  10312400000: { pokemonName: "Basculegion", pokemonNameZh: "幽尾玄魚" }, // 火夏 (2026夏季) — 2026-07-02 實裝
};

const PAIRS = [
  {
    record: {
      pairId: "wiki-harmony-feraligatr",
      trainerId: "chw001_00_harmony",
      pokemonId: "pmw160_00_feraligatr",
      trainerName: "Harmony",
      pokemonName: "Feraligatr",
      trainerNameZh: "生彩",
      pokemonNameZh: "大力鱷",
      type: "water",
      region: "Kalos",
      group: null,
      basePotential: 5,
      role: "sprint",
      roleAsset: "ROLE_008",
      exRole: "ROLE_001P",
      hasExRole: true,
      change: "MEGA",
      forms: [
        { index: 0, id: "base", kind: "BASE" },
        { index: 1, id: "mega", kind: "MEGA" },
      ],
      moveTypes: ["water"],
      hasSixEx: true,
      hasAwakening: true,
      hasExStyle: true,
      exStyleImagePath: "/reference/trainer-ex/chw001_00_harmony_ex.png",
      manualSource: "wiki",
    },
    images: {
      trainer:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/9/98/Harmony.png/revision/latest?cb=20260803024053",
      trainerEx:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/6/6a/HarmonyEX.png/revision/latest?cb=20260803024057",
      pokemon:
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/160.png",
    },
  },
  {
    record: {
      pairId: "wiki-urbain-meganium",
      trainerId: "chw002_00_urbain",
      pokemonId: "pmw154_00_meganium",
      trainerName: "Urbain",
      pokemonName: "Meganium",
      trainerNameZh: "蓋伊",
      pokemonNameZh: "大竺葵",
      type: "grass",
      region: "Kalos",
      group: null,
      basePotential: 5,
      role: "strike",
      roleAsset: "ROLE_001S",
      exRole: "ROLE_004",
      hasExRole: true,
      change: "MEGA",
      forms: [
        { index: 0, id: "base", kind: "BASE" },
        { index: 1, id: "mega", kind: "MEGA" },
      ],
      moveTypes: ["grass"],
      hasSixEx: true,
      hasAwakening: true,
      hasExStyle: true,
      exStyleImagePath: "/reference/trainer-ex/chw002_00_urbain_ex.png",
      manualSource: "wiki",
    },
    images: {
      trainer:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/d/d3/Urbain.png/revision/latest?cb=20260803024134",
      trainerEx:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/f/fa/UrbainEX.png/revision/latest?cb=20260803024139",
      pokemon:
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/154.png",
    },
  },
  {
    record: {
      pairId: "wiki-raifort-gengar",
      trainerId: "chw003_00_raifort",
      pokemonId: "pmw094_00_gengar",
      trainerName: "Raifort",
      pokemonName: "Gengar",
      trainerNameZh: "蕾荷",
      pokemonNameZh: "耿鬼",
      type: "ghost",
      region: "Paldea",
      group: null,
      basePotential: 5,
      role: "support",
      roleAsset: "ROLE_002",
      exRole: "ROLE_016",
      hasExRole: true,
      change: "NONE",
      forms: [{ index: 0, id: "base", kind: "BASE" }],
      moveTypes: ["ghost"],
      hasSixEx: true,
      hasAwakening: true,
      hasExStyle: true,
      exStyleImagePath: "/reference/trainer-ex/chw003_00_raifort_ex.png",
      manualSource: "wiki",
    },
    images: {
      trainer:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/5/52/Raifort.png/revision/latest",
      trainerEx:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/3/3a/RaifortEX.png/revision/latest",
      pokemon:
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png",
    },
  },
  {
    record: {
      pairId: "wiki-sabi-rhyperior",
      trainerId: "chw004_00_sabi",
      pokemonId: "pmw464_00_rhyperior",
      trainerName: "Sabi",
      pokemonName: "Rhyperior",
      trainerNameZh: "山葵",
      pokemonNameZh: "超甲狂犀",
      type: "ground",
      region: "Sinnoh",
      group: null,
      basePotential: 5,
      role: "tech",
      roleAsset: "ROLE_004",
      exRole: "ROLE_001P",
      hasExRole: true,
      change: "NONE",
      forms: [{ index: 0, id: "base", kind: "BASE" }],
      moveTypes: ["ground"],
      hasSixEx: true,
      hasAwakening: true,
      hasExStyle: true,
      exStyleImagePath: "/reference/trainer-ex/chw004_00_sabi_ex.png",
      manualSource: "wiki",
    },
    images: {
      trainer:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/a/a1/Sabi.png/revision/latest",
      trainerEx:
        "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/8/82/SabiEX.png/revision/latest",
      pokemon:
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/464.png",
    },
  },
];

import { toTrainer128 } from "./lib-trainer-image.mjs";

async function download(url, useOriginal) {
  const res = await fetch(useOriginal ? orig(url) : url, WIKI_UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

// ── stub 補名 (brybry i18n 缺寶可夢名) ──
let stubFixed = 0;
for (const rec of catalog.records) {
  const fix = STUB_FIXES[rec.pairId];
  if (fix && (!rec.pokemonName || !rec.pokemonNameZh)) {
    Object.assign(rec, fix);
    stubFixed++;
    console.log(`stub 補名: ${rec.trainerNameZh ?? rec.trainerName} & ${fix.pokemonNameZh}`);
  }
}
const norm = (s) => (s ?? "").toLowerCase().replace(/[\s'’.&-]+/g, "");
const brybryKeys = new Set(
  catalog.records
    .filter((r) => r.manualSource !== "wiki")
    .map((r) => `${norm(r.trainerName)}|${norm(r.pokemonName)}`)
);

let added = 0;
let yielded = 0;
for (const { record, images } of PAIRS) {
  const key = `${norm(record.trainerName)}|${norm(record.pokemonName)}`;
  // brybry 已收錄 → 移除手動紀錄讓位 (真資料有正確 actorId/圖/形態)
  if (brybryKeys.has(key)) {
    const before = catalog.records.length;
    catalog.records = catalog.records.filter((r) => r.pairId !== record.pairId);
    if (catalog.records.length < before)
      console.log(`brybry 已收錄 ${record.trainerName} & ${record.pokemonName} → 移除手動紀錄`);
    yielded++;
    continue;
  }
  // 圖 (存在就不重抓)
  const tPath = pub("reference", "trainer", `${record.trainerId}_128.png`);
  const tExPath = pub("reference", "trainer-ex", `${record.trainerId}_ex.png`);
  const pPath = pub("reference", "pokemon", `${record.pokemonId}_128.png`);
  if (!existsSync(tPath)) writeFileSync(tPath, await toTrainer128(await download(images.trainer, true)));
  if (!existsSync(tExPath)) writeFileSync(tExPath, await toTrainer128(await download(images.trainerEx, true)));
  if (!existsSync(pPath)) {
    const art = await download(images.pokemon, false);
    writeFileSync(
      pPath,
      await sharp(art)
        .trim({ threshold: 8 })
        .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    );
  }
  // 紀錄 upsert (以 pairId 為準)
  const idx = catalog.records.findIndex((r) => r.pairId === record.pairId);
  if (idx >= 0) catalog.records[idx] = { ...catalog.records[idx], ...record };
  else catalog.records.push(record);
  added++;
  console.log(`已收錄: ${record.trainerNameZh} (${record.trainerName}) & ${record.pokemonNameZh}`);
}

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}
`);
console.log(
  `完成: 手動補 ${added} 筆, stub 補名 ${stubFixed} 筆, 讓位 ${yielded} 筆, catalog 共 ${catalog.records.length} 筆`
);
