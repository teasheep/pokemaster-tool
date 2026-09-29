// 潛能 (lucky skill) 對照 → src/data/pair-potentials.json
//
//   node scripts/fetch-potentials.mjs          (npm run data:potentials)
//
// 2026-09-29 使用者:「找到每個拍組對應可以使用的所有特殊潛能, 然後分類讓使用者可以選擇」、
// 「(特殊與一般) 都要, UI 上要分開, 一個拍組至多五個潛能, 要可以多選」。
//
// 來源 (交叉驗證過, 505 個有特殊潛能的拍組**逐筆一致**, 0 筆歧異):
//   結構  brybry datamine  PotentialItem.json (餅乾 → 專屬哪個拍組 / 抽獎表)
//                          PotentialLot.json  (抽獎表 → 潛能 id + 機率)
//   比對  www.pomatools.site /data/pairs/<pairId>.json 的 luckCookies (同一份結構的另一個整理者)
//   名稱  www.pomatools.site /locales/zh.json (官方繁中: passive_name_* / passive_desc_* / lucky_*)
// ⚠ pomatools 那邊記的是「名稱代號」(所有「塔潛能餅乾1」共用一個), brybry 記的是每個拍組各自的
//   道具 id —— 要用 PotentialItem.potentialItemName 對回名稱代號才比得起來 (直接比道具 id 會全錯)。
//
// 分類:
//   特殊潛能 = trainerId 不是 -1 的餅乾 (拍組專屬), 依餅乾名稱分成 專用 / 塔1 / 塔2 / 道館對戰
//   一般潛能 = trainerId = -1 的餅乾抽得到的全部潛能, 依餅乾分成 硬脆 / 鬆脆 / 酥脆 / 香脆 / 特別
//             (與 pomatools /data/potential/cookies.json 逐種比對)
import fs from "node:fs";
import path from "node:path";

const BRYBRY = "https://pokemon.brybry.ch/masters/data/proto";
const POMA = "https://www.pomatools.site";
const OUT = path.join(process.cwd(), "src/data/pair-potentials.json");

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  // pomatools 是 SPA, 不存在的路徑一律回 200 的首頁 —— 看內容不看狀態碼
  if (!res.ok || text.trimStart().startsWith("<")) throw new Error(`${url} 不是 JSON (HTTP ${res.status})`);
  return JSON.parse(text);
}
const rowsOf = (j) => (Array.isArray(j) ? j : Object.values(j).find(Array.isArray));

const [items, lots, zh] = await Promise.all([
  getJson(`${BRYBRY}/PotentialItem.json`).then(rowsOf),
  getJson(`${BRYBRY}/PotentialLot.json`).then(rowsOf),
  getJson(`${POMA}/locales/zh.json`),
]);

const lotSkills = new Map();
for (const l of lots) {
  const k = l.potentialLotId;
  if (!lotSkills.has(k)) lotSkills.set(k, []);
  const id = String(l.potentialId);
  if (!lotSkills.get(k).includes(id)) lotSkills.get(k).push(id);
}

const skills = {};
const nameOf = (id) => {
  const n = zh[`passive_name_${id}`];
  if (typeof n !== "string" || !n.trim()) throw new Error(`語系檔沒有潛能 ${id} 的名字 —— pomatools 改版了? 先看一下再重跑`);
  skills[id] = [n.trim(), String(zh[`passive_desc_${id}`] ?? "").trim()];
  return id;
};

/** 特殊潛能餅乾的名稱 (lucky_<代號>) → 分類。名稱裡的 [Name:…] 是遊戲自己的插值, 去掉 */
function kindOf(label) {
  if (/道館對戰/.test(label)) return "gym";
  if (/塔潛能餅乾\s*2/.test(label)) return "tower2";
  if (/塔潛能餅乾/.test(label)) return "tower1";
  if (/專用/.test(label)) return "exclusive";
  throw new Error(`認不得的特殊潛能餅乾: ${label}`);
}

