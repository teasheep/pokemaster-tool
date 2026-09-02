#!/usr/bin/env node
/**
 * 從 ref/ 的兩份計算彙整 Excel 抽出「拍組權重表」→ ref/gym-weights.json
 *
 * 用法 (xlsx 要先解壓成目錄, xlsx 即 zip):
 *   Copy-Item ref/1_計算彙整_打手.xlsx a.zip; Expand-Archive a.zip -Dest tmp/打手
 *   Copy-Item ref/2_計算彙整_降抗.xlsx b.zip; Expand-Archive b.zip -Dest tmp/降抗
 *   node scripts/extract-gym-weights.mjs tmp/打手 tmp/降抗
 *
 * 抽出的東西 (道館 Excel 的計算規則, 之後可用於 app 內即時重算):
 *   - 主打手 raw 分數 = Σ (持有數值 × 拍組權重), 依 36 類別 (18 屬性 × 物/特) 各有一組權重
 *     持有數值: 無持有=0, 寶N=N, 超覺醒=10
 *     顯示分數 = NORM.S.DIST(zscore(raw, 全館平均, 全館標準差)) × 100 (館內常模, 需動態重算)
 *   - 降抗值 = 持有(寶1以上) ? 拍組固定降層權重 : 0; 屬性總和配燈號 (上線版: >=9 綠, >=6 黃)
 *   - EX 領域: 每屬性指定的場域拍組, 持有(>0) 即算有
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const [attackerDir, debuffDir] = process.argv.slice(2);
if (!attackerDir || !debuffDir) {
  console.error("用法: node scripts/extract-gym-weights.mjs <打手解壓目錄> <降抗解壓目錄>");
  process.exit(1);
}

const dec = (s) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function loadWorkbook(dir) {
  const wb = readFileSync(join(dir, "xl", "workbook.xml"), "utf-8");
  const rels = readFileSync(join(dir, "xl", "_rels", "workbook.xml.rels"), "utf-8");
  const relMap = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  const sheets = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    sheets[dec(m[1])] = relMap[m[2]].replace(/^\/?(xl\/)?/, "");
  }
  let sst = [];
  const sstPath = join(dir, "xl", "sharedStrings.xml");
  if (existsSync(sstPath)) {
    const raw = readFileSync(sstPath, "utf-8");
    sst = [...raw.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
    );
  }
  return {
    sheet(name) {
      const xml = readFileSync(join(dir, "xl", sheets[name]), "utf-8");
      const cells = new Map();
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const [, ref, attrs, body] = m;
        const f = body.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1];
        let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) v = sst[Number(v)];
        cells.set(ref, { f: f ? dec(f) : null, v: v !== undefined ? dec(String(v)) : null });
      }
      return cells;
    },
  };
}

/** row1 的欄位標題: colLetter → header */
function headerRow(cells) {
  const out = {};
  for (const [ref, c] of cells) {
    const m = ref.match(/^([A-Z]+)1$/);
    if (m && c.v) out[m[1]] = c.v;
  }
  return out;
}

// ── 打手 ──
const atk = loadWorkbook(attackerDir);
const calcHeaders = headerRow(atk.sheet("計算檔"));
const aggCells = atk.sheet("打手彙整檔");
const aggHeaders = headerRow(aggCells);

const attackerWeights = {};
for (const [col, category] of Object.entries(aggHeaders)) {
  if (col === "A") continue;
  const f = aggCells.get(`${col}2`)?.f;
  if (!f) continue;
  const terms = [...f.matchAll(/計算檔!([A-Z]+)2\*([\d.]+)/g)].map((m) => ({
    pair: calcHeaders[m[1]] ?? `計算檔!${m[1]}`,
    weight: Number(m[2]),
  }));
  if (terms.length) attackerWeights[category] = terms;
}

// EX 領域: 每屬性哪些拍組算 (IF(計算檔!X2>0 ...) / OR(...))
// 屬性名從拍組欄位標題前綴取 ("火場域 [...]" → 火), row1 標題有缺 (一般欄) 不可靠
const exCells = atk.sheet("EX 領域名單彙整");
const exHeaders = headerRow(exCells);
const exFieldPairs = {};
for (const col of new Set([...Object.keys(exHeaders), "B"])) {
  if (col === "A") continue;
  const f = exCells.get(`${col}2`)?.f;
  if (!f) continue;
  const pairs = [...f.matchAll(/計算檔!([A-Z]+)2/g)].map((m) => calcHeaders[m[1]] ?? m[1]);
  if (pairs.length === 0) continue;
  const type = pairs[0].match(/^(.+?)場域/)?.[1] ?? exHeaders[col] ?? col;
  exFieldPairs[type] = pairs;
}

