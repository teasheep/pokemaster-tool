#!/usr/bin/env node
/**
 * 從 Pokémon Masters EX Wiki (fandom) 抓 EX style / 6★ EX / EX role 完整資料,
 * 並與既有 src/data/pomatools-pairs.json 交叉比對。
 *
 * 來源頁面 (用 ?action=raw 取 wikitext, 需帶瀏覽器 UA, 否則 403):
 *   - 6★ EX            : 兩個清單 — 「6★ EX 已解鎖」(含 EX style 標記) + 「EX role 已解鎖」
 *   - Sync Pairs/List  : 全 624 隻名冊 (Type/Trainer/Pokémon/Role/EX Role/Potential/Release)
 *
 * 輸出:
 *   src/data/wiki-ex-style.json  — 結構化 wiki 資料 + 與 pomatools 的比對結果
 *
 * 用法: node scripts/scrape-wiki-exstyle.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const WIKI = "https://pokemon-masters-ex-game.fandom.com/wiki";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Fandom 走 Cloudflare, Node undici fetch 會被 TLS 指紋擋 (403), 改用系統 curl。
function fetchRaw(pageTitle) {
  const url = `${WIKI}/${pageTitle}?action=raw`;
  return execFileSync(
    "curl",
    ["-sSL", "--fail", "-A", UA, url],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
}

/** 取兩個 section header 之間的內容 (含 startHeader 之後, 到 endHeader 之前) */
function sliceSection(text, startHeader, endHeader) {
  const start = text.indexOf(startHeader);
  if (start < 0) throw new Error(`找不到段落: ${startHeader}`);
  const from = start + startHeader.length;
  const end = endHeader ? text.indexOf(endHeader, from) : text.length;
  return text.slice(from, end < 0 ? text.length : end);
}

/** 拆出 wiki link 的 [[Page|Display]] / [[Page]] → { page, display } */
function parseLink(s) {
  const m = s.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  return { page: m[1].trim(), display: (m[2] ?? m[1]).trim() };
}

/** 名稱正規化, 給跨來源比對用 key */
function normName(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** pokemon 比對用: 去掉形態括號 (e.g. "Gastrodon (West Sea)" → "gastrodon") */
function basePokemon(s) {
  return normName((s ?? "").replace(/\s*\([^)]*\)\s*$/, ""));
}

// ── 1. 6★ EX 頁面: 兩個清單 ──────────────────────────────────────────────
function parseSixExLists(wikitext) {
  const H_SIXEX = "==List of Sync Pairs with 6★ EX Unlocked==";
  const H_EXROLE = "==List of Sync Pairs with an EX Role Unlocked==";

  // ── 清單 A: 6★ EX 已解鎖 (name / image / date) ──
  const secA = sliceSection(wikitext, H_SIXEX, H_EXROLE);
  const sixEx = [];
  const blocksA = secA.split(/^\|-\s*$/m);
  for (const block of blocksA) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let name = null;
    let hasExStyle = true;
    let image = null;
    let date = null;
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      const cell = line.slice(1);
      if (cell.startsWith("[[File:")) {
        const fm = cell.match(/\[\[File:([^|\]]+)/);
        if (fm) image = fm[1].trim();
      } else if (cell.startsWith("[[")) {
        const link = parseLink(cell);
        if (link) {
          name = link.page;
          hasExStyle = !/\]\]\s*\*/.test(cell); // 末尾 * = 無 EX style
        }
      } else if (/\d+\/\d+\/\d+/.test(cell)) {
        date = cell.replace(/data-sort-value="[^"]*"\|/, "").trim();
      }
    }
    if (name) sixEx.push({ page: name, hasExStyle, image, dateUnlocked: date });
  }

  // ── 清單 B: EX role 已解鎖 (name / role / exRole / date) ──
  const secB = sliceSection(wikitext, H_EXROLE, null);
  const exRole = [];
  const blocksB = secB.split(/^\|-\s*$/m);
  for (const block of blocksB) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    // 結束在表格 |} 之前
    const cells = [];
    let name = null;
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      const cell = line.slice(1).replace(/<\/?table-progress-tracking[^>]*>/g, "").trim();
      if (cell.startsWith("[[") && !cell.startsWith("[[File:")) {
        const link = parseLink(cell);
        if (link) name = link.page;
      } else if (cell && cell !== "}" && !cell.startsWith("[[Category")) {
        cells.push(cell.replace(/data-sort-value="[^"]*"\|/, "").trim());
      }
    }
    if (name && cells.length >= 3) {
      exRole.push({
        page: name,
        role: cells[0],
        exRole: cells[1],
        dateUnlocked: cells[2],
      });
    }
  }

  return { sixEx, exRole };
}

