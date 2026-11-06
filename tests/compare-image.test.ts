// 成員頁「比較」的下載圖片 (2026-11-06 使用者:「幫我加個下載按鈕好了 可以匯出這張圖片」)。
// 圖是 canvas 自己畫的, 所以「圖跟畫面長得一樣」要靠這幾條守: 同一份資料、同一組顏色、同一張卡面、同一套零件。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const view = strip(read("src/app/gyms/[id]/members/compare-view.tsx"));
const image = strip(read("src/app/gyms/[id]/members/compare-image.ts"));

describe("下載圖片", () => {
  it("按鈕只在精簡表格出現, 畫的是畫面上那一份 groups (順序 / 排序 / 收起來的人都一樣)", () => {
    // 卡片表照舊自己截圖; 只有資源表時沒有卡片可言, 一律給下載
    expect(view).toMatch(/\{\(!cards \|\| !pairTables\) && ready \? \(\s*<Button[\s\S]{0,400}data-compare-download/);
    expect(view).toMatch(/exportCompareImage\(\s*\[\s*\.\.\.groups\.map\(/);
    expect(view).toMatch(/members: g\.columns\.map/);
    // 收起來的那一行: 與畫面同一支 restLine
    expect(view).toMatch(/restNote: restLine\(g\.rest, g\.rows\.length > 1, "沒有"\)/);
  });

  it("畫圖的程式按下去才載 (不進成員頁的首包)", () => {
    expect(view).toMatch(/await import\("\.\/compare-image"\)/);
    expect(view).not.toMatch(/^import[^;]*compare-image/m);
  });

  it("格子的字 = 畫面上那顆 GradeBadge 的字 (GRADE_LABELS), 寶數組回去的方式也是同一支", () => {
    expect(image).toMatch(/GRADE_LABELS\[g\]/);
    expect(view).toMatch(/grades: g\.rows\.map\(\(\{ cells \}\) => gradeOfCell\(cells\[mi\] \?\? null\)\)/);
    expect(view).toMatch(/const grade = gradeOfCell\(item\)/);
  });

  it("徽章顏色 = GradeBadge 的同一組 (改了畫面的顏色, 匯出圖要一起改)", () => {
    const ui = read("src/components/gym/gym-ui.tsx");
    const styles = ui.slice(ui.indexOf("const GRADE_STYLES"), ui.indexOf("};", ui.indexOf("const GRADE_STYLES")));
    const swatch = ui.slice(ui.indexOf("export const GRADE_SWATCH"), ui.indexOf("};", ui.indexOf("export const GRADE_SWATCH")));
    for (let g = 1; g <= 10; g++) {
      const color = styles.match(new RegExp(`\\n\\s*${g}: "bg-(\\w+)-`))?.[1];
      const name = swatch.match(new RegExp(`\\n\\s*${g}: \\{[^}]*name: "(\\w+)"`))?.[1];
      expect(color, `寶數 ${g}`).toBeTruthy();
      expect(name, `寶數 ${g}`).toBe(color);
    }
  });

  it("欄頭的卡面跟畫面同一支 cardImageUrl (不要自己拼檔名)", () => {
    expect(image).toMatch(/cardImageUrl\(p\.rec\)/);
    expect(image).not.toMatch(/\/reference\/card\//);
    expect(strip(read("src/components/sync-pair-card.tsx"))).toMatch(/const cardUrl = cardImageUrl\(pair, promo, !!ex\)/);
  });

  it("頭像 / 字型 / 斷行 / 下載跟排刀表的匯出圖是同一份 (components/gym/export-image.ts)", () => {
    const plan = strip(read("src/app/gyms/[id]/battles/[battleId]/battle-plan.tsx"));
    for (const src of [plan, image]) {
      expect(src).toMatch(/from "@\/components\/gym\/export-image"/);
      expect(src).not.toMatch(/function (drawAvatar|loadAvatars|loadImages|wrap|roundRect)\(/);
      expect(src).not.toMatch(/\.toBlob\(/);
    }
  });
});
