// 拍組繁中名裡的**全形英數字改成半形** —— 上游來源混用, 站上看起來就不一致。
//
// 2026-09-10 使用者:「有些拍組名稱包含 2025 2026 等數字的, 有些是全形有些半形,
// 我想要統一半形。２０２５ 這種改回 2025」。
//
// 同一個角色兩種寫法是真的存在的, 不是我腦補的:
//   「Ｎ＆捷克羅姆」與「N（2022夏季）＆索羅亞克」—— 同一個 N, 一個全形一個半形。
//   「阿塞蘿拉（２０２０秋季）＆謎擬Ｑ」—— 官方繁中是「謎擬Q」。
//
// 只動**英數字** (Ｑ→Q / ２→2), **不動全形括號** —— 括號是中文排版的正常寫法,
// 而且 catalog 裡 168 筆全部是全形、0 筆半形, 本來就一致, 沒有要統一的問題。
//
// ⚠ 這一步必須留在資料管線裡 (5b3), 不要改成顯示時才轉:
//   pairName() 的產出會被寫進 `member_pairs.pair_label` 與 `gym_pairs.pair_label`,
//   而那兩張表的唯一鍵就是 label。顯示時才轉的話, 資料庫裡永遠留著全形那一份,
//   下次 upsert 就會因為 label 對不上而**多長一列**(同一個人同一張卡兩列)。
//   已經寫進資料庫的那 333 列由 0070 一次改掉。
//
// 冪等: 重跑結果一樣。用法: node scripts/normalize-pair-names.mjs

import fs from "node:fs";

const CATALOG = "src/data/pomatools-pairs.json";
/** 只轉英數字; 全形空白與括號等標點刻意不動 */
const FULLWIDTH = /[Ａ-Ｚａ-ｚ０-９]/g;

function halfWidth(s) {
  return s.replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const changed = [];
for (const rec of catalog.records) {
  for (const field of ["trainerNameZh", "pokemonNameZh"]) {
    const before = rec[field];
    if (typeof before !== "string") continue;
    const after = halfWidth(before);
    if (after !== before) {
      rec[field] = after;
      changed.push(`${rec.pairId} ${field}: ${before} → ${after}`);
    }
  }
}

fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
console.log(`全形英數字 → 半形: 改了 ${changed.length} 個欄位`);
for (const line of changed.slice(0, 12)) console.log("  " + line);
if (changed.length > 12) console.log(`  … 其餘 ${changed.length - 12} 個`);