// ── 2. Sync Pairs/List: 全名冊 ───────────────────────────────────────────
function parsePotential(cell) {
  const filled = (cell.match(/★/g) || []).length;
  const empty = (cell.match(/☆/g) || []).length;
  return { filled, total: filled + empty, raw: `${"★".repeat(filled)}${"☆".repeat(empty)}` };
}

function parseRoster(wikitext) {
  // 主表在第一個 {|class="article-table sortable" 之後
  const tableStart = wikitext.indexOf('{|class="article-table sortable"');
  const body = wikitext.slice(tableStart);
  const blocks = body.split(/^\|-\s*$/m);
  const rows = [];
  for (const block of blocks) {
    const rawLines = block.split("\n");
    // 收集以 | 開頭的 cell (跳過 ! 表頭與表格控制行)
    const cells = [];
    for (const raw of rawLines) {
      const line = raw.trimEnd();
      if (!line.startsWith("|")) continue;
      if (line.startsWith("|}") || line.startsWith("|class") || line.startsWith("|+")) continue;
      cells.push(line.slice(1));
    }
    // 一列正常有 9 個 cell: No, Type, Trainer, Image, Pokémon, Role, EX Role, Potential, Release
    if (cells.length < 9) continue;

    const typeCell = cells[1];
    const typeMatch = typeCell.match(/\[\[File:([A-Za-z]+)\.png/);
    const type = typeMatch ? typeMatch[1] : null;

    // Trainer cell 可能有 data-row-id="x"| 前綴, 以及尾隨的 mark icon
    let trainerCell = cells[2].replace(/^data-row-id="[^"]*"\|/, "");
    const trainerLink = parseLink(trainerCell);
    const marks = [];
    if (/MasterSyncPairMark/.test(trainerCell)) marks.push("master");
    if (/SuperawakeningMark/.test(trainerCell)) marks.push("superawakening");
    if (/ArcSuit|ArcPairMark/.test(trainerCell)) marks.push("arc");

    // pokemon cell 可能含 <br> 分隔的形態 (e.g. "Charizard<br>Mega Charizard X")
    // 以及 buddy/max move 的 [[File:...|25px|link=...]] 圖示 — 要先整塊移除
    const pokemonParts = cells[4]
      .replace(/\[\[File:[^\]]*\]\]/gi, "") // 移除 File 圖示 (buddy/max move icon)
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[Link|Disp]] → Disp
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\b\d+px\b\|?link=\S*/gi, "") // 殘留的 "25px|link=..." 清掉
      .split(/<br\s*\/?>/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const pokemon = pokemonParts[0] ?? cells[4].trim();
    const pokemonForms = pokemonParts.slice(1);
    const role = cells[5].trim();
    const exRoleRaw = cells[6].trim();
    const potential = parsePotential(cells[7]);
    const release = cells[8].replace(/data-sort-value="[^"]*"\|/, "").trim();

    rows.push({
      no: cells[0].trim(),
      type,
      trainerPage: trainerLink?.page ?? null,
      trainer: trainerLink?.display ?? null,
      pokemon,
      pokemonForms,
      role,
      exRole: exRoleRaw || null,
      marks,
      potential,
      releaseDate: release,
    });
  }
  return rows;
}

