// 道館紀錄頁 (hostmyclaudehtml 單檔 HTML) 的解析與名稱比對純函式。
// 被 import-gym-data.mjs 使用; tests/gym-import.test.ts 直接測這裡。
//
// 兩個來源頁的資料都是 inline JS 常數且值為合法 JSON:
//   降抗頁:   const MEMBERS_DATA = {成員: {"<屬性><類別> [<訓練家>&<寶可夢>]": 0-7}}
//   主打手頁: const scores = {"<屬性>物|特": [{name, score}]}
//             const pokemon_data = {成員: {"<屬性>物|特": [{pokemon, value}]}}
// 安全性: 只用字串擷取 + JSON.parse, 絕不執行下載回來的 JS。

/** 頁面屬性縮寫 → DB enum sync_pair_type */
export const TYPE_ABBREV = {
  一般: "normal",
  火: "fire",
  水: "water",
  電: "electric",
  草: "grass",
  冰: "ice",
  格: "fighting",
  毒: "poison",
  地: "ground",
  飛: "flying",
  超: "psychic",
  蟲: "bug",
  岩: "rock",
  幽: "ghost",
  龍: "dragon",
  惡: "dark",
  鋼: "steel",
  妖: "fairy",
};

/** 類別中文 → member_debuffs.kind */
export const KIND_MAP = {
  降抗: "debuff",
  特攻: "sp_atk",
  物攻: "ph_atk",
  場域: "field",
};

/** 持有等級中文 → member_pairs.grade (0=無持有 .. 6=超覺醒) */
export const GRADE_MAP = {
  無持有: 0,
  寶1: 1,
  寶2: 2,
  寶3: 3,
  寶4: 4,
  寶5: 5,
  超覺醒: 6,
};

/**
 * 從 HTML 擷取 `const <name> = <JSON>;` 的值 (單行) 並 JSON.parse。
 * 找不到或 parse 失敗丟 Error。
 */
export function extractConst(html, name) {
  const marker = `const ${name} = `;
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error(`找不到 const ${name}`);
  const start = idx + marker.length;
  let end = html.indexOf("\n", start);
  if (end === -1) end = html.length;
  let raw = html.slice(start, end).trim();
  if (raw.endsWith(";")) raw = raw.slice(0, -1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`const ${name} 不是合法 JSON: ${e.message}`);
  }
}

/**
 * 名稱正規化 (比對用): NFKC 統一全形 (＆→&, （）→(), ２０２２→2022, Ｚ→Z),
 * 移除所有空白與 CJK 中點 (卡璞・蝶蝶 vs 卡璞·蝶蝶)。顯示用請用 displayLabel()。
 */
export function normKey(s) {
  return s.normalize("NFKC").replace(/[\s・·‧]+/g, "");
}

/** 社群慣用綽號 → catalog 正式名 (比對前替換, 只影響比對不影響顯示) */
export const POKEMON_ALIASES = { 鳳凰: "鳳王" };
export const TRAINER_ALIASES = { 哈奇酷俠: "哈奇庫" };

/** 顯示用標籤: NFKC + trim (保留字間空白) */
export function displayLabel(s) {
  return s.normalize("NFKC").trim();
}

/**
 * 解析降抗頁技能鍵 "火特攻 [阿爾套裝丹帝&噴火龍]" → {type, kind, label, matchLabel}。
 * 來源資料偶有 "…]2" 這種尾碼 (同拍組第二筆), 保留尾碼讓 label 不撞 unique key,
 * 但 matchLabel (對 catalog 用) 去掉尾碼。不合格式回 null。
 */
export function parseSkillKey(key) {
  const m = key.match(/^(.+?)(降抗|特攻|物攻|場域)\s*\[(.+?)\]\s*(\S+)?\s*$/);
  if (!m) return null;
  const type = TYPE_ABBREV[m[1]];
  const kind = KIND_MAP[m[2]];
  if (!type || !kind) return null;
  const base = displayLabel(m[3]);
  return {
    type,
    kind,
    label: m[4] ? `${base} (${m[4]})` : base,
    matchLabel: base,
  };
}

