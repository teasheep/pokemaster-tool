// 補 brybry 缺圖 NPC 訓練家立繪: fandom wiki 1024x1024 透明底 → 128x128
// 處理規格共用 lib-trainer-image.mjs (頭肩帶裁切 + cover, 對齊 brybry 遊戲縮圖取景)
import { writeFileSync } from "node:fs";
import { toTrainer128 } from "./lib-trainer-image.mjs";

const OUT = "C:/code/pokemon-master-inventory/public/reference/trainer";

const TARGETS = [
  ["ch0351_00_shione", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/1/10/Furisode_Girl_3.png/revision/latest?cb=20250105072546&format=original"], // Blossom
  ["ch0363_00_asami", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/e/ef/Furisode_Girl_4.png/revision/latest?cb=20251226014519&format=original"], // Linnea
  ["ch0652_68_sayoko", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/e/e9/Hex_Maniac.png/revision/latest?cb=20220926182000&format=original"], // Helena
  ["ch0653_68_kirika", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/9/9e/Furisode_Girl_1.png/revision/latest?cb=20221227040416&format=original"], // Kali
  ["ch0658_00_karen", "https://static.wikia.nocookie.net/pokemon-masters-ex-game/images/6/60/Furisode_Girl_2.png/revision/latest?cb=20231227073845&format=original"], // Katherine
];

for (const [id, url] of TARGETS) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
  if (!res.ok) { console.error(id, "HTTP", res.status); process.exitCode = 1; continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${OUT}/${id}_128.png`, await toTrainer128(buf));
  console.log(id, "OK");
}
