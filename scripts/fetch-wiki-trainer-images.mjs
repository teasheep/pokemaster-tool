// 補「brybry 給的不是頭肩胸像」的訓練家立繪: fandom wiki 1024×1024 透明底全身圖 → 128×128
// 取景規格與判準見 lib-trainer-image.mjs 的檔頭。
//
// 這裡列的 9 位都是**通用職業 NPC 或主角** —— brybry 對他們給的是全身/半身圖,
// 直接縮放會變成「小人漂浮」, 與其他 460 張頭肩胸像放在同一面卡牆上很突兀
// (2026-09-08 使用者回報:「伊芙（寶可夢小朋友）」「所有包含主角的拍組」「長袖和服」)。
//
// **gain / dx / dy 是逐張目視定的, 不要改成自動偵測** (理由見 lib-trainer-image.mjs):
// 量頭寬會被誇張的髮型與裝扮騙 —— 華蓮的雙馬尾、伊芙的伊布耳朵、紗幽子的長髮都會被
// 算進「頭寬」, gain=1 時她們是整個人站在框裡。**gain 大 = 更近**。
//
// ⚠ 調完一定要用「卡片的可見範圍」預覽, **不要看裸圖** —— 卡片只顯示原圖的
//    x 20..108 / y 17..111 (見 lib-trainer-image.mjs 檔頭)。第一版就是比對裸圖收工的,
//    結果實際卡片上頭太大、人偏左。
//
// 跑完記得補 `npm run data:webp` —— 線上只吃 .webp, PNG 不進部署 (public/.assetsignore)。
//
// ⚠ 新增拍組後怎麼發現又有這種圖: 掃 public/reference/trainer 的 alpha,
//    **下緣有留白** (人物沒被下框裁到) 就是全身圖。原生胸像一律是 0。
//    tests/trainer-art.test.ts 會自動擋下來。

import { writeFileSync } from "node:fs";
import { alignToNative } from "./lib-trainer-image.mjs";

const OUT = new URL("../public/reference/trainer/", import.meta.url);

/** [trainerId, 原圖網址, { gain, dx?, dy? }, 備註] */
const TARGETS = [
  // 長袖和服少女 (Furisode Girl) — 四位共用同一套職業立繪, 各自不同編號
  ["ch0653_68_kirika", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/9/9e/Furisode_Girl_1.png/revision/latest?cb=20221227040416&format=original", { gain: 2.2 }, "桐華 Kali"],
  ["ch0658_00_karen", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/6/60/Furisode_Girl_2.png/revision/latest?cb=20231227073845&format=original", { gain: 2.4 }, "華蓮 Katherine"],
  ["ch0351_00_shione", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/1/10/Furisode_Girl_3.png/revision/latest?cb=20250105072546&format=original", { gain: 1.3 }, "汐音 Blossom"],
  ["ch0363_00_asami", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/e/ef/Furisode_Girl_4.png/revision/latest?cb=20251226014519&format=original", { gain: 1.15 }, "亞莎美 Linnea"],
  // 靈異迷 (Hex Maniac)
  ["ch0652_68_sayoko", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/e/e9/Hex_Maniac.png/revision/latest?cb=20220926182000&format=original", { gain: 1.75, dx: 38 }, "紗幽子 Helena"],
  // 主角 (官方預設男主角 Scottie) — 11 個 player-* 拍組共用這一張
  ["chp000_00_player", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/4/4b/Scottie.png/revision/latest", { gain: 1 }, "主角 Scottie"],
  // 寶可夢小朋友 (Poké Kid) — 檔名帶重音, 是 Poké 不是 Poke
  ["ch0656_00_ibu", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/f/fa/Pok%C3%A9_Kid_Female.png/revision/latest?cb=20231221070512&format=original", { gain: 1.3, dx: 32 }, "伊芙 Eve (伊布連帽裝)"],
  ["ch0657_00_chusuke", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/4/46/Pok%C3%A9_Kid_Male.png/revision/latest?cb=20240211065103&format=original", { gain: 1.3, dx: 20 }, "丘助 Petey (皮卡丘連帽裝)"],
  // 登山男 (Hiker) — 只有一張通用立繪, 上傳於 2022 但拍組 2025 才實裝
  ["ch0364_00_masahito", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/a/a9/Hiker.png/revision/latest?cb=20220318142155&format=original", { gain: 0.85 }, "勇仁 Teddy"],
];

let failed = 0;
for (const [id, url, opts, note] of TARGETS) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!res.ok) {
      console.error(`✗ ${id} (${note}) HTTP ${res.status}`);
      failed++;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(new URL(`${id}_128.png`, OUT), await alignToNative(buf, opts));
    console.log(`✓ ${id}  gain=${opts.gain}${opts.dx ? ` dx=${opts.dx}` : ""}${opts.dy ? ` dy=${opts.dy}` : ""}  ${note}`);
  } catch (e) {
    console.error(`✗ ${id} (${note})`, e.message);
    failed++;
  }
}
if (failed) process.exitCode = 1;
console.log(`\n完成 ${TARGETS.length - failed}/${TARGETS.length}。記得跑 npm run data:webp (線上只吃 .webp)。`);