/** 解析主打手頁類別鍵 "一般物" / "火特" → {type, category}; 不合格式回 null */
export function parseCategoryKey(key) {
  const m = key.match(/^(.+?)(物|特)$/);
  if (!m) return null;
  const type = TYPE_ABBREV[m[1]];
  if (!type) return null;
  return { type, category: m[2] === "物" ? "physical" : "special" };
}

/** 去掉尾端括號備註: "沼躍魚(可過水塔27層)" → "沼躍魚" (輸入需已 normKey) */
function stripTrailingParen(s) {
  return s.replace(/\([^()]*\)$/, "");
}

/** 拆訓練家為 base + 括號註記: "小優(2025週年)" → {base:"小優", note:"2025週年"} */
function splitTrainer(s) {
  const m = s.match(/^(.+?)\((.+)\)$/);
  return m ? { base: m[1], note: m[2] } : { base: s, note: null };
}

/**
 * 建立 catalog 比對器。records = pomatools-pairs.json 的 records。
 * match(label) → { pairId, via } | null
 * 比對順序: 全名精確 → 寶可夢唯一 → 訓練家包含 → 訓練家 base+括號註記 → 同名多型態取最小 pairId。
 */
export function buildMatcher(records) {
  const exact = new Map(); // normKey("訓練家&寶可夢") → [record]
  const byPokemon = new Map(); // normKey(寶可夢) → [record]
  for (const r of records) {
    if (!r.trainerNameZh || !r.pokemonNameZh) continue;
    const k = normKey(`${r.trainerNameZh}&${r.pokemonNameZh}`);
    if (!exact.has(k)) exact.set(k, []);
    exact.get(k).push(r);
    const pk = normKey(r.pokemonNameZh);
    if (!byPokemon.has(pk)) byPokemon.set(pk, []);
    byPokemon.get(pk).push(r);
  }

  // 同名多筆 (例: 鎯琊&胡帕 有多型態) → 取最小 pairId 當代表, 穩定可重現
  const pickFirst = (arr) => [...arr].sort((a, b) => a.pairId.localeCompare(b.pairId))[0];

  return function match(label) {
    let k = normKey(label);
    for (const [from, to] of Object.entries(POKEMON_ALIASES)) k = k.replace(normKey(from), normKey(to));
    for (const [from, to] of Object.entries(TRAINER_ALIASES)) k = k.replace(normKey(from), normKey(to));

    const hit = exact.get(k);
    if (hit && hit.length === 1) return { pairId: hit[0].pairId, via: "exact" };
    // 同名多筆 = 同一拍組的多型態 (訓練家+寶可夢全同), 取最小 pairId 當代表是安全的
    if (hit && hit.length > 1) return { pairId: pickFirst(hit).pairId, via: "exact-multiform" };

    const parts = k.split("&");
    if (parts.length !== 2) return null;
    const [trainer, pokemonRaw] = parts;
    const pokemon = stripTrailingParen(pokemonRaw);
    const cands = byPokemon.get(pokemon) ?? byPokemon.get(pokemonRaw) ?? [];
    if (cands.length === 1) return { pairId: cands[0].pairId, via: "pokemon" };
    if (cands.length === 0) return null;

    // 訓練家包含比對 — 唯一才採用; 多筆時繼續用括號註記縮小, 不硬選
    const narrowed = cands.filter((r) => {
      const t = normKey(r.trainerNameZh);
      return t.includes(trainer) || trainer.includes(t);
    });
    if (narrowed.length === 1) return { pairId: narrowed[0].pairId, via: "pokemon+trainer" };

    // base 相同 → 用括號註記互相包含縮小 (小優(2025週年) vs 小優(2025週年慶))
    const pool = narrowed.length > 1 ? narrowed : cands;
    const q = splitTrainer(trainer);
    const sameBase = pool.filter((r) => splitTrainer(normKey(r.trainerNameZh)).base === q.base);
    if (sameBase.length === 1) return { pairId: sameBase[0].pairId, via: "pokemon+base" };
    if (sameBase.length > 1 && q.note) {
      const byNote = sameBase.filter((r) => {
        const n = splitTrainer(normKey(r.trainerNameZh)).note;
        return n && (n.includes(q.note) || q.note.includes(n));
      });
      if (byNote.length === 1) return { pairId: byNote[0].pairId, via: "pokemon+note" };
    }
    // 走到這裡仍有多個候選: 只有「訓練家完全同名」(同一拍組多型態) 才能安全取代表。
    // 不同訓練家寧可回 null — 錯配會把 A 的拍組算到 B 頭上, 比不配更糟。
    const finalPool = sameBase.length > 0 ? sameBase : pool;
    if (new Set(finalPool.map((r) => normKey(r.trainerNameZh))).size === 1) {
      return { pairId: pickFirst(finalPool).pairId, via: "multiform" };
    }
    return null;
  };
}