// ── 驗證 (打手): 重算 raw 分數對照 打手彙整檔 存值 ──
const calcValsAtk = (() => {
  const out = {};
  for (const [ref, c] of atk.sheet("計算檔")) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m || c.v === null || Number.isNaN(Number(c.v))) continue;
    (out[m[1]] ??= {})[m[2]] = Number(c.v);
  }
  return out;
})();
const calcColByHeaderAtk = Object.fromEntries(
  Object.entries(calcHeaders).map(([c, h]) => [h, c])
);
let atkChecked = 0, atkMismatch = 0;
for (const [col, category] of Object.entries(aggHeaders)) {
  if (col === "A" || !attackerWeights[category]) continue;
  for (let row = 2; row <= 21; row++) {
    const stored = aggCells.get(`${col}${row}`)?.v;
    if (stored === null || stored === undefined) continue;
    const calc = attackerWeights[category].reduce(
      (s, t) => s + (calcValsAtk[calcColByHeaderAtk[t.pair]]?.[row] ?? 0) * t.weight,
      0
    );
    atkChecked++;
    if (Math.abs(calc - Number(stored)) > 1e-6) atkMismatch++;
  }
}

// 常模參數位置紀錄 (值會隨資料變, 重算時應以當下全館資料計算)
const normNote =
  "顯示分數 = NORM.S.DIST((raw - mean) / stdev) * 100; mean/stdev 取自全館該類別 raw 分數 (打手彙整檔 第22/23列), 資料變動時需重算";

// ── 降抗 ──
// 公式有三種家族:
//   fixed:  IF(計算檔!X2>=1, w, 0)               → 持有 (寶1以上) 貢獻固定 w 層
//   tiered: IFS(計算檔!X2=5, w5, 計算檔!X2>=1, w1, TRUE, 0) → 寶5 貢獻 w5, 寶1-4 貢獻 w1
//   scaled: Form_Responses34[[#This Row],[<欄>]](/d)?        → 貢獻 = 寶數(/d), 跨屬性通用降抗手
const deb = loadWorkbook(debuffDir);
const debCalcHeaders = headerRow(deb.sheet("計算檔"));
const debCells = deb.sheet("降抗計算檔");
const debHeaders = headerRow(debCells);

