#!/usr/bin/env node
/**
 * 多來源 sync-pair 資料「校正/交叉驗證機制」(可擴充)。
 *
 * 設計理念 (使用者需求):
 *   - 我們維護自己的 DB + 自己的 id (brybry actor-id), 不被任一外站綁死。
 *   - 各外站更新有先後、且有的只有文字沒圖 → 需要「多站比對」: 任一站有 = 拍組真實 (union),
 *     越多站確認信心越高; 欄位以可靠度高的站為主、其餘交叉驗證並標出歧異。
 *   - 隨遊戲更新可重跑: 新拍組會以 candidate-new 浮現; 旗標變化以 discrepancy 浮現。
 *   - **加新來源 = 在 SOURCES 陣列加一個 adapter** (見下方註解)。
 *
 * 輸出: 更新 src/data/pomatools-pairs.json (原地修補, 加驗證/旗標欄位) + src/data/db-reconcile-report.md
 * 用法: node scripts/reconcile-db.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(repoRoot, "src", "data");
const pubDir = join(repoRoot, "public");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ── 配對工具 (跨站名稱差異容忍) ──────────────────────────────────────────
const norm = (s) => (s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/&eacute;/g, "e").replace(/\s+/g, " ").trim();
const FORM_NOISE = new Set(["mega", "primal", "tera", "dynamax", "gmax"]);
const pokeWords = (s) =>
  new Set(norm(s).replace(/\([^)]*\)/g, " ").replace(/[★☆♂♀:]/g, " ").trim().split(/\s+/).filter((w) => w && !FORM_NOISE.has(w)));
const pokeMatch = (aw, b) => {
  const bw = pokeWords(b); if (!aw.size || !bw.size) return false;
  const sub = (x, y) => [...x].every((w) => y.has(w));
  return sub(aw, bw) || sub(bw, aw);
};
// 別名: 我們用 brybry 本名, 外站用變身名 (依寶可夢確認唯一)
const ALIASES = {
  "kukui|incineroar": "The Masked Royal", "sabrina|swoobat": "Bellelba",
  "brycen|zoroark": "Brycen-Man", "clavell|amoonguss": "Clive",
};
const aliasOf = (t, p) => ALIASES[`${norm(t)}|${[...pokeWords(p)][0] ?? ""}`];

/**
 * 訓練家層級的別名 (與 ALIASES 不同: 那個是「某個拍組的變身名」, 這個是同一個人在不同站的叫法)。
 * 主角拍組: datamine/pomatools 叫 "Player", fandom wiki 叫 "Main Character" —— 少了這條,
 * 11 筆主角拍組永遠拿不到 wiki 驗證, 而且會整批出現在「候選新拍組」清單裡當雜訊;
 * 2026-09 真的漏收「主角 & 毒貝比」時, 它就是被那 10 筆雜訊夾在中間而沒被發現的。
 */
const TRAINER_ALIASES = { player: ["main character"] };

// 來源資料 → 依訓練家分組的索引; 查詢時做寶可夢字詞子集比對 (loose=去訓練家括號, 給只用本名的站)
function indexRows(rows) {
  const m = new Map();
  for (const r of rows) { const k = norm(r.trainer); (m.get(k) ?? m.set(k, []).get(k)).push(r); }
  return m;
}
function findRow(idx, trainer, pokemon, { loose = false } = {}) {
  const keys = [norm(trainer)];
  if (loose) keys.push(norm(trainer).replace(/\s*\([^)]*\)/g, "").trim());
  const al = aliasOf(trainer, pokemon); if (al) keys.push(norm(al));
  for (const a of TRAINER_ALIASES[norm(trainer)] ?? []) keys.push(a);
  const aw = pokeWords(pokemon);
  for (const k of keys) { const cands = idx.get(k); if (cands) { const hit = cands.find((c) => pokeMatch(aw, c.pokemon)); if (hit) return hit; } }
  return null;
}