// wiki 的別名角色 → pomatools 用本名 + 不同 trainerId 收錄, 手動對應。
// key = wiki trainerPage; value = { pokemon, idContains } 用來鎖定唯一 pomatools 紀錄。
const ALIAS_MAP = {
  "The Masked Royal": { pokemon: "Incineroar", idContains: "royalmask" }, // = Kukui
  "Brycen-Man": { pokemon: "Zoroark", idContains: "hachikuman" }, // = Brycen
  Bellelba: { pokemon: "Swoobat", idContains: "jujube" }, // pomatools EN 名缺失
  Clive: { pokemon: "Amoonguss", idContains: "nelke" }, // = Clavell
};

// ── 3. 與 pomatools 交叉比對 ─────────────────────────────────────────────
function crossReference(roster, sixEx, exRole, pomatools) {
  // wiki: page → ex-style / ex-role 資訊
  const sixExByPage = new Map(sixEx.map((e) => [normName(e.page), e]));
  const exRoleByPage = new Map(exRole.map((e) => [normName(e.page), e]));

  // 把 roster 跟 6EX/role 清單以 page 名 join (同一 wiki namespace, 可靠)
  const rosterEnriched = roster.map((r) => {
    const key = normName(r.trainerPage);
    const six = sixExByPage.get(key);
    const exr = exRoleByPage.get(key);
    return {
      ...r,
      hasSixEx: !!six,
      hasExStyle: six ? six.hasExStyle : false,
      sixExDate: six?.dateUnlocked ?? null,
      sixExImage: six?.image ?? null,
      exRoleConfirmed: exr ? exr.exRole : null,
      exRoleDate: exr?.dateUnlocked ?? null,
    };
  });

  // pomatools: 建 (trainer|basePokemon) pair key + (trainer)→[records] multimap
  const pomaByPair = new Map();
  const pomaByTrainer = new Map();
  for (const p of pomatools) {
    pomaByPair.set(`${normName(p.trainerName)}|${basePokemon(p.pokemonName)}`, p);
    const t = normName(p.trainerName);
    if (!pomaByTrainer.has(t)) pomaByTrainer.set(t, []);
    pomaByTrainer.get(t).push(p);
  }
  // 已被 pair-key 對上的 pomatools, 避免 trainer-fallback 重複指派
  const claimed = new Set();

  // 第一輪: 精準 (trainer|basePokemon) pair-key 比對
  for (const r of rosterEnriched) {
    const p = pomaByPair.get(`${normName(r.trainer)}|${basePokemon(r.pokemon)}`);
    if (p) {
      r._poma = p;
      claimed.add(p.pairId);
    }
  }

  let matched = 0;
  const protagonist = [];
  const unmatchedWiki = [];
  for (const r of rosterEnriched) {
    let p = r._poma;
    // trainer-only fallback: 該 trainer 還有「未被認領」的紀錄時才用 (避免 variant 互撞)
    if (!p) {
      const cands = (pomaByTrainer.get(normName(r.trainer)) ??
        pomaByTrainer.get(normName(r.trainerPage)) ??
        []).filter((x) => !claimed.has(x.pairId));
      if (cands.length >= 1) {
        p = cands[0];
        claimed.add(p.pairId);
      }
    }
    // 別名角色
    if (!p && ALIAS_MAP[r.trainerPage]) {
      const { pokemon, idContains } = ALIAS_MAP[r.trainerPage];
      p = pomatools.find(
        (x) => x.pokemonName === pokemon && x.trainerId.includes(idContains)
      );
    }
    if (p) {
      matched++;
      r.pomaPairId = p.pairId;
      r.pomaTrainerId = p.trainerId;
      r.alias = ALIAS_MAP[r.trainerPage] ? p.trainerName : undefined;
    } else {
      r.pomaPairId = null;
      // 主角拍組 (Main Character and X) — pomatools 不收錄, 另計
      if (/^Main Character and /.test(r.trainerPage ?? "")) {
        r.protagonist = true;
        protagonist.push({ pokemon: r.pokemon, page: r.trainerPage });
      } else {
        unmatchedWiki.push({ trainer: r.trainer, pokemon: r.pokemon, page: r.trainerPage });
      }
    }
  }

  for (const r of rosterEnriched) delete r._poma; // 清掉暫存參照, 避免序列化膨脹
  return { rosterEnriched, matched, protagonist, unmatchedWiki };
}