// ── 特殊潛能: 每個拍組各自的餅乾 ──
const pairs = {};
for (const it of items) {
  if (it.trainerId === "-1") continue;
  const code = it.potentialItemName || it.itemId;
  const rawLabel = zh[`lucky_${code}`];
  if (typeof rawLabel !== "string") throw new Error(`語系檔沒有餅乾 ${code} 的名字`);
  const label = rawLabel.replace(/\[Name:[^\]]*\]\s*/g, "").replace(/^的/, "").trim();
  const ids = (lotSkills.get(it.potentialLotId) ?? []).map(nameOf);
  if (!ids.length) continue;
  (pairs[it.trainerId] ??= []).push({ kind: kindOf(label), label, skills: ids });
}
// 主角拍組: datamine 的 id 是 18xxx, 我方 catalog 用 player-<英文名> (scripts/add-protagonist-pairs.mjs)。
// 用 datamine 的寶可夢圖鑑號 (Trainer → Monster → MonsterBase.dexNumber) 對回 catalog 的
// pokemonId (`pmp<三位數圖鑑號>_…`)。對不到或不唯一就吵。
// (第一版用「屬性 + 稀有度」對: 鋼屬 5★ 有索爾迦雷歐與雷吉斯奇魯兩隻, 對不出來。)
{
  const read = (f) => rowsOf(JSON.parse(fs.readFileSync(`src/data/brybry/${f}.json`, "utf8")));
  const [trainerRows, monsterRows, baseRows] = [read("Trainer"), read("Monster"), read("MonsterBase")];
  const catalog = JSON.parse(fs.readFileSync("src/data/pomatools-pairs.json", "utf8")).records;
  const players = catalog.filter((r) => r.pairId.startsWith("player-"));
  for (const id of Object.keys(pairs)) {
    if (!id.startsWith("18")) continue;
    const t = trainerRows.find((x) => String(x.trainerId) === id);
    const m = t && monsterRows.find((x) => String(x.monsterId) === String(t.monsterId));
    const b = m && baseRows.find((x) => x.monsterBaseId === m.monsterBaseId);
    const dex = b ? `pmp${String(b.dexNumber).padStart(3, "0")}_` : null;
    const hits = dex ? players.filter((p) => p.pokemonId.startsWith(dex)) : [];
    if (hits.length !== 1) throw new Error(`主角拍組 ${id} 對不到唯一一筆 player-* (候選 ${hits.length})`);
    pairs[hits[0].pairId] = pairs[id];
    delete pairs[id];
  }
}

// 同一拍組內排序: 專用 → 塔1 → 塔2 → 道館對戰 (與畫面分組的順序一致)
const ORDER = { exclusive: 0, tower1: 1, tower2: 2, gym: 3 };
for (const list of Object.values(pairs)) list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label));

// ── 一般潛能: 所有拍組都能用的餅乾 (trainerId -1) 抽得到的潛能, 依餅乾分組 ──
// 2026-09-29 使用者:「一般潛能也要幫我分類」。分法照 pomatools 的潛能選單 (五種顏色的餅乾):
// 同一個潛能出現在好幾種餅乾時歸給**排前面**的那一種 —— 特別潛能餅乾抽得到的大多與前四種重複,
// 只留它獨有的 (pomatools cookies.json 的 notes 也是這樣講的)。
const GENERAL_KINDS = [
  { key: "red", label: "硬脆潛能餅乾" },
  { key: "blue", label: "鬆脆潛能餅乾" },
  { key: "yellow", label: "酥脆潛能餅乾" },
  { key: "pink", label: "香脆潛能餅乾" },
  { key: "purple", label: "特別潛能餅乾" },
];
const generalBy = Object.fromEntries(GENERAL_KINDS.map((k) => [k.key, new Set()]));
for (const it of items) {
  if (it.trainerId !== "-1") continue;
  const label = String(zh[`lucky_${it.itemId}`] ?? "");
  // 「硬脆潛能餅乾★3」「特別潛能必得餅乾7」→ 認前兩個字
  const kind = GENERAL_KINDS.find((k) => label.startsWith(k.label.slice(0, 2)));
  if (!kind) throw new Error(`認不得的一般潛能餅乾: ${it.itemId} ${label}`);
  for (const id of lotSkills.get(it.potentialLotId) ?? []) generalBy[kind.key].add(nameOf(id));
}
const seen = new Set();
const general = GENERAL_KINDS.map(({ key, label }) => {
  const ids = [...generalBy[key]].filter((id) => !seen.has(id)).sort();
  ids.forEach((id) => seen.add(id));
  return { key, label, skills: ids };
});
// 交叉驗證: 每一種餅乾的潛能要與 pomatools 的 /data/potential/cookies.json 一模一樣
{
  const poma = await getJson(`${POMA}/data/potential/cookies.json`);
  for (const g of general) {
    const theirs = (poma.colors?.[g.key]?.passiveIds ?? []).map(String).sort();
    if (theirs.join() !== g.skills.join())
      throw new Error(`${g.label} 與 pomatools 不一致 (我方 ${g.skills.length} / 對方 ${theirs.length}) —— 先看一下再重跑`);
  }
}

