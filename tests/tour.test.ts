// 使用教學的三條不變量。
//
// 為什麼值得寫測試: 這三條壞掉都是「教學自己壞掉」——
// 使用者第一次登入看到的東西壞了, 而我們不會有任何徵兆 (沒有錯誤、沒有紅字)。
//
//   1. **步驟指的 data-tour 必須真的存在於程式碼裡**。改版面時把某個
//      `data-tour="gym-create"` 刪掉/改名, 教學那一步就會靜靜降級成「置中說明卡」——
//      看起來只是「少框了一個東西」, 沒有人會發現是壞了。
//   2. **卡片不能被擺到畫面外**。手機視窗矮、目標又在最下面時最容易發生,
//      而那正是使用者最多的情境。
//   3. **左下角那一格要用卡片的寬度推底緣**, 不是容器高度 —— 容器還包著兩行卡名,
//      用高度算會把框掉到名字上 (「點左下角 = 寶數循環」那一步就指錯地方)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { calloutWidth, centerPlacement, cornerRect, placeCallout, EDGE } from "@/components/tour/tour-place";
import { TOURS, TRACKS, stepsFor, type TourTrack } from "@/components/tour/tour-steps";

// ── 1. 步驟指的目標都真的存在 ──

/** 掃出 src/ 底下所有寫在 data-tour 那一行的字串字面值 */
function declaredTourTargets(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        const text = fs.readFileSync(full, "utf8");
        if (!text.includes("data-tour")) continue;
        for (const line of text.split(/\r?\n/)) {
          if (!line.includes("data-tour")) continue;
          for (const m of line.matchAll(/"([^"]+)"/g)) found.add(m[1]);
        }
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  // 底部導覽列是 data-tour={t.tour} — 值寫在 TABS 那張表, 同一行看不到
  const bar = fs.readFileSync(path.join(process.cwd(), "src/components/mobile-tab-bar.tsx"), "utf8");
  for (const m of bar.matchAll(/tour: "([^"]+)"/g)) found.add(m[1]);
  return found;
}

describe("教學步驟指的東西真的存在", () => {
  const declared = declaredTourTargets();

  it("掃得到 data-tour (掃不到代表這個測試自己壞了)", () => {
    expect(declared.size).toBeGreaterThan(5);
  });

  for (const track of Object.keys(TOURS) as TourTrack[]) {
    it(`${track} 的每一步都指得到`, () => {
      for (const step of stepsFor(track)) {
        if (!step.target) continue;
        expect(declared, `${track}: ${step.target}`).toContain(step.target);
      }
    });
  }

  it("兩條路都有步驟, 每一步都有標題與內文", () => {
    expect(TRACKS.map((t) => t.id).sort()).toEqual(["leader", "member"]);
    for (const { id } of TRACKS) {
      const steps = stepsFor(id);
      expect(steps.length).toBeGreaterThan(0);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
      }
    }
  });

  it("沒有道館的人: 要去道館子頁的步驟回 null (留在原地, 降級成說明卡)", () => {
    const paths = stepsFor("leader").map((s) => s.path({ gymId: null }));
    // 第一步 (建立道館) 一定要能去; 後面幾步在沒有道館時不該亂導
    expect(paths[0]).toBe("/gyms?list=1");
    expect(paths.slice(1).every((p) => p === null)).toBe(true);
  });

  it("有道館的人: 道館子頁拼得出網址", () => {
    const paths = stepsFor("leader").map((s) => s.path({ gymId: "abc" }));
    expect(paths).toContain("/gyms/abc/members");
    expect(paths).toContain("/gyms/abc/battles");
  });

  it("/gyms 一定帶 list=1 — 只有一個道館時 /gyms 會轉導進去, 建立/加入那兩顆就不見了", () => {
    const all = [...stepsFor("leader"), ...stepsFor("member")].map((s) => s.path({ gymId: "abc" }));
    expect(all.some((p) => p === "/gyms")).toBe(false);
    expect(all).toContain("/gyms?list=1");
  });
});

// ── 2. 卡片擺放 ──

const VP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

describe("placeCallout", () => {
  it("下面放得下就放下面", () => {
    const target = { top: 100, left: 600, width: 120, height: 40 };
    const p = placeCallout({ target, viewport: VP, cardHeight: 160 });
    expect(p.top).toBe(100 + 40 + 12);
  });

  it("下面放不下就翻到上面", () => {
    const target = { top: 700, left: 600, width: 120, height: 40 };
    const p = placeCallout({ target, viewport: VP, cardHeight: 160 });
    expect(p.top).toBe(700 - 12 - 160);
  });

  it("底部導覽列佔掉的高度要讓開", () => {
    const target = { top: 560, left: 100, width: 80, height: 56 };
    const withBar = placeCallout({ target, viewport: PHONE, cardHeight: 200, bottomInset: 56 });
    // 目標下緣 616 + 12 + 200 = 828 > 844 - 56 - 8 → 必須翻到上面
    expect(withBar.top).toBe(560 - 12 - 200);
  });

  it("卡片永遠留在畫面裡 (含上下都塞不下的情況)", () => {
    const cases = [
      { top: 0, left: 0, width: 40, height: 40 },
      { top: 810, left: 1240, width: 40, height: 40 },
      { top: 10, left: 600, width: 100, height: 780 },
    ];
    for (const target of cases) {
      const p = placeCallout({ target, viewport: VP, cardHeight: 200 });
      expect(p.top).toBeGreaterThanOrEqual(EDGE);
      expect(p.left).toBeGreaterThanOrEqual(EDGE);
      expect(p.left + p.width).toBeLessThanOrEqual(VP.width - EDGE);
    }
  });

  it("手機: 卡片吃滿螢幕寬 (兩側各留 8px)", () => {
    expect(calloutWidth(PHONE.width)).toBe(PHONE.width - EDGE * 2);
    const p = placeCallout({
      target: { top: 100, left: 340, width: 40, height: 40 },
      viewport: PHONE,
      cardHeight: 180,
    });
    expect(p.left).toBe(EDGE);
  });

  it("桌機: 卡片不超過 380px, 而且對齊目標中心", () => {
    const p = placeCallout({
      target: { top: 100, left: 600, width: 120, height: 40 },
      viewport: VP,
      cardHeight: 160,
    });
    expect(p.width).toBe(380);
    expect(p.left).toBe(600 + 60 - 190);
  });

  it("沒有目標就置中", () => {
    const p = placeCallout({ target: null, viewport: VP, cardHeight: 200 });
    expect(p).toEqual(centerPlacement(VP, 200));
    expect(p.top).toBe(300);
  });
});

describe("cornerRect", () => {
  it("用寬度推卡片底緣, 不是容器高度 (容器還包著兩行卡名)", () => {
    // 卡片 96x96 + 卡名兩行 → 容器高度 128
    const box = cornerRect({ top: 200, left: 50, width: 96, height: 128 });
    expect(box.top + box.height).toBeLessThanOrEqual(200 + 96 + 2);
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    expect(box.left).toBeLessThan(50 + 44);
  });
});