// 結構化參照的跳脫: '[ → [ , '] → ]
const unescapeRef = (s) => s.replace(/'(\[|\])/g, "$1");

function parseDebuffFormula(f) {
  let m = f.match(/^IF\(計算檔!([A-Z]+)2>=1,\s*([\d.]+),\s*0\)$/);
  if (m) return { kind: "fixed", sourceCol: m[1], weight: Number(m[2]) };
  m = f.match(
    /IFS\(計算檔!([A-Z]+)2=5,\s*([\d.]+),\s*計算檔!\1\s*2\s*>=1,\s*([\d.]+),\s*TRUE,\s*0\)/
  );
  if (!m) {
    m = f.match(
      /IFS\(計算檔!([A-Z]+)2=5,\s*([\d.]+),\s*計算檔!\12>=1,\s*([\d.]+),\s*TRUE,\s*0\)/
    );
  }
  if (m) return { kind: "tiered", sourceCol: m[1], weightFull: Number(m[2]), weightPartial: Number(m[3]) };
  m = f.match(/^Form_Responses34\[\[#This Row\],\[(.+?)\]\](?:\/([\d.]+))?$/);
  if (m) return { kind: "scaled", sourceHeader: unescapeRef(m[1]), divisor: m[2] ? Number(m[2]) : 1 };
  return null;
}

function sheetValues(cells) {
  // colLetter → row → number
  const out = {};
  for (const [ref, c] of cells) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m || c.v === null || Number.isNaN(Number(c.v))) continue;
    (out[m[1]] ??= {})[m[2]] = Number(c.v);
  }
  return out;
}

const debCalcVals = sheetValues(deb.sheet("計算檔"));
const debVals = sheetValues(debCells);
const debCalcColByHeader = Object.fromEntries(
  Object.entries(debCalcHeaders).map(([c, h]) => [h, c])
);

// 匯出的公式有部分被 Google Sheets 轉檔弄壞 (結構化參照失去語意),
// 但儲存的「快取結果值」是對的 → 公式只拿來定位來源持有欄,
// 權重規則改由 (持有數值, 儲存值) 的 20 筆資料反推, 並以全量驗證把關。
const debuffWeights = [];
const debuffUnparsed = [];
for (const [col, skillKey] of Object.entries(debHeaders)) {
  if (col === "A" || !skillKey?.trim()) continue;
  const f = debCells.get(`${col}2`)?.f;
  if (!f) continue;
  const parsed = parseDebuffFormula(f);
  if (!parsed) {
    debuffUnparsed.push({ col, skillKey, formula: f });
    continue;
  }
  const sourceHeader = parsed.sourceCol
    ? (debCalcHeaders[parsed.sourceCol] ?? parsed.sourceCol)
    : parsed.sourceHeader;
  const srcCol = debCalcColByHeader[sourceHeader];

  // 觀察 20 位成員的 (持有數值 → 貢獻值)
  const byOwned = new Map(); // src → Set(stored)
  for (let row = 2; row <= 21; row++) {
    const stored = debVals[col]?.[row];
    if (stored === undefined) continue;
    const src = debCalcVals[srcCol]?.[row] ?? 0;
    if (!byOwned.has(src)) byOwned.set(src, new Set());
    byOwned.get(src).add(stored);
  }
  const ownedVals = new Set(
    [...byOwned.entries()].filter(([src]) => src >= 1).flatMap(([, set]) => [...set])
  );
  let entry;
  if (ownedVals.size <= 1) {
    // 持有者一律同值 → 固定權重 (沒人持有時退回公式權重)
    const w = ownedVals.size === 1 ? [...ownedVals][0] : (parsed.weight ?? 0);
    entry = { skillKey, col, kind: "fixed", sourceHeader, weight: w };
  } else {
    // 多種值 → 階層式: 寶5以上一組, 寶1-4 一組; 不成立就存原始對照表
    const full = new Set(
      [...byOwned.entries()].filter(([s]) => s >= 5).flatMap(([, set]) => [...set])
    );
    const partial = new Set(
      [...byOwned.entries()].filter(([s]) => s >= 1 && s < 5).flatMap(([, set]) => [...set])
    );
    if (full.size <= 1 && partial.size <= 1) {
      entry = {
        skillKey, col, kind: "tiered", sourceHeader,
        weightFull: [...full][0] ?? parsed.weightFull ?? 0,
        weightPartial: [...partial][0] ?? parsed.weightPartial ?? 0,
      };
    } else {
      entry = {
        skillKey, col, kind: "table", sourceHeader,
        mapping: Object.fromEntries([...byOwned.entries()].map(([s, set]) => [s, [...set][0]])),
      };
    }
  }
  debuffWeights.push(entry);
}

// ── 驗證: 用推出的規則重算每格, 對照 Excel 儲存值 ──
let debChecked = 0, debMismatch = 0;
for (const e of debuffWeights) {
  const srcCol = debCalcColByHeader[e.sourceHeader];
  for (let row = 2; row <= 21; row++) {
    const stored = debVals[e.col]?.[row];
    if (stored === undefined) continue;
    const src = debCalcVals[srcCol]?.[row] ?? 0;
    let calc;
    if (e.kind === "fixed") calc = src >= 1 ? e.weight : 0;
    else if (e.kind === "tiered") calc = src >= 5 ? e.weightFull : src >= 1 ? e.weightPartial : 0;
    else calc = e.mapping[src] ?? 0;
    debChecked++;
    if (Math.abs(calc - stored) > 1e-6) debMismatch++;
  }
}

const out = {
  _meta: {
    source: ["ref/1_計算彙整_打手.xlsx", "ref/2_計算彙整_降抗.xlsx"],
    extractedBy: "scripts/extract-gym-weights.mjs",
    note: "道館 Excel 的計算規則快照; 表單回覆為 Google Form, 欄位 = 拍組持有等級",
  },
  ownershipNumeric: { 無持有: 0, 寶1: 1, 寶2: 2, 寶3: 3, 寶4: 4, 寶5: 5, 超覺醒: 10 },
  attacker: {
    note: normNote,
    weights: attackerWeights, // 類別 → [{pair, weight}]
  },
  exFieldPairs, // 屬性 → 判定「有 EX 領域」的拍組
  debuff: {
    note:
      "kind=fixed: 持有(寶1以上)貢獻 weight 層; tiered: 寶5 貢獻 weightFull, 寶1-4 貢獻 weightPartial; " +
      "scaled: 貢獻 = 寶數/divisor (跨屬性通用降抗手, sourceHeader 指向原始持有欄)。" +
      "每屬性加總後配燈號 (上線版 >=9 綠 / >=6 黃; 初版曾用 >=14/>=9)",
    weights: debuffWeights,
  },
};

const outPath = join(repoRoot, "ref", "gym-weights.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(
  `已寫入 ${outPath}\n` +
    `  打手類別 ${Object.keys(attackerWeights).length} 組 (拍組項 ${Object.values(attackerWeights).reduce((s, a) => s + a.length, 0)})\n` +
    `  EX 領域屬性 ${Object.keys(exFieldPairs).length} 組\n` +
    `  降抗權重 ${debuffWeights.length} 筆 (未解析 ${debuffUnparsed.length} 欄)\n` +
    `  驗證 打手 raw 分數: ${atkChecked} 格, 不符 ${atkMismatch}\n` +
    `  驗證 降抗值: ${debChecked} 格, 不符 ${debMismatch}`
);
for (const u of debuffUnparsed) console.warn(`  ! 未解析: ${u.col} ${u.skillKey} → ${u.formula.slice(0, 100)}`);
if (atkMismatch > 0 || debMismatch > 0) {
  console.error("驗證有不符, 請檢查抽取規則");
  process.exit(1);
}
