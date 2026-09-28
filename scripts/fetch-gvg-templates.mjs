// 道館戰模板的「每關每輪規則」— 從 pomatools 抓官方資料轉成 src/data/gvg-stage-rules.json
//
//   node scripts/fetch-gvg-templates.mjs          (npm run data:gvg)
//
// 來源: www.pomatools.site 的道館戰頁 (#/gvg?id=8090) 背後那幾份 JSON
//   /data/gvg/<id>.json   8 位館主 × 15 輪 (R1-R3 + Ex1-Ex12), 數值與規則都是代號
//   /locales/zh.json      官方繁中文字 (規則 gvg_theme_* / 被動 passive_name_* / 館主 trainer_name_*)
// ⚠ 路徑是 /data/... 不是 bundle 裡寫的 /public/data/... —— 後者是 SPA 的 fallback, 一律回 200 的首頁 HTML。
//
// 每一回有兩種東西, 不要混 (docs/strategy-videos 那邊被使用者抓過一次):
//   關卡特性 = 館主的被動, R1/R2/R3 各多一個 (addedPassives 逐輪累加)
//   輪次限制 = 那一輪對我方的規則 (theme), 從 Ex1 開始, 在 8 關之間錯開輪替
//
// 弱點屬性是數字 (weak), 用遊戲的標準屬性順序 1 一般 … 18 妖精。
// 2026-09-28 用前三回對過我們手上的模板 (這個道館實際打過的 battle_stages), 24 關全部吻合。
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.pomatools.site";
/** pomatools 的道館戰 id → 我們的模板 id (lib/gym/battle-templates.ts) */
const EDITIONS = { 8010: "r1-kanto", 8030: "r2-galar", 8050: "r3-johto", 8090: "r4-sinnoh" };
const TYPES = [
  null, "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];
const OUT = path.join(process.cwd(), "src/data/gvg-stage-rules.json");
/** stage_round_notes.note 的上限 (0044 的 check) */
const NOTE_MAX = 100;

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  // SPA 的 fallback 會把任何不存在的路徑回成 200 的首頁 —— 看內容不看狀態碼
  if (!res.ok || text.trimStart().startsWith("<")) throw new Error(`${url} 不是 JSON (HTTP ${res.status})`);
  return JSON.parse(text);
}

const zh = await getJson(`${BASE}/locales/zh.json`);
const text = (key) => {
  const v = zh[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`語系檔沒有 ${key} —— pomatools 改版了? 先看一下再重跑`);
  return v.trim();
};
const passive = (id) => text(`passive_name_${id}`);
const trainer = (actor) => text(`trainer_name_${actor.split("_")[0]}`);
// pm0408_00_zugaidos → pokemon_name_20040800 = "2" + 五位數圖鑑號 + 每一段兩位數型態碼
// (pm0095_00 → 20009500; 極巨化這類多一段: pm0834_00_00 → 2008340000)
const pokemon = (actor) => {
  const m = actor.match(/^pm(\d{4})((?:_\d{2})+)/);
  if (!m) throw new Error(`看不懂的寶可夢代號 ${actor}`);
  const dex = `pokemon_name_2${m[1].padStart(5, "0")}`;
  const exact = `${dex}${m[2].replace(/_/g, "")}`;
  if (zh[exact]) return text(exact);
  // 館主的寶可夢常是 NPC 專用型態, 語系檔只收了別的型態 —— 同一個圖鑑號, 名字是一樣的
  const alt = Object.keys(zh).find((k) => k.startsWith(dex));
  if (!alt) throw new Error(`語系檔沒有 ${actor} 的名字`);
  return text(alt);
};
const clip = (s) => {
  if (s.length > NOTE_MAX) throw new Error(`說明超過 ${NOTE_MAX} 字 (DB 會擋): ${s}`);
  return s;
};

const out = { source: `${BASE}/#/gvg`, fetchedAt: new Date().toISOString().slice(0, 10), editions: {} };
for (const [gvgId, templateId] of Object.entries(EDITIONS)) {
  const g = (await getJson(`${BASE}/data/gvg/${gvgId}.json`)).gvg;
  // 8 位館主都有的被動 = 這一回的通用設定 (抗性、HP 回復 0…), 不是這一關的特色 → 不列
  const common = g.bossList
    .map((b) => new Set(b.base.npc1.passives))
    .reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  const stages = g.bossList.map((b) => {
    const npc = b.base.npc1;
    const weak = TYPES[npc.weak];
    if (!weak) throw new Error(`${gvgId}: 看不懂的弱點代號 ${npc.weak}`);
    // 命中率每關的數字都不一樣、「XX抗性11」有一兩關換成「XX無效」, 但本質上每關都有 —— 算通用設定
    // (不濾的話 8 關裡 7 關的「固有」都是同一串「束縛抗性11、沙暴抗性11」, 真正的特色反而被淹掉)
    const own = npc.passives
      .filter((p) => !common.has(p))
      .map(passive)
      .filter((n) => !/命中率|抗性\d+$/.test(n));
    const notes = [];
    let prev = new Set();
    for (const r of b.rounds) {
      const added = r.overwrites?.npc1?.addedPassives ?? [];
      const fresh = added.filter((p) => !prev.has(p)).map(passive);
      prev = new Set(added);
      let note;
      if (r.theme) {
        // 輪次限制 (兩條時是換行分隔, 例: 「物理傷害0\n非效果絕佳時傷害0」)
        note = text(r.theme).split(/\n+/).join("・");
      } else {
        const parts = [];
        if (r.round === 1) parts.push(`館主 ${trainer(npc.traninerActorId)}＆${pokemon(npc.monsterActorId)}`);
        if (r.round === 1 && own.length) parts.push(`固有：${own.join("、")}`);
        if (fresh.length) parts.push(`${r.round === 1 ? "被動" : "追加被動"}：${fresh.join("、")}`);
        note = parts.join("｜");
      }
      if (note) notes.push({ round: r.round, note: clip(note) });
    }
    return { weak, leader: trainer(npc.traninerActorId), pokemon: pokemon(npc.monsterActorId), notes };
  });
  out.editions[templateId] = {
    gvgId: Number(gvgId),
    title: g.title.map((t) => text(`event_title_${t}`)),
    start: g.startDate,
    end: g.endDate,
    stages,
  };
  console.log(`${templateId} (${gvgId}) ${out.editions[templateId].title.join(" / ")}: ${stages.map((s) => `${s.leader}=${s.weak}`).join(" ")}`);
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`已寫出 ${path.relative(process.cwd(), OUT)}`);
