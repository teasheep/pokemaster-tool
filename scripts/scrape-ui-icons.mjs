// 抓 pomatools battle/ui 資料夾的 type/role/EX 等 UI 素材
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const BASE = "https://pomatools.github.io";

const outDir = join(repoRoot, "public", "reference", "ui");
mkdirSync(outDir, { recursive: true });

const items = [
  // 18 屬性 icon
  ...Array.from({ length: 18 }, (_, i) => `battle/TYPE_${String(i + 1).padStart(3, "0")}.png`),
  // ROLE bitmask
  "battle/ROLE_001P.png",
  "battle/ROLE_001S.png",
  "battle/ROLE_002.png",
  "battle/ROLE_004.png",
  "battle/ROLE_008.png",
  "battle/ROLE_016.png",
  "battle/ROLE_032.png",
  "battle/ROLE_01.png",
  "battle/ROLE_02.png",
  "battle/ROLE_04.png",
  "battle/ROLE_08.png",
  "battle/ROLE_16.png",
  // EX 徽章
  "battle/6ex.png",
  "battle/6exmpty.png",
  // 主要 UI
  "sync_icon.png",
  "sync_level_on.png",
  "sync_level_off.png",
  "awakening.png",
  "awakening_level_on.png",
  "awakening_level_off.png",
  "theme.png",
];

let downloaded = 0;
let skipped = 0;
for (const it of items) {
  const filename = it.split("/").pop();
  const dest = join(outDir, filename);
  if (existsSync(dest)) {
    skipped++;
    continue;
  }
  try {
    const r = await fetch(`${BASE}/assets/img/${it}`);
    if (!r.ok) {
      console.warn(`  ${r.status} ${it}`);
      continue;
    }
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    downloaded++;
  } catch (e) {
    console.warn(`  fail ${it}: ${e.message}`);
  }
}
console.log(`done: ${downloaded} downloaded, ${skipped} cached`);
