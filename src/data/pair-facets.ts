// 上游 (pomasters/SyncPairsTracker) 帶進來的四個篩選面向的**繁中對照**。
//
// 資料由 scripts/patch-upstream-facets.mjs 寫進 catalog (weakType / themes / tags / moveTypes)。
// 這個檔只負責「英文值 → 使用者看得到的字」與**顯示順序**。
//
// ⚠ 兩條規則:
//  1. **catalog 裡出現的每一個值都要有繁中名** —— 少一個就是畫面上冒出英文
//     (AGENTS「使用者看得到的值一律繁中」)。`tests/pair-facets.test.ts` 掃全份 catalog 擋這件事,
//     所以上游改版加了新標籤時測試會變紅, 而不是默默上線。
//  2. 與既有面向重複的值**在腳本那一層就丟掉了** (屬性/地區/系列/取得管道), 不要在這裡復活。
//
// 譯名來源 (2026-09-10 逐條查證, 使用者要求):
//   場地效果四種都有官方 zh-TW 名 —— 天氣 / 場地 / 領域 / 鬥陣
//     (官方公告出現過「精神場地」「拳頭領域」「ＥＸ拳頭領域」「卡洛斯鬥陣（物理）」「關都鬥陣（特殊）」)。
//     ⚠ **上游的標籤名是它自己的代號, 不要照翻**: Wish Zone 在它畫面上只寫 Zone,
//       Region Circle 只寫 Circle —— 照代號翻會翻出遊戲裡不存在的詞 (第一版的「心願區域」就是這樣來的)。
//   Song Key (點播機的「樂曲鑰匙」) **整個丟掉** —— 那是音樂收藏不是戰鬥機制,
//     這個站用不到 (2026-09-10 使用者指定)。丟棄清單在 patch-upstream-facets.mjs。
//   Grid* 講的是**拍檔石盤被擴大**, 上游畫面上寫的是 "Has 3/5 exp." / "Retroactive expansion" /
//     "Mega expansion" —— 與格子的星級無關 (第一版翻成「3★格」是錯的)。
//   其餘照遊戲內既有用語 (屬性抵抗、御三家、Z招式、美極套裝、阿爾套裝、拍組招式、大師被動技能)。

/** 主題 (角色/造型/身分) — 上游 themes 扣掉屬性與地區之後的全集 */
export const THEME_LABELS: Record<string, string> = {
  // 身分 / 地位
  Champion: "冠軍",
  "Neo Champion": "新冠軍",
  "Elite Four": "四天王",
  "Gym Leader": "道館館主",
  "Trial Giver": "試煉隊長",
  Rival: "勁敵",
  Villain: "反派",
  "Villain Arc": "反派篇章",
  "Main Character": "主角",
  Researcher: "研究者",
  "Veteran Trainer": "資深訓練家",
  "Battle Partner": "對戰搭檔",
  "Battle Facility Foe": "對戰設施對手",
  "Battleground Foe": "戰場對手",
  "Team Rocket Forever": "火箭隊永遠不滅",
  "Team Star": "星塵隊",
  // 造型 / 服裝
  "Sygna Suit": "美極套裝",
  "Arc Suit": "阿爾套裝",
  "Seasonal Outfit": "季節服裝",
  "Special Costume": "特殊服裝",
  Masked: "戴面具",
  Glasses: "眼鏡",
  Sunglasses: "太陽眼鏡",
  Cape: "披風",
  Scarf: "圍巾",
  Pigtails: "雙馬尾",
  // 個性 / 興趣
  Artistic: "藝術",
  Beauty: "美人",
  "Body Builder": "健身",
  Contest: "華麗大賽",
  "Contest Lover": "華麗大賽愛好者",
  Cook: "廚師",
  "Free Spirit": "自由奔放",
  Gadgeteer: "發明家",
  "Grown Woman": "成熟女性",
  "Fancy Lady": "千金小姐",
  Knowledgeable: "博學",
  "Nature Lover": "自然愛好者",
  "Rock Lover": "岩石愛好者",
  "Old-Timer": "老前輩",
  "Passionate Spirit": "熱血",
  Pokéathlete: "寶可夢運動員",
  "Space Cadet": "天文迷",
  Supernatural: "靈異",
  "Sweet Tooth": "愛吃甜食",
  // 關係 / 出身
  "Complicated Family": "複雜的家庭",
  "Dragon Cousin": "龍系表親",
  "Hoenn Family": "豐緣一家",
  "Melemele Family": "美樂美樂一家",
  "Ninja Family": "忍者一家",
  "Observatory Cousin": "天文台表親",
  "Old Colleagues": "老同事",
  "Sinnoh Bros": "神奧兄弟",
  "Kalos Neighbors": "卡洛斯鄰居",
  "Unova Gym Besties": "合眾館主好友",
  // 地點 / 冒險篇章
  "Pallet Town": "真新鎮",
  "Undella Town": "未白鎮",
  "Lumiose City": "米亞雷市",
  "Pasio Academy": "帕希歐學園",
  "Blueberry Academy": "藍莓學園",
  "Academy Sync Pair": "學園拍組",
  "Alola Adventurer": "阿羅拉冒險",
  "Galar Adventurer": "伽勒爾冒險",
  "Hisui Adventurer": "洗翠冒險",
  "Unova Adventurer": "合眾冒險",
  "Legendary Adventures": "傳說冒險",
  Hisui: "洗翠",
};