// ── 圖示: 五種一般餅乾 + 四種特殊潛能餅乾 (遊戲素材), 裁邊後轉 webp ──
// 一般餅乾用 pomatools 的; 特殊餅乾**每一種長得不一樣**, pomatools 只有一張 (= 塔潛能餅乾1 的粉紅格紋),
// 所以改從神奇寶貝百科「道具列表（Masters）」抓四張 (2026-09-29 使用者:「專用潛能餅乾好像是星號圖示」
// —— 專用餅乾是咖啡色、內餡滿滿的星星)。對應關係用 datamine 的 imageId 驗證過:
//   專用 i051_0036_00 (= 特別潛能必得餅乾同一張圖) / 塔1 i051_0041_00 / 塔2 i051_0041_01 (星形吊牌) /
//   道館對戰 i051_0042_01 (藍色)
const WIKI_ICON = "https://media.52poke.com/wiki/thumb";
const ICONS = [
  ...GENERAL_KINDS.map((k) => ({ key: k.key, url: `${POMA}/assets/images/icon_cookie_${k.key}.png` })),
  { key: "exclusive", url: `${WIKI_ICON}/8/86/PM_%E7%89%B9%E5%88%A5%E6%BD%9B%E8%83%BD%E5%BF%85%E5%BE%97%E9%A4%85%E4%B9%BE_icon.png/128px-PM_%E7%89%B9%E5%88%A5%E6%BD%9B%E8%83%BD%E5%BF%85%E5%BE%97%E9%A4%85%E4%B9%BE_icon.png` },
  { key: "tower1", url: `${WIKI_ICON}/4/42/PM_%E5%B0%88%E7%94%A8%E7%9A%84%E5%A1%94%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%91_icon.png/128px-PM_%E5%B0%88%E7%94%A8%E7%9A%84%E5%A1%94%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%91_icon.png` },
  { key: "tower2", url: `${WIKI_ICON}/c/ca/PM_%E5%B0%88%E7%94%A8%E7%9A%84%E5%A1%94%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%92_icon.png/128px-PM_%E5%B0%88%E7%94%A8%E7%9A%84%E5%A1%94%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%92_icon.png` },
  { key: "gym", url: `${WIKI_ICON}/9/93/PM_%E5%B0%88%E7%94%A8%E9%81%93%E9%A4%A8%E5%B0%8D%E6%88%B0%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%91_icon.png/128px-PM_%E5%B0%88%E7%94%A8%E9%81%93%E9%A4%A8%E5%B0%8D%E6%88%B0%E6%BD%9B%E8%83%BD%E9%A4%85%E4%B9%BE%EF%BC%91_icon.png` },
];
{
  const sharp = (await import("sharp")).default;
  const dir = path.join(process.cwd(), "public/reference/ui/potential");
  fs.mkdirSync(dir, { recursive: true });
  for (const { key, url } of ICONS) {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://wiki.52poke.com/" } });
    if (!res.ok || !String(res.headers.get("content-type")).startsWith("image/"))
      throw new Error(`餅乾圖示 ${key} 抓不到 (HTTP ${res.status})`);
    // 原圖四周留白很多 (餅乾只佔中間六成), 12-20px 顯示時會小到認不出來 → 先裁掉透明邊再縮。
    // 最大顯示約 24px × DPR3 → 64px 就夠
    await sharp(Buffer.from(await res.arrayBuffer()))
      .trim()
      .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(path.join(dir, `cookie_${key}.webp`));
  }
}

const out = {
  _note: "由 scripts/fetch-potentials.mjs 產生, 不要手改。來源與交叉驗證見腳本檔頭。",
  fetchedAt: new Date().toISOString().slice(0, 10),
  skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b))),
  general,
  pairs: Object.fromEntries(Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b))),
};
// 一筆一行: 看得懂 diff, 又不會胖成三倍 (這個檔在側板打開時才載入, 但仍然越小越好)
const lines = (obj) => Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
fs.writeFileSync(
  OUT,
  `{\n "_note": ${JSON.stringify(out._note)},\n "fetchedAt": ${JSON.stringify(out.fetchedAt)},\n` +
    ` "general": [\n${out.general.map((g) => `  ${JSON.stringify(g)}`).join(",\n")}\n ],\n "skills": {\n${lines(out.skills)}\n },\n "pairs": {\n${lines(out.pairs)}\n }\n}\n`
);
const kinds = {};
for (const list of Object.values(pairs)) for (const c of list) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
console.log(`潛能 ${Object.keys(skills).length} 種 (一般 ${general.map((g) => `${g.label} ${g.skills.length}`).join(" / ")}) ・ 有特殊潛能的拍組 ${Object.keys(pairs).length} ・ 餅乾分類 ${JSON.stringify(kinds)}`);
console.log(`已寫出 ${path.relative(process.cwd(), OUT)}`);
