#!/usr/bin/env node
/**
 * 從 pomatools 補 catalog 的中繼資料 (可重複執行, 冪等):
 *   releaseDate — 上架日期 (date unix)
 *   pairKind    — 卡面徽章 master/exmaster/arc (main.js 邏輯 28e5<r<2903e3)
 *   series      — 系列標籤 (每拍組唯一): 徽章優先, 否則 acquisition bitmask
 *                 由特異性高到低取一個 (官方 zh: 群星盛典/大師盛典/繁星限定/季節...)
 *
 * 名稱對照: trainer EN + pokemon EN; pomatools 寶可夢名帶形態後綴
 * (例 "Lycanroc (Midday Form)") — 以「去括號」做 fallback key。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, "..", "src", "data", "pomatools-pairs.json");

const BASE = "https://pomatools.github.io";
const pairsRaw = await (await fetch(`${BASE}/assets/data/pairs.json`)).json();
const i18n = await (await fetch(`${BASE}/assets/i18n/en.json`)).json();
const CHAR = i18n.DATA?.CHAR ?? {};
const PKMN = i18n.DATA?.PKMN ?? {};

const norm = (s) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s'’.&-]+/g, "");
const stripForm = (s) => (s ?? "").replace(/\s*\([^)]*\)\s*$/, "");

/**
 * series 優先序 (高特異性 → 低); pairKind 徽章蓋過 acquisition。
 * 注意: seasonal(32) 必須在 limited(16) 之前 — 季節拍組同時帶 limited bit,
 * 順序錯會把 99 隻季節全吞進繁星限定。masterfair 一律被徽章蓋掉, 不設此值。
 */
function seriesOf(kind, acq) {
  if (kind === "arc") return "arc";
  if (kind === "exmaster") return "exmaster";
  if (kind === "master") return "master";
  const a = acq ?? 0;
  if (a & 64) return "fair";
  if (a & 32) return "seasonal";
  if (a & 16) return "limited";
  if (a & 8) return "legendary";
  if (a & 512) return "bp";
  if (a & 1024) return "lodge";
  if (a & 2048) return "ticket";
  if (a & 128) return "event";
  if (a & 1) return "story";
  return "general";
}

/**
 * 取得管道 (可多個) — series 只能有一個且徽章優先, 但「掛大師徽章、實際是對戰點數兌換」
 * 的拍組有 11 隻, 只留 series 會讓它們在「對戰點數」篩不出來。這裡把 bitmask 全展開。
 */
const ACQ_BITS = [
  [64, "fair"],
  [32, "seasonal"],
  [16, "limited"],
  [8, "legendary"],
  [512, "bp"],
  [1024, "lodge"],
  [2048, "ticket"],
  [128, "event"],
  [1, "story"],
];

function acquisitionsOf(acq) {
  const a = acq ?? 0;
  return ACQ_BITS.filter(([bit]) => a & bit).map(([, tag]) => tag);
}

const list = Array.isArray(pairsRaw) ? pairsRaw : Object.values(pairsRaw);
const metaByKey = new Map();
const byTrainer = new Map(); // trainerNorm → [{pokeNorm, meta}]
const put = (key, meta) => {
  if (!metaByKey.has(key)) metaByKey.set(key, meta);
};
for (const p of list) {
  const trainer = CHAR[String(p.trainerId)];
  const pokemon = PKMN[String(p.pokemon?.[0]?.id)];
  if (!trainer || !pokemon) continue;
  const r = p.pokemon?.[0]?.skills?.length ? p.pokemon[0].skills[0][0] : 9999999;
  let kind = "none";
  if (r > 2800000 && r < 2903000) {
    kind = r > 2900000 ? "arc" : r > 2804000 ? "exmaster" : "master";
  }
  const meta = {
    releaseDate: p.date > 0 ? new Date(p.date * 1000).toISOString().slice(0, 10) : null,
    pairKind: kind,
    series: seriesOf(kind, p.acquisition),
    acquisitions: acquisitionsOf(p.acquisition),
  };
  const tN = norm(trainer);
  put(`${tN}|${norm(pokemon)}`, meta);
  put(`${tN}|${norm(stripForm(pokemon))}`, meta); // 括號形態 fallback
  if (!byTrainer.has(tN)) byTrainer.set(tN, []);
  byTrainer.get(tN).push({ pokeNorm: norm(pokemon), meta });
}
console.log(`pomatools 對照 keys: ${metaByKey.size}`);

