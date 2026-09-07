// 使用教學的不變量。
//
// 為什麼值得寫測試: 這些壞掉都是「教學自己壞掉」—— 使用者第一次登入看到的東西壞了,
// 而畫面上不會有任何錯誤或紅字。
//
//   1. **步驟指的 data-tour 必須真的存在於程式碼裡**。改版面時把某個
//      `data-tour="gym-create"` 刪掉/改名, 那一步就會靜靜降級成置中的說明卡,
//      而且互動步驟會永遠等不到使用者「點對地方」。
//   2. **練習模式只能開在真的會寫資料的那幾步**, 而且 `shouldSwallow` 絕對不能碰
//      `/auth/v1/` —— 吞掉 token 刷新就是把人登出。
//   3. **卡片不能被擺到畫面外** (手機視窗矮、目標在最下面時最容易發生)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  calloutWidth,
  centerPlacement,
  cornerRect,
  placeCallout,
  EDGE,
} from "@/components/tour/tour-place";
import {
  CHOOSABLE,
  TRACKS,
  onPage,
  resolveAt,
  stepsFor,
  trackDef,
  wayTo,
} from "@/components/tour/tour-steps";
import { setWritesBlocked, shouldSwallow, writesBlocked } from "@/lib/supabase/practice-mode";

// ── 1. 步驟指的目標都真的存在 ──

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
  // 底部導覽列與道館分頁是 data-tour={t.tour} — 值寫在各自那張表, 同一行看不到
  for (const f of ["src/components/mobile-tab-bar.tsx", "src/app/gyms/[id]/gym-tabs.tsx"]) {
    const text = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    for (const m of text.matchAll(/tour: "([^"]+)"/g)) found.add(m[1]);
  }
  return found;
}

