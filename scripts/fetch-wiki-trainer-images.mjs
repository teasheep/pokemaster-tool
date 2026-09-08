// 補「brybry 給的不是頭肩胸像」的訓練家立繪: fandom wiki 1024×1024 透明底全身圖 → 128×128
// 取景規格與判準見 lib-trainer-image.mjs 的檔頭。
//
// 名單與參數在 **src/data/trainer-art.json** (單一來源) —— 本機工具頁
// `/dev/trainer-art` 拉滑桿調完會直接寫回那個檔, 這支腳本讀它重跑。
//
// 這裡的 9 位都是**通用職業 NPC 或主角**: brybry 對他們給的是全身圖, 直接縮放會變成
// 「小人漂浮」, 與其他 460 張頭肩胸像放在同一面卡牆上很突兀
// (2026-09-08 使用者回報:「伊芙（寶可夢小朋友）」「所有包含主角的拍組」「長袖和服」)。
//
// **gain / dx / dy 是逐張目視定的, 不要改成自動偵測** (理由見 lib-trainer-image.mjs):
// 量頭寬會被誇張的髮型與裝扮騙 —— 華蓮的雙馬尾、伊芙的伊布耳朵、紗幽子的長髮都會被
// 算進「頭寬」, gain=1 時她們是整個人站在框裡。**gain 大 = 更近**。
//
// ⚠ 調完一定要用「卡片的可見範圍」看, **不要看裸圖** —— 卡片只顯示原圖的
//    x 20..108 / y 17..111 (見 lib-trainer-image.mjs 檔頭)。第一版就是比對裸圖收工的,
//    結果實際卡片上頭太大、人偏左。用 `npm run art:preview` 或本機工具頁。
//
// 用法:
//   npm run art:trainer          全部重跑
//   npm run art:trainer -- <id>  只跑指定的幾張
// 跑完記得補 `npm run data:webp` —— 線上只吃 .webp, PNG 不進部署 (public/.assetsignore)。

import { readFileSync, writeFileSync } from "node:fs";
import { alignToNative, sourceBuffer } from "./lib-trainer-image.mjs";

const OUT = new URL("../public/reference/trainer/", import.meta.url);
const DATA = new URL("../src/data/trainer-art.json", import.meta.url);

const { targets } = JSON.parse(readFileSync(DATA, "utf8"));
const only = process.argv.slice(2);
const todo = only.length ? targets.filter((t) => only.includes(t.id)) : targets;
if (!todo.length) {
  console.error(`找不到指定的 id: ${only.join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const t of todo) {
  try {
    const buf = await sourceBuffer(t.id, t.url);
    writeFileSync(
      new URL(`${t.id}_128.png`, OUT),
      await alignToNative(buf, { gain: t.gain, dx: t.dx, dy: t.dy })
    );
    console.log(`✓ ${t.id}  gain=${t.gain}${t.dx ? ` dx=${t.dx}` : ""}${t.dy ? ` dy=${t.dy}` : ""}  ${t.note}`);
  } catch (e) {
    console.error(`✗ ${t.id} (${t.note})`, e.message);
    failed++;
  }
}
if (failed) process.exitCode = 1;
console.log(`\n完成 ${todo.length - failed}/${todo.length}。記得跑 npm run data:webp (線上只吃 .webp)。`);