/**
 * 同訓練家下模糊比對 — 形態修飾可能在後 (Lycanroc Midday) 也可能在前
 * (Alolan Raichu / White Kyurem ★)。用雙向包含, 多個命中取重疊最長者。
 */
function prefixLookup(trainerNorm, pokeNorm) {
  const cands = byTrainer.get(trainerNorm) ?? [];
  const hit = cands
    .filter((c) => c.pokeNorm.includes(pokeNorm) || pokeNorm.includes(c.pokeNorm))
    .sort((a, b) => b.pokeNorm.length - a.pokeNorm.length);
  return hit.length >= 1 ? hit[0].meta : null;
}

// wiki roster (fandom): 上架日 fallback — pomatools 沒收的老拍組與剛實裝的新拍組都靠它。
// 注意欄位在 wiki.roster (trainer/pokemon/releaseDate), 不是 wiki.sixEx (那邊只有 page/dateUnlocked)。
//
// **主要對映走 pomaPairId (by-id), 名稱 key 只是第二順位**:
// wiki 的寶可夢名帶形態後綴而 datamine 只給本名 (wiki "Palkia (Origin Forme)" vs 我們 "Palkia"),
// 純名稱比對對不上 → 2026-09 就這樣讓「小光（冠軍）& 帕路奇亞」「明輝（冠軍）& 帝牙盧卡」
// 整筆沒有上架日 (卡片沒 NEW 徽章、預設排序沉底, 還讓 unreleased-pairs 測試變紅)。
// wiki 側反過來拼錯名字的也救不回來 (roster 把 Treecko 寫成 "Treeko" → 小悠 & 木守宮 也沒日期)。
// scrape-wiki-exstyle.mjs 已經在 stage 2 把每列對到 catalog 的 pairId 存成 pomaPairId
// (660 列中 643 列有值, 且 643 列全部對得到 catalog), enrich-pomatools-exstyle.mjs 也是這樣 join 的
// —— 沿用同一條路, 不要再多養一套名稱正規化分支。
const wikiPath = join(__dirname, "..", "src", "data", "wiki-ex-style.json");
const wikiDateById = new Map();
const wikiDateByKey = new Map();
try {
  const wiki = JSON.parse(readFileSync(wikiPath, "utf8"));
  for (const r of wiki.roster ?? []) {
    if (!r.trainer || !r.pokemon || !r.releaseDate) continue;
    // "8/29/19" → ISO
    const m = String(r.releaseDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) continue;
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${yyyy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (r.pomaPairId && !wikiDateById.has(String(r.pomaPairId))) {
      wikiDateById.set(String(r.pomaPairId), iso);
    }
    const key = `${norm(r.trainer)}|${norm(r.pokemon)}`;
    if (!wikiDateByKey.has(key)) wikiDateByKey.set(key, iso);
  }
  console.log(
    `wiki roster 上架日: by-id ${wikiDateById.size} 筆 ・ 名稱 fallback ${wikiDateByKey.size} 筆`
  );
} catch {
  console.log("wiki-ex-style.json 不可用, 跳過日期 fallback");
}

/**
 * brybry datamine 新拍組的名稱常未本地化 (阿爾套裝卡露妮的 EN 名只是 "Diantha"),
 * 會與本體撞 name-key 而整包繼承本體 meta (系列/日期全錯 — 曾把阿爾卡露妮標成群星)。
 * 防護: trainerId 變體碼 >= 90 (阿爾/冠軍等高階線) 且與較低變體同名時,
 * 只接受帶變體前綴的 pomatools/wiki 條目 (Arc Suit X / X (Champion)), 否則視為未收錄。
 */
const variantOf = (tid) => Number((tid.match(/^ch\d{4}_(\d{2})_/) ?? [])[1] ?? 0);

/**
 * pomatools/wiki 未收錄的「已實裝」新拍組 — 依官方新聞查證手動指定
 * (2026-07 阿爾套裝 fair / 2026-05~06 Neo Champions EX 大師)。
 * pomatools 收錄後這些值會與自動比對一致, 屆時可移除。
 */
// ⚠ **這張表不再管 releaseDate 的最終值** (2026-09-09): 日期的唯一手寫入口是
//    src/data/pair-debut-dates.json (初上線日登記簿, 以 pairId 為鍵, 每筆都要附來源網址),
//    由 scripts/apply-debut-dates.mjs 在管線最後一階套用, 蓋得過這裡與 pomatools / wiki。
//    這裡留著的 releaseDate 只是「讓 upcoming 那條 fallback 有值可用」的中繼, 不是答案。
//    以 trainerId 為鍵的表本來就表達不了「同一位訓練家的第二個拍組要改日期」。
const RELEASED_OVERRIDES = {
  ch0158_90_carnet: { series: "arc", pairKind: "arc", releaseDate: "2026-07-18" }, // 阿爾套裝卡露妮 & 沙奈朵
  ch0295_90_omodaka: { series: "arc", pairKind: "arc" }, // 阿爾套裝也慈 & 晶光花
  ch0112_91_hibiki: { series: "exmaster", pairKind: "exmaster" }, // 阿響 (冠軍) & 雷公
  ch0002_90_kotone: { series: "exmaster", pairKind: "exmaster" }, // 琴音 (冠軍) & 炎帝
  ch0291_40_sho: { series: "seasonal", pairKind: "none" }, // 小照 (2026夏季) & 瑪納霏
  ch0312_40_hinatsu: { series: "seasonal", pairKind: "none", releaseDate: "2026-07-02" }, // 火夏 (2026夏季) & 幽尾玄魚
  // ↓ 2026-09-01 補: wiki roster 對這幾筆都蓋了 MasterSyncPairMark, 但 pomatools 還沒收錄 →
  //   跑到下面 :223 的 fallback 只會拿到 upcoming/general 且 pairKind 留在 "none",
  //   結果是**卡片沒有大師徽章 + 系列篩選按哪個 chip 都找不到**。
  //   wiki 的 marks 分不出 master / exmaster (EX 大師拍組同樣蓋 MasterSyncPairMark),
  //   所以逐筆查 Bulbapedia 的 PairDex 條目確認取得管道再手寫 (照這份表原本的用法)。
  ch0021_40_green: { series: "exmaster", pairKind: "exmaster", releaseDate: "2026-08-28" }, // 青綠 (2026週年慶) & 快龍 — exmaster=yes / EX Master Fair
  ch0130_41_serena: { series: "exmaster", pairKind: "exmaster", releaseDate: "2026-08-28" }, // 莎莉娜 (2026週年慶) & 甲賀忍蛙 — exmaster=yes / EX Master Fair
  ch0357_10_suguri: { series: "exmaster", pairKind: "exmaster", releaseDate: "2026-05-01" }, // 美極套裝烏栗 & 大尾立 — EX Master Fair (上市 >90 天, 原本掉進 general)
  // 大師徽章但取得管道是對戰點數 —— AGENTS.md:「徽章會蓋掉 series, 另存 acquisitions[] 全展開,
  // 篩選兩邊都吃」, 所以這筆要同時給 series=master 與 acquisitions=["bp"]。
  ch0201_00_jindai: { series: "master", pairKind: "master", releaseDate: "2026-08-28", acquisitions: ["bp"] }, // 神代 & 急凍鳥 — master=yes / Battle Points
};

// brybry datamine 以「本尊」命名化名角色, pomatools/wiki 用官方化名 — 依 trainerId 對齊,
// 否則這四隻已實裝拍組會永遠對不上而錯標「最新」。
const EN_ALIASES = {
  ch0117_00_royalmask: "The Masked Royal", // 庫庫伊的化名 (皇家假面)
  ch0300_00_jujube: "Bellelba", // 娜姿演的電影角色
  ch0301_00_hachikuman: "Brycen-Man", // 哈奇庫演的電影角色
  ch0358_00_nelke: "Clive", // 克拉韋爾的化名
};

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

// EN name-key → trainerIds (偵測 datamine 高階變體與本體撞名)
const keyGroup = new Map();
for (const rec of catalog.records) {
  const k = `${norm(rec.trainerName)}|${norm(rec.pokemonName)}`;
  if (!keyGroup.has(k)) keyGroup.set(k, new Set());
  keyGroup.get(k).add(rec.trainerId);
}

const stats = { date: 0, kind: 0, series: 0, unmatched: [] };
const seriesCount = {};
for (const rec of catalog.records) {
  const enName = EN_ALIASES[rec.trainerId] ?? rec.trainerName;
  const tN = norm(enName);
  const pN = norm(rec.pokemonName);
  const pNStripped = norm(stripForm(rec.pokemonName));
  const myVar = variantOf(rec.trainerId);
  const collided =
    myVar >= 90 &&
    [...(keyGroup.get(`${norm(rec.trainerName)}|${pN}`) ?? [])].some(
      (id) => id !== rec.trainerId && variantOf(id) < myVar
    );
  // 撞名的高階變體只接受帶前綴的條目; 一般記錄走原本三段 lookup
  const prefixedKeys = [
    `${norm(`Arc Suit ${enName}`)}|${pN}`,
    `${norm(`Arc Suit ${enName}`)}|${pNStripped}`,
    `${norm(`${enName} (Champion)`)}|${pN}`,
    `${norm(`${enName} (Champion)`)}|${pNStripped}`,
  ];
  const meta = collided
    ? prefixedKeys.map((k) => metaByKey.get(k)).find(Boolean) ?? null
    : metaByKey.get(`${tN}|${pN}`) ??
      metaByKey.get(`${tN}|${pNStripped}`) ??
      (pN ? prefixLookup(tN, pN) : null);
  // wiki roster 日期 fallback (pomatools 沒日期或整筆沒收時)。
  // by-id 是精確對映, 連撞名的高階變體都安全 (那正是名稱比對會出錯的地方) → 排第一順位;
  // 沒有 pomaPairId 的列才退回名稱 key, 撞名者同樣只查前綴 key。
  const wikiDate =
    wikiDateById.get(String(rec.pairId)) ??
    (collided
      ? prefixedKeys.map((k) => wikiDateByKey.get(k)).find(Boolean) ?? null
      : wikiDateByKey.get(`${tN}|${pN}`) ??
        wikiDateByKey.get(`${tN}|${pNStripped}`) ??
        null);
  if (meta) {
    rec.releaseDate = meta.releaseDate ?? wikiDate;
    rec.pairKind = meta.pairKind;
    rec.series = meta.series;
    rec.acquisitions = meta.acquisitions;
    if (rec.releaseDate) stats.date++;
    if (meta.pairKind !== "none") stats.kind++;
  } else {
    rec.releaseDate = wikiDate;
    if (wikiDate) stats.date++;
    // pomatools 未收錄: 真正的 datamine 新拍組標「最新」;
    // 但 wiki 顯示早已上架 (>90 天) 的是資料缺口而非新拍組 → 退回一般
    const oldRelease =
      wikiDate && Date.now() - new Date(wikiDate).getTime() > 90 * 86400 * 1000;
    if ((rec.trainerNameZh ?? "").startsWith("阿爾套裝")) {
      rec.series = "arc";
      if (rec.pairKind === "none") rec.pairKind = "arc";
    } else {
      rec.series = oldRelease ? "general" : "upcoming";
    }
    if (rec.series === "upcoming") stats.unmatched.push(rec.trainerNameZh ?? rec.trainerName);
  }
  // 官方新聞查證的已實裝新拍組覆寫 (pomatools 落後期間)
  const ov = RELEASED_OVERRIDES[rec.trainerId];
  if (ov) {
    if (rec.series === "upcoming") {
      stats.unmatched = stats.unmatched.filter(
        (n) => n !== (rec.trainerNameZh ?? rec.trainerName)
      );
    }
    rec.series = ov.series;
    rec.pairKind = ov.pairKind;
    // 取得管道 (只有需要與 series 分開表示時才寫, 例如掛大師徽章但實為 BP 兌換)
    if (ov.acquisitions) rec.acquisitions = ov.acquisitions;
    if (!rec.releaseDate) {
      rec.releaseDate = ov.releaseDate;
      stats.date++;
    } else {
      rec.releaseDate = ov.releaseDate;
    }
  }
  seriesCount[rec.series] = (seriesCount[rec.series] ?? 0) + 1;
  stats.series++;
}
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}
`, "utf8");
console.log(
  `完成: 日期 ${stats.date}/${catalog.records.length}, 徽章 ${stats.kind}, 系列全數派定`
);
console.log("系列分佈:", JSON.stringify(seriesCount));
console.log(`pomatools 未收錄 (標 upcoming): ${stats.unmatched.length} 隻`);
if (stats.unmatched.length <= 20) console.log("  " + stats.unmatched.join(", "));