/**
 * 解析降抗頁 → { members: string[], debuffs: [{member, type, kind, label, value}] }
 * 值為 0 的項目略過 (無資料, 不落庫)。
 */
export function transformDebuffPage(html) {
  const data = extractConst(html, "MEMBERS_DATA");
  const members = extractConst(html, "MEMBERS_LIST").map(displayLabel);
  const debuffs = [];
  const badKeys = new Set();
  for (const [member, skills] of Object.entries(data)) {
    for (const [key, value] of Object.entries(skills)) {
      if (!value) continue;
      const parsed = parseSkillKey(key);
      if (!parsed) {
        badKeys.add(key);
        continue;
      }
      debuffs.push({
        member: displayLabel(member),
        type: parsed.type,
        kind: parsed.kind,
        label: parsed.label,
        matchLabel: parsed.matchLabel,
        value: Number(value),
      });
    }
  }
  return { members, debuffs, badKeys: [...badKeys] };
}

/**
 * 解析主打手頁 → {
 *   members: string[],
 *   scores: [{member, type, category, score}],
 *   pairs:  [{member, label, grade}]   // 跨 36 類別以 (member,寶可夢) 去重取最高等級
 * }
 */
export function transformAttackerPage(html) {
  const scoresRaw = extractConst(html, "scores");
  const pokemonData = extractConst(html, "pokemon_data");

  const scores = [];
  const badKeys = new Set();
  for (const [catKey, rows] of Object.entries(scoresRaw)) {
    const parsed = parseCategoryKey(catKey);
    if (!parsed) {
      badKeys.add(catKey);
      continue;
    }
    for (const row of rows) {
      scores.push({
        member: displayLabel(row.name),
        type: parsed.type,
        category: parsed.category,
        score: Number(row.score),
      });
    }
  }

  const members = [...new Set(Object.keys(pokemonData).map(displayLabel))];
  // (member, pokemon) → 最高 grade (同拍組會出現在物/特兩類別)
  const best = new Map();
  for (const [member, cats] of Object.entries(pokemonData)) {
    const m = displayLabel(member);
    for (const [catKey, rows] of Object.entries(cats)) {
      if (!parseCategoryKey(catKey)) {
        badKeys.add(catKey);
        continue;
      }
      for (const row of rows) {
        const label = displayLabel(row.pokemon);
        const grade = GRADE_MAP[displayLabel(row.value)] ?? 0;
        const k = `${m} ${normKey(label)}`;
        const prev = best.get(k);
        if (!prev || grade > prev.grade) best.set(k, { member: m, label, grade });
      }
    }
  }
  return { members, scores, pairs: [...best.values()], badKeys: [...badKeys] };
}
