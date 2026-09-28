// 上游 (pomasters/SyncPairsTracker) 的篩選面向 → 我們的 catalog。
//
// 抄的是**資料**不是畫面: 弱點、主題、標籤、招式屬性四樣, 我方原本沒有 (或不可靠)。
//   - weakType  : 我方 forms[].weak 只有 TYPE_0NN 且不是每筆都有 → 直接用上游的
//   - themes    : 角色/造型/身分 (冠軍、道館館主、眼鏡、美極套裝…)
//   - tags      : 戰鬥機制與寶可夢分類 (天候、場地、屬性抵抗、傳說、御三家…)
//   - moveTypes : 我方那份**其實只是拍組自己的屬性** (658 筆全是單一值 = type),
//                 上游的 MoveType* 標籤才是真的招式屬性 → 覆寫
//
// join 走 official-card-map.json 的 entries (已經是 654/654 零歧義的對照),
// 用 files 裡的檔名回頭找上游那一筆 —— 不要再寫第二套名稱比對。
//
// 冪等: 重跑結果一樣。上游出現沒見過的 themes/tags 時**印出來**,
// 由 tests/pair-facets.test.ts 擋住「沒有繁中名就上線」(使用者會看到英文)。
//
// 用法: node scripts/patch-upstream-facets.mjs

import fs from "node:fs";

const CATALOG = "src/data/pomatools-pairs.json";
const UPSTREAM = "src/data/pomasters/syncpairs.json";
const MAP = "src/data/official-card-map.json";

/** 上游的標籤裡混了「取得管道」與追蹤器自己的統計旗標 —— 那些我們已經有或不需要 */
const DROP_TAGS = new Set([
  // 與 series / acquisitions 重複 (同一件事兩個篩選器 = 使用者不知道該點哪個)
  "Limited", "Anniversary", "Summer", "Holiday", "New Year", "Fall", "Palentine",
  "Main Story: PML Arc", "Ticket Scout (after Victory Road)",
  "Log-in from February 14 to March 16, 2020 and from August 28, 2020 indefinitely",
  // 追蹤器自己的統計 (這位訓練家有幾組拍組之類), 不是拍組的性質
  "Multiple Units", "Multiple Pokemon", "Multiple Pairs", "First Unit",
  // 點播機的樂曲鑰匙 —— 那是音樂收藏, 與道館戰無關 (2026-09-10 使用者:「這個系統用不到」)
  "Song Key",
  // 空值
  "MoveType",
]);

/** 上游把幾個「章節/活動」放在 tags, 但那比較像主題 → 併進 themes */
const TAG_AS_THEME = new Set([
  "Villain Arc", "Neo Champion", "Legendary Adventures", "Academy Sync Pair",
  "Hisui", "Lumiose City",
]);

/** themes 裡與既有面向重複的 (屬性 / 地區) —— 那兩個面向已經有 chips 了 */
const TYPE_THEMES = new Set([
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison",
  "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy",
]);

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const upstream = JSON.parse(fs.readFileSync(UPSTREAM, "utf8")).SYNCPAIRS;
const map = JSON.parse(fs.readFileSync(MAP, "utf8"));

const REGION_THEMES = new Set(upstream.map((r) => r.syncPairRegion).filter(Boolean));

// 上游檔名 → 上游那一筆
const byFile = new Map();
for (const r of upstream) for (const f of r.images ?? []) byFile.set(f, r);

const recById = new Map(catalog.records.map((r) => [r.pairId, r]));
const seenThemes = new Set();
const seenTags = new Set();
let patched = 0;
let missed = 0;
/** 這一趟從上游補上架日 (標未確定) 的拍組 */
const datedFromUpstream = [];

for (const e of Object.values(map.entries)) {
  const file = Object.values(e.files ?? {})[0];
  const up = file ? byFile.get(file) : null;
  const rec = recById.get(e.pairId);
  if (!up || !rec) {
    missed += 1;
    continue;
  }

  const themes = [];
  const tags = [];
  const moveTypes = [];
  for (const t of up.themes ?? []) {
    if (TYPE_THEMES.has(t) || REGION_THEMES.has(t)) continue;
    const v = t === "Villain." ? "Villain" : t; // 上游有一筆多打了句點
    if (!themes.includes(v)) themes.push(v);
  }
  for (const t of up.tags ?? []) {
    if (DROP_TAGS.has(t)) continue;
    if (TAG_AS_THEME.has(t)) {
      if (!themes.includes(t)) themes.push(t);
      continue;
    }
    if (t.startsWith("MoveType") && t !== "MoveTypeStellar") {
      const mt = t.slice("MoveType".length).toLowerCase();
      if (mt && !moveTypes.includes(mt)) moveTypes.push(mt);
      continue;
    }
    if (!tags.includes(t)) tags.push(t);
  }
  themes.forEach((t) => seenThemes.add(t));
  tags.forEach((t) => seenTags.add(t));

  // 上架日: 我方所有來源 (pomatools / wiki / 登記簿) 都沒有時, 用上游的, 並標「未確定」
  // (2026-09-28 使用者:「還不確定的東西就標不確定就好, 以我們找資料的那些站為準」)。
  // 上游對**還沒上市**的拍組寫的日期與官方公告會差 1-4 天 (實測 v2.73.0 那一波), 所以一定要帶旗標;
  // 之後 pomatools / wiki 跟上、4c 寫進確定的日期時, 這裡就不會再碰它, 旗標自然消失
  // (stage 1 每次都從 brybry 重建 record, 不會殘留舊旗標)。
  if (!rec.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(String(up.releaseDate ?? ""))) {
    rec.releaseDate = up.releaseDate;
    rec.releaseDateUncertain = true;
    datedFromUpstream.push(`${rec.pairId} ${rec.trainerNameZh ?? rec.trainerName} & ${rec.pokemonNameZh ?? rec.pokemonName} → ${up.releaseDate}`);
  }

  rec.weakType = String(up.pokemonWeak ?? "").toLowerCase() || null;
  rec.themes = themes.sort();
  rec.tags = tags.sort();
  // 上游一個 MoveType 標籤都沒有時保留舊值 (至少還有拍組自己的屬性)
  if (moveTypes.length > 0) rec.moveTypes = moveTypes.sort();
  patched += 1;
}

fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
console.log(`已寫入 ${patched} 筆 (對不到上游: ${missed})`);
if (datedFromUpstream.length) {
  console.log(`上架日取自上游、標「未確定」 ${datedFromUpstream.length} 筆:`);
  for (const s of datedFromUpstream) console.log(`  ${s}`);
}
console.log(`themes ${seenThemes.size} 種 / tags ${seenTags.size} 種`);
console.log("themes:", [...seenThemes].sort().join(" | "));
console.log("tags:", [...seenTags].sort().join(" | "));