const curl = (url) => execFileSync("curl", ["-sSL", "--max-time", "45", "-A", UA, url], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

// ── 來源註冊表 (SOURCES) — 加新站只要 push 一個 { name, weight, kind, fetch } ──────
// fetch() → [{ trainer, pokemon, fields:{...} }]; weight 高=可靠 (欄位合併優先); loose=只給本名
const TYPE_IDX = ["", "normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];

const SOURCES = [
  {
    name: "pomatools", weight: 3, roster: true, // datamine JSON — 機制欄位最可靠
    async fetch() {
      const [pairs, en] = await Promise.all([
        (await fetch("https://pomatools.github.io/assets/data/pairs.json")).json(),
        (await fetch("https://pomatools.github.io/assets/i18n/en.json")).json(),
      ]);
      const { CHAR, PKMN, THEMES = {} } = en.DATA;
      const rows = [];
      for (const p of pairs) {
        const t = CHAR[p.trainerId], pid = p.pokemon?.[0]?.id; if (!t || !pid) continue;
        let region = null, group = null;
        for (const c of p.themes ?? []) { if (Math.floor(c / 10000) === 2002) region = THEMES[String(c)] ?? region; if (Math.floor(c / 10000) === 2003) group = THEMES[String(c)] ?? group; }
        const forms = (p.pokemon ?? []).map((pk, index) => ({ index, id: pk.id, kind: pk.kind, weak: pk.weak,
          formType: (pk.kind || "").startsWith("TERA_") ? TYPE_IDX[parseInt(pk.kind.slice(5), 10)] ?? null : null }));
        rows.push({ trainer: t, pokemon: PKMN[pid] ?? "", fields: {
          change: p.change ?? "NONE", forms, tera: p.change === "TERA" || (p.pokemon ?? []).some((x) => (x.kind || "").startsWith("TERA")),
          hasAwakening: (p.dateAwakening ?? 0) > 0, hasSixEx: (p.date6ex ?? 0) > 0, hasExRole: (p.dateExRole ?? 0) > 0,
          region, group, acquisition: p.acquisition ?? null } });
      }
      return rows;
    },
  },
  {
    name: "wiki", weight: 2, roster: true, // fandom masters-ex (已抓於本地 wiki-ex-style.json)
    async fetch() {
      const w = JSON.parse(readFileSync(join(dataDir, "wiki-ex-style.json"), "utf8"));
      return w.roster.map((r) => ({ trainer: r.trainer, pokemon: r.pokemon, fields: {
        hasSixEx: !!r.hasSixEx, hasExStyle: !!r.hasExStyle, hasExRole: !!r.exRoleConfirmed } }));
    },
  },
  {
    name: "serebii", weight: 1, loose: true, // 專頁 (只用本名) — 太晶化/超覺醒/6★EX 獨立確認
    async fetch() {
      const page = (slug) => {
        try {
          const alts = [...curl(`https://www.serebii.net/pokemonmasters/${slug}.shtml`).matchAll(/alt="([^"]+)"/g)]
            .map((m) => m[1]).filter((a) => a && !/serebii|header|^icon$|top of page|image|^type|logo|^ex |star$/i.test(a));
          const rows = []; for (let i = 0; i + 1 < alts.length; i += 2) rows.push({ trainer: alts[i], pokemon: alts[i + 1] });
          return rows;
        } catch { return []; }
      };
      const tag = (rows, f) => rows.map((r) => ({ ...r, fields: f }));
      return [
        ...tag(page("syncterastallization"), { tera: true }),
        ...tag(page("superawakening"), { hasAwakening: true }),
        ...tag(page("exstar"), { hasSixEx: true }),
      ];
    },
  },
  // ── 加第 4、5 個來源範例 (有就 push): ─────────────────────────────────
  // { name:"bulbapedia", weight:2, async fetch(){ /* 解析 List_of_sync_pairs → rows */ } },
  // { name:"game8",      weight:1, async fetch(){ ... } },
];

// ── 引擎: 抓所有來源 → 比對我們的 DB → 合併欄位 + 標旗標 + 找缺漏 ────────────
// hasAwakening 不在 FILL 裡: datamine 的 TrainerSpecialAwaking 才是權威 (scrape-brybry 已寫入),
// pomatools 的 dateAwakening 會落後, 讓它覆寫等於把新拍組的超覺醒洗成 false (杜若 & 鋁鋼橋龍前科)。
const FILL_FIELDS = ["change", "forms", "tera", "region", "group", "acquisition"];
const FLAG_FIELDS = ["tera", "hasAwakening", "hasSixEx", "hasExRole"]; // 跨站確認/歧異追蹤

const file = JSON.parse(readFileSync(join(dataDir, "pomatools-pairs.json"), "utf8"));
const records = file.records;

console.log(`抓 ${SOURCES.length} 個來源...`);
const fetched = [];
for (const s of SOURCES) {
  try { const rows = await s.fetch(); fetched.push({ ...s, idx: indexRows(rows), rows }); console.log(`  ${s.name}: ${rows.length} rows`); }
  catch (e) { console.warn(`  ${s.name} 失敗: ${e.message}`); fetched.push({ ...s, idx: new Map(), rows: [] }); }
}
const byWeight = [...fetched].sort((a, b) => b.weight - a.weight);

let noImg = 0, impurity = 0, sharedKitN = 0;
const impurities = [], discrepant = [];
const matchedSourceKeys = fetched.map(() => new Set()); // 記哪些來源 row 對上了 (找缺漏用)

for (const rec of records) {
  const hits = byWeight.map((s) => {
    const row = findRow(s.idx, rec.trainerName, rec.pokemonName, { loose: s.loose });
    if (row) matchedSourceKeys[fetched.indexOf(fetched.find((f) => f.name === s.name))].add(`${norm(row.trainer)}|${norm(row.pokemon)}`);
    return { name: s.name, weight: s.weight, fields: row?.fields ?? null };
  });
  rec.verifiedSources = hits.filter((h) => h.fields).map((h) => h.name);

  // 合併: 每個欄位取「最高權重且有值」的來源
  for (const f of FILL_FIELDS) {
    for (const h of hits) { if (h.fields && h.fields[f] !== undefined && h.fields[f] !== null) { rec[f] = h.fields[f]; break; } }
  }
  // 跨站確認數 + 歧異 (布林旗標)
  rec.confirm = {};
  for (const f of FLAG_FIELDS) {
    const votes = hits.filter((h) => h.fields && h.fields[f] !== undefined).map((h) => ({ name: h.name, v: !!h.fields[f] }));
    if (!votes.length) continue;
    const yes = votes.filter((v) => v.v), no = votes.filter((v) => !v.v);
    if (yes.length) rec.confirm[f] = yes.map((v) => v.name); // 哪些站確認為 true
    if (yes.length && no.length) discrepant.push(`${rec.trainerName} & ${rec.pokemonName} — ${f}: 是[${yes.map((v) => v.name)}] 否[${no.map((v) => v.name)}]`);
  }
  rec.tera = rec.tera ?? false;

  const tImg = rec.trainerImagePath ? existsSync(join(pubDir, rec.trainerImagePath.replace(/^\//, ""))) : false;
  const pImg = rec.pokemonImagePath ? existsSync(join(pubDir, rec.pokemonImagePath.replace(/^\//, ""))) : false;
  rec.imageAvailable = tImg && pImg; if (!rec.imageAvailable) noImg++;
  rec.sharedKit = String(rec.pairId).startsWith("19999"); if (rec.sharedKit) sharedKitN++;

  if (rec.verifiedSources.length === 0 && !rec.sharedKit) { rec.suspectImpurity = true; impurity++; impurities.push(`${rec.trainerName} & ${rec.pokemonName} (${rec.pairId})`); }
  else delete rec.suspectImpurity;
}

// union: 「名冊型」來源有、但我們對不上的 row → 候選新拍組 (隨遊戲更新補)。
// 只看 roster 來源 (serebii 等專頁是「確認型」子集, 不納入 union 以免噪音)。
const candidateNew = new Map();
fetched.forEach((s, i) => {
  if (!s.roster) return;
  for (const r of s.rows) {
    const key = `${norm(r.trainer)}|${norm(r.pokemon)}`;
    if (matchedSourceKeys[i].has(key)) continue;
    const e = candidateNew.get(key) ?? { trainer: r.trainer, pokemon: r.pokemon, sources: new Set() };
    e.sources.add(s.name); candidateNew.set(key, e);
  }
});
// 只留「不在我們 DB」的 (用寬鬆比對排除已對上的同義)
const ourIdx = indexRows(records.map((r) => ({ trainer: r.trainerName, pokemon: r.pokemonName })));
const trulyNew = [...candidateNew.values()].filter((c) => !findRow(ourIdx, c.trainer, c.pokemon, { loose: true }));

// 縮排寫回 — catalog 進 git, 壓成一行的話任何改動都是「整檔重寫」, 沒辦法 review
writeFileSync(join(dataDir, "pomatools-pairs.json"), `${JSON.stringify(file, null, 2)}
`);

const tera = records.filter((r) => r.tera).length, awa = records.filter((r) => r.hasAwakening).length;
const v1 = records.filter((r) => r.verifiedSources.length).length;
console.log(`\n本地 ${records.length} 筆 — ${SOURCES.length} 站交叉:`);
for (const s of fetched) console.log(`  ${s.name}: 驗證 ${records.filter((r) => r.verifiedSources.includes(s.name)).length}`);
console.log(`  至少一來源驗證: ${v1} | 多來源(≥2): ${records.filter((r) => r.verifiedSources.length >= 2).length}`);
console.log(`  太晶化 ${tera} | 超覺醒 ${awa} | 有圖 ${records.length - noImg}/缺圖 ${noImg} | sharedKit ${sharedKitN}`);
console.log(`  欄位歧異 (跨站不一致): ${discrepant.length}`);
console.log(`  疑似雜質: ${impurity}`, impurities);
console.log(`  候選新拍組 (來源有/我們無): ${trulyNew.length}`);

// ── 報告 ──
const L = [`# 多來源資料校正/交叉驗證報告`, "",
  `> 我們自己的 DB 原地修補; 來源(可擴充): ${SOURCES.map((s) => s.name).join(", ")}。${new Date().toISOString()}`, "",
  `| 項目 | 值 |`, `| --- | ---: |`, `| 本地拍組 | ${records.length} |`,
  ...fetched.map((s) => `| ${s.name} 驗證 | ${records.filter((r) => r.verifiedSources.includes(s.name)).length} |`),
  `| 至少一來源驗證 | ${v1} |`, `| 多來源 (≥2) 驗證 | ${records.filter((r) => r.verifiedSources.length >= 2).length} |`,
  `| 太晶化 / 超覺醒 | ${tera} / ${awa} |`, `| 有圖 / 缺圖 | ${records.length - noImg} / ${noImg} |`,
  `| sharedKit | ${sharedKitN} |`, `| 欄位歧異 | ${discrepant.length} |`, `| 疑似雜質 | ${impurity} |`,
  `| 候選新拍組 (待補) | ${trulyNew.length} |`, "",
  `## 疑似雜質 (三來源皆查無)`, "", ...impurities.map((s) => `- ${s}`), "",
  `## 欄位歧異 (跨站不一致, 待確認)`, "", ...discrepant.slice(0, 60).map((s) => `- ${s}`), "",
  `## 候選新拍組 (某來源有、我們 DB 無 — 遊戲更新時補)`, "",
  ...trulyNew.map((c) => `- ${c.trainer} & ${c.pokemon}  [來源: ${[...c.sources].join(",")}]`), "",
  `## 缺圖 ${noImg} 筆`, "", ...records.filter((r) => !r.imageAvailable).map((r) => `- ${r.trainerName} & ${r.pokemonName}`), ""];
writeFileSync(join(dataDir, "db-reconcile-report.md"), L.join("\n"));
console.log(`\n報告 → src/data/db-reconcile-report.md`);