async function main() {
  console.log("抓 6★ EX 頁面...");
  const sixExWikitext = await fetchRaw("6%E2%98%85_EX");
  console.log("抓 Sync Pairs/List 頁面...");
  const listWikitext = await fetchRaw("Sync_Pairs/List");

  const { sixEx, exRole } = parseSixExLists(sixExWikitext);
  const roster = parseRoster(listWikitext);

  console.log(`\n解析結果:`);
  console.log(`  名冊 (roster)      : ${roster.length} 隻`);
  console.log(`  6★ EX 已解鎖       : ${sixEx.length} 隻`);
  console.log(`    └ 有 EX style    : ${sixEx.filter((e) => e.hasExStyle).length} 隻`);
  console.log(`    └ 無 EX style (*): ${sixEx.filter((e) => !e.hasExStyle).length} 隻`);
  console.log(`  EX role 已解鎖     : ${exRole.length} 隻`);

  // 載入 pomatools
  const pomaPath = join(repoRoot, "src", "data", "pomatools-pairs.json");
  const poma = JSON.parse(readFileSync(pomaPath, "utf8")).records;
  console.log(`  pomatools 既有     : ${poma.length} 隻 (hasSixEx=${poma.filter((p) => p.hasSixEx).length}, hasExRole=${poma.filter((p) => p.hasExRole).length})`);

  const { rosterEnriched, matched, protagonist, unmatchedWiki } = crossReference(
    roster,
    sixEx,
    exRole,
    poma
  );

  console.log(`\n比對 (wiki roster ↔ pomatools):`);
  console.log(`  成功對上              : ${matched}/${roster.length}`);
  console.log(`  主角拍組 (不在 pomatools): ${protagonist.length}`);
  console.log(`  其他對不上            : ${unmatchedWiki.length}`);
  if (unmatchedWiki.length) {
    for (const u of unmatchedWiki) {
      console.log(`    - ${u.trainer} & ${u.pokemon}  [page: ${u.page}]`);
    }
  }

  // pomatools 既有 EX 標記 vs wiki 實況 (只看有對上的)
  const matchedRows = rosterEnriched.filter((r) => r.pomaPairId);
  const pomaById = new Map(poma.map((p) => [p.pairId, p]));
  let sixExGap = 0;
  let exRoleGap = 0;
  for (const r of matchedRows) {
    const p = pomaById.get(r.pomaPairId);
    if (r.hasSixEx && !p.hasSixEx) sixExGap++;
    if (r.exRoleConfirmed && !p.hasExRole) exRoleGap++;
  }
  console.log(`\n資料缺口 (wiki 有 / pomatools 漏標, 限有對上者):`);
  console.log(`  6★ EX  : pomatools 漏 ${sixExGap} 隻`);
  console.log(`  EX role: pomatools 漏 ${exRoleGap} 隻`);

  const out = {
    source: "https://pokemon-masters-ex-game.fandom.com/wiki/6★_EX + /Sync_Pairs/List",
    generatedAt: new Date().toISOString(),
    counts: {
      roster: roster.length,
      sixEx: sixEx.length,
      withExStyle: sixEx.filter((e) => e.hasExStyle).length,
      withoutExStyle: sixEx.filter((e) => !e.hasExStyle).length,
      exRole: exRole.length,
      matchedToPomatools: matched,
      protagonistPairs: protagonist.length,
      unmatched: unmatchedWiki.length,
    },
    sixEx,
    exRole,
    roster: rosterEnriched,
  };

  const outPath = join(repoRoot, "src", "data", "wiki-ex-style.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n寫入 → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