/**
 * 標籤 (戰鬥機制 / 招式 / 寶可夢分類) — 分組是為了讓面板讀得下去,
 * 資料層沒有分組概念 (member 的 tags 就是一個扁平陣列)。
 */
export const TAG_GROUPS: { label: string; tags: string[] }[] = [
  {
    label: "招式分類",
    tags: [
      "AttackMovePhysical", "AttackMoveSpecial", "AttackMoveStatus",
      "SyncMovePhysical", "SyncMoveSpecial", "SyncMoveStatus",
      "Buddy Move", "ZMove", "MoveTypeStellar",
    ],
  },
  {
    label: "機制",
    tags: [
      "Weather", "WeatherEX", "Terrain", "TerrainEX",
      "Wish Zone", "Wish ZoneEX", "Region Circle",
      "Rebuff", "ItemBerry",
      "Master Passive", "Master Passive Flag Bearer", "Master Passive Pride",
      "Master Passive Spirit", "Master Passive Teamwork",
    ],
  },
  { label: "拍檔石盤", tags: ["Grid3", "Grid5", "GridExpansion", "GridMega"] },
  {
    label: "寶可夢",
    tags: ["Legendary", "Mythical", "Ultra Beast", "Paradox", "Starter", "Eeveelution", "Fossil", "Shiny"],
  },
  { label: "其他", tags: ["Unique Costume"] },
];

export const TAG_LABELS: Record<string, string> = {
  // 招式 —— 物理/特殊/變化是遊戲內的招式分類
  AttackMovePhysical: "物理招式",
  AttackMoveSpecial: "特殊招式",
  AttackMoveStatus: "變化招式",
  SyncMovePhysical: "物理同步招式",
  SyncMoveSpecial: "特殊同步招式",
  SyncMoveStatus: "變化同步招式",
  "Buddy Move": "拍組招式",
  ZMove: "Z招式",
  MoveTypeStellar: "星晶招式",
  // 場地效果 —— 官方 zh-TW 的三種寫法都查證過 (見檔頭的來源):
  //   天氣 (晴天/雨天) / 場地 (精神場地) / 領域 (拳頭領域・ＥＸ拳頭領域) / 鬥陣 (卡洛斯鬥陣（物理）)
  // 上游把「會開領域的拍組」叫 Wish Zone (它的畫面上只寫 Zone), 「會開鬥陣的」叫 Region Circle
  // (畫面上只寫 Circle) —— 我們照官方的效果名, 不照上游的內部代號。
  Weather: "天氣",
  WeatherEX: "EX 天氣",
  Terrain: "場地",
  TerrainEX: "EX 場地",
  "Wish Zone": "領域",
  "Wish ZoneEX": "EX 領域",
  "Region Circle": "鬥陣",
  Rebuff: "屬性抵抗", // 官方用語 (見 AGENTS「降抗整套待重做」)
  ItemBerry: "樹果",
  "Master Passive": "大師被動技能",
  "Master Passive Flag Bearer": "大師被動技能 · 掌旗",
  "Master Passive Pride": "大師被動技能 · 驕傲",
  "Master Passive Spirit": "大師被動技能 · 氣魄",
  "Master Passive Teamwork": "大師被動技能 · 團隊",
  // 拍檔石盤的擴大 —— 上游畫面上的字是 "Has 3/5 exp." / "Has 5/5 exp." / "Retroactive expansion" /
  // "Mega expansion", 講的是**拍檔石盤被擴大**這件事, 不是格子的星級 (第一版翻錯了)。
  Grid3: "擴大 3/5",
  Grid5: "擴大 5/5",
  GridExpansion: "後續追加擴大",
  GridMega: "擴大（超級進化）",
  // 寶可夢分類
  Legendary: "傳說寶可夢",
  Mythical: "幻之寶可夢",
  "Ultra Beast": "究極異獸",
  Paradox: "悖謬寶可夢",
  Starter: "御三家",
  Eeveelution: "伊布家族",
  Fossil: "化石寶可夢",
  Shiny: "異色",
  // 其他
  "Unique Costume": "專屬服裝",
};

/** 訓練家性別 —— 上游放在 tags, 但它自成一個面向 (與機制混在一起很難找) */
export const GENDER_TAGS = ["isMan", "isWoman"] as const;
export const GENDER_LABELS: Record<string, string> = {
  isMan: "男性",
  isWoman: "女性",
};

/** 主題的顯示順序 = 上面那份物件的鍵序 (身分 → 造型 → 個性 → 關係 → 地點) */
export const THEME_ORDER = Object.keys(THEME_LABELS);

/** 標籤的顯示順序 = 分組展開後的順序 */
export const TAG_ORDER = TAG_GROUPS.flatMap((g) => g.tags);

export function themeLabel(t: string): string {
  return THEME_LABELS[t] ?? t;
}
export function tagLabel(t: string): string {
  return TAG_LABELS[t] ?? GENDER_LABELS[t] ?? t;
}