describe("教學步驟指的東西真的存在", () => {
  const declared = declaredTourTargets();

  it("掃得到 data-tour (掃不到代表這個測試自己壞了)", () => {
    expect(declared.size).toBeGreaterThan(8);
  });

  for (const track of TRACKS) {
    it(`${track.id}: 每一步框的目標與等待的目標都指得到`, () => {
      for (const step of track.steps) {
        if (step.target) expect(declared, `${track.id}: ${step.target}`).toContain(step.target);
        if (step.advance.on === "appear") {
          expect(declared, `${track.id}: appear ${step.advance.target}`).toContain(
            step.advance.target
          );
        }
        // 條件式補充說明依賴的那個控制項也要存在, 否則那段話永遠不會出現
        if (step.extra) {
          expect(declared, `${track.id}: extra ${step.extra.ifTarget}`).toContain(
            step.extra.ifTarget
          );
          expect(step.extra.body.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it("每一步都有標題與內文", () => {
    for (const t of TRACKS) {
      expect(t.steps.length).toBeGreaterThan(0);
      for (const s of t.steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── 2. 互動 / 串接 / 練習模式 ──

describe("互動與串接", () => {
  it("成員那條主要是「換你點」, 不是一路按下一步", () => {
    const steps = stepsFor("member");
    const interactive = steps.filter((s) => s.advance.on !== "next");
    expect(interactive.length).toBeGreaterThanOrEqual(4);
  });

  it("道館戰接在成員與負責人後面, 而且不出現在一開始的選擇卡 (不強迫看)", () => {
    expect(trackDef("member").next).toBe("battle");
    expect(trackDef("leader").next).toBe("battle");
    expect(CHOOSABLE).not.toContain("battle");
    expect(CHOOSABLE).toEqual(["leader", "member"]);
  });

  it("有一步教「怎麼看館內其他人的拍組」", () => {
    const steps = stepsFor("member");
    expect(steps.some((s) => s.target === "member-row")).toBe(true);
  });

  it("練習模式只開在 /pairs 那幾步 (那裡才有我們打算吞掉的寫入)", () => {
    for (const t of TRACKS) {
      for (const s of t.steps) {
        if (s.practice) expect(s.at, `${t.id}: ${s.title}`).toBe("/pairs");
      }
    }
  });

  it("要去建立/加入道館的步驟一定帶 ?list=1 — 只有一個道館時 /gyms 會轉導進去", () => {
    for (const t of TRACKS) {
      for (const s of t.steps) {
        if (s.target === "gym-create" || s.target === "gym-join") {
          expect(s.at).toBe("/gyms?list=1");
        }
      }
    }
  });

  it("resolveAt: 沒有道館時道館子頁回 null (那一步就不提供「幫我開」)", () => {
    expect(resolveAt("gym:/members", null)).toBe(null);
    expect(resolveAt("gym:/members", "abc")).toBe("/gyms/abc/members");
    expect(resolveAt("/pairs", null)).toBe("/pairs");
    expect(resolveAt(undefined, "abc")).toBe(null);
  });
});

describe("練習模式吞寫入 — 絕對不能碰 auth", () => {
  const REST = "https://x.supabase.co/rest/v1/user_collection";
  const AUTH = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";

  it("關著的時候什麼都不吞", () => {
    setWritesBlocked(false);
    expect(writesBlocked()).toBe(false);
    expect(shouldSwallow(REST, "POST")).toBe(false);
  });

  it("開著時吞 rest 的寫入, 但讀取照過", () => {
    setWritesBlocked(true);
    expect(shouldSwallow(REST, "POST")).toBe(true);
    expect(shouldSwallow(REST, "PATCH")).toBe(true);
    expect(shouldSwallow(REST, "DELETE")).toBe(true);
    expect(shouldSwallow(REST, "GET")).toBe(false);
    expect(shouldSwallow(REST, "HEAD")).toBe(false);
  });

  it("**token 刷新是 POST /auth/v1/ — 吞掉就是把人登出**", () => {
    setWritesBlocked(true);
    expect(shouldSwallow(AUTH, "POST")).toBe(false);
    expect(shouldSwallow("https://x.supabase.co/auth/v1/logout", "POST")).toBe(false);
    setWritesBlocked(false);
  });
});

describe("不在那一頁時的指路 (wayTo)", () => {
  const declared = declaredTourTargets();

  it("每一步的 at 都指得出一條路, 而且路上的每個入口都真的存在", () => {
    for (const t of TRACKS) {
      for (const step of t.steps) {
        if (!step.at) continue;
        const at = resolveAt(step.at, "abc")!;
        const chain = wayTo(at);
        expect(chain.length, `${t.id}: ${step.title} 沒有路可指`).toBeGreaterThan(0);
        for (const hop of chain) {
          expect(declared, `${t.id}: hop ${hop.target}`).toContain(hop.target);
          expect(hop.title.length).toBeGreaterThan(0);
          expect(hop.body.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("候選由內而外 —— 最後一個一定是導覽列那一格 (最外層的保底)", () => {
    for (const at of ["/pairs", "/resources", "/gyms/abc/members", "/gyms/abc/battles", "/gyms?list=1"]) {
      const chain = wayTo(at);
      expect(chain.at(-1)!.target.startsWith("nav-"), at).toBe(true);
    }
  });

  it("道館子頁先指分頁, 指不到才退回「道館」那一格", () => {
    expect(wayTo("/gyms/abc/battles").map((h) => h.target)).toEqual([
      "gym-tab-battles",
      "nav-gyms",
    ]);
    expect(wayTo("/gyms/abc/members").map((h) => h.target)).toEqual([
      "gym-tab-members",
      "nav-gyms",
    ]);
  });

  it("「加入 / 建立道館」藏在切換器選單裡 → 選單沒開就先指切換器本身", () => {
    expect(wayTo("/gyms?list=1").map((h) => h.target)).toEqual([
      "gym-switcher-add",
      "gym-switcher",
      "nav-gyms",
    ]);
  });

  it("onPage 一律精確比對 —— 進到某個道館不算「在道館列表」", () => {
    expect(onPage("/gyms", "/gyms?list=1")).toBe(true);
    expect(onPage("/gyms/abc/members", "/gyms?list=1")).toBe(false);
    expect(onPage("/gyms/abc/members", "/gyms/abc/members")).toBe(true);
    expect(onPage("/pairs", "/pairs")).toBe(true);
    expect(onPage("/resources", "/pairs")).toBe(false);
  });
});

// ── 3. 卡片擺放 ──

const VP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

describe("placeCallout", () => {
  it("下面放得下就放下面", () => {
    const target = { top: 100, left: 600, width: 120, height: 40 };
    expect(placeCallout({ target, viewport: VP, cardHeight: 160 }).top).toBe(100 + 40 + 12);
  });

  it("下面放不下就翻到上面", () => {
    const target = { top: 700, left: 600, width: 120, height: 40 };
    expect(placeCallout({ target, viewport: VP, cardHeight: 160 }).top).toBe(700 - 12 - 160);
  });

  it("底部導覽列佔掉的高度要讓開", () => {
    const target = { top: 560, left: 100, width: 80, height: 56 };
    const p = placeCallout({ target, viewport: PHONE, cardHeight: 200, bottomInset: 56 });
    expect(p.top).toBe(560 - 12 - 200);
  });

  it("卡片永遠留在畫面裡", () => {
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

  it("手機吃滿螢幕寬, 桌機最多 380 且對齊目標中心", () => {
    expect(calloutWidth(PHONE.width)).toBe(PHONE.width - EDGE * 2);
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
  });
});

describe("cornerRect", () => {
  it("用寬度推卡片底緣, 不是容器高度 (容器還包著兩行卡名)", () => {
    const box = cornerRect({ top: 200, left: 50, width: 96, height: 128 });
    expect(box.top + box.height).toBeLessThanOrEqual(200 + 96 + 2);
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
  });
});
