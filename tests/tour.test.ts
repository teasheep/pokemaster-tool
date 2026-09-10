// 使用教學的不變量。
//
// 為什麼值得寫測試: 這些壞掉都是「教學自己壞掉」—— 使用者第一次登入看到的東西壞了,
// 而畫面上不會有任何錯誤或紅字。
//
//   1. **步驟指的 data-tour 必須真的存在於程式碼裡**。改版面時把某個
//      `data-tour="gym-create"` 刪掉/改名, 那一步就會靜靜降級成置中的說明卡,
//      而且互動步驟會永遠等不到使用者「點對地方」。
//   2. **教學期間所有寫入都要被吞掉**, 而且 `shouldSwallow` 絕對不能碰 `/auth/v1/`
//      —— 吞掉 token 刷新就是把人登出。
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
import {
  TOUR_WRITE_MESSAGE,
  setTourWritesBlocked,
  shouldSwallow,
  swallowResponse,
  tourWritesBlocked,
} from "@/lib/supabase/tour-writes";

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

// ── 2. 互動 / 串接 / 教學期間不寫入 ──

describe("互動與串接", () => {
  it("成員那條主要是「換你點」, 不是一路按下一步", () => {
    const steps = stepsFor("member");
    const interactive = steps.filter((s) => s.advance.on !== "next");
    expect(interactive.length).toBeGreaterThanOrEqual(4);
  });

  it("道館戰接在成員與負責人後面, 而且不出現在一開始的選擇卡 (不強迫看)", () => {
    expect(trackDef("member").next).toBe("battle");
    // 負責人那條 2026-09-09 拆成兩段: 第一段在「去建道館」結束 (教學裡建不了館),
    // 道館戰因此接在**續集** leader2 後面。
    expect(trackDef("leader").next).toBeUndefined();
    expect(trackDef("leader2").next).toBe("battle");
    expect(CHOOSABLE).not.toContain("battle");
    // leader2 也不在選擇卡上 —— 還沒有道館的人選了只會看到一堆框不到的東西
    expect(CHOOSABLE).toEqual(["leader", "member"]);
  });

  it("負責人那條在「去建道館」就交棒, 續集要接得回來", () => {
    const leader = trackDef("leader");
    // handoff = 先結束教學讓他真的去建 (教學開著時所有寫入都被吞掉, 建館一定失敗)
    expect(leader.handoff?.resume).toBe("leader2");
    expect(leader.handoff?.label).toBeTruthy();
    // 第一步是分叉: 沒有建館碼的人不該被帶到牆前面才知道
    const gate = leader.steps[0].gate;
    expect(gate, "第一步要問「有沒有建館碼」").toBeTruthy();
    expect(gate!.denied.body).toContain("封測");
    // **不要在教學文字裡寫信箱或 GitHub** (使用者 2026-09-09 指定: 那兩個只給懂程式的人
    // 自己從隱私權政策/服務條款找)
    for (const t of TRACKS) {
      for (const s of t.steps) {
        const text = `${s.title}${s.body}${s.gate?.denied.body ?? ""}${s.extra?.body ?? ""}`;
        expect(text, `${t.id} 的步驟裡出現了聯絡管道`).not.toMatch(/@|github|gmail/i);
      }
    }
  });

  it("有一步教「怎麼看館內其他人的拍組」", () => {
    const steps = stepsFor("member");
    expect(steps.some((s) => s.target === "member-row")).toBe(true);
  });

  it("步驟上不該再有「哪幾步才擋寫入」的旗標 —— 規則是整段教學都擋", () => {
    for (const t of TRACKS) {
      for (const s of t.steps) {
        expect(Object.keys(s), `${t.id}: ${s.title}`).not.toContain("practice");
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

describe("教學一打開就吞寫入, 提示也必須同時出現", () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), "src/components/tour/tour-runner.tsx"),
    "utf8"
  );

  it("**膠囊的條件是 s.open 不是 running**", () => {
    // 前科 (2026-09-08): 寫入從 setTourWritesBlocked(s.open) 就開始吞, 但膠囊只在
    // running 時畫 → 新成員第一次登入看到選擇卡、不理它、直接按「用邀請碼加入」,
    // 得到紅字「加入失敗」而畫面上沒有任何字說是教學擋的。整層 pointer-events:none,
    // 他本來就點得到那些按鈕。
    expect(runner).toContain("setTourWritesBlocked(s.open)");
    // 膠囊那一段的條件
    const capsule = runner.slice(runner.indexOf("ref={barRef}") - 800, runner.indexOf("ref={barRef}"));
    expect(capsule, "膠囊還在用 running 當條件").toMatch(/\{s\.open \? \(/);
  });

  it("指路要跳過「指回使用者已經在的那一頁」的候選", () => {
    // 前科: 人停在 /gyms 而目標在 /gyms/<id>/members 時, 鏈條退到「道館」那一格,
    // 框住他現在就站在上面的入口 → 那一步永遠完成不了。
    expect(runner, "wayHop 沒有比對 hop.to").toMatch(/h\.to \? pathname !== h\.to : true/);
  });
});

describe("教學期間吞寫入 — 絕對不能碰 auth", () => {
  const REST = "https://x.supabase.co/rest/v1/user_collection";
  const AUTH = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";

  it("關著的時候什麼都不吞", () => {
    setTourWritesBlocked(false);
    expect(tourWritesBlocked()).toBe(false);
    expect(shouldSwallow(REST, "POST")).toBe(false);
  });

  it("開著時吞 rest 的寫入, 但讀取照過", () => {
    setTourWritesBlocked(true);
    expect(shouldSwallow(REST, "POST")).toBe(true);
    expect(shouldSwallow(REST, "PATCH")).toBe(true);
    expect(shouldSwallow(REST, "DELETE")).toBe(true);
    expect(shouldSwallow(REST, "GET")).toBe(false);
    expect(shouldSwallow(REST, "HEAD")).toBe(false);
  });

  it("**token 刷新是 POST /auth/v1/ — 吞掉就是把人登出**", () => {
    setTourWritesBlocked(true);
    expect(shouldSwallow(AUTH, "POST")).toBe(false);
    expect(shouldSwallow("https://x.supabase.co/auth/v1/logout", "POST")).toBe(false);
    setTourWritesBlocked(false);
  });

  it("一般寫入回「成功但沒有列」—— 樂觀更新留在畫面上, 不跳錯誤 toast", async () => {
    setTourWritesBlocked(true);
    const res = swallowResponse(REST, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    setTourWritesBlocked(false);
  });

  it("**.single() 的寫入必須回錯誤**: 呼叫端會拿裡面的 id 去導頁 (建立賽事), 假成功會導到不存在的頁", async () => {
    setTourWritesBlocked(true);
    const res = swallowResponse(REST, {
      method: "POST",
      headers: { Accept: "application/vnd.pgrst.object+json" },
    });
    expect(res.ok).toBe(false);
    expect((await res.json()).message).toBe(TOUR_WRITE_MESSAGE);
    // Headers 物件與陣列形式也要認得 (supabase-js 內部可能兩種都用)
    expect(
      swallowResponse(REST, {
        headers: new Headers({ Accept: "application/vnd.pgrst.object+json" }),
      }).ok
    ).toBe(false);
    setTourWritesBlocked(false);
  });

  it("**RPC 必須回錯誤**: create_gym / join_gym 拿回傳的 id 導頁, 假成功會導去 /gyms/", async () => {
    setTourWritesBlocked(true);
    const res = swallowResponse("https://x.supabase.co/rest/v1/rpc/create_gym", {
      method: "POST",
    });
    expect(res.ok).toBe(false);
    expect((await res.json()).message).toBe(TOUR_WRITE_MESSAGE);
    setTourWritesBlocked(false);
  });

  it("**storage 必須回錯誤**: 假成功會讓 uploadAvatar 回傳指向不存在檔案的網址 (頭貼破圖)", async () => {
    setTourWritesBlocked(true);
    const res = swallowResponse("https://x.supabase.co/storage/v1/object/avatars/u.webp", {
      method: "POST",
    });
    expect(res.ok).toBe(false);
    expect((await res.json()).message).toBe(TOUR_WRITE_MESSAGE);
    setTourWritesBlocked(false);
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

it("頂端的狀態膠囊佔掉的高度也要讓開 (不然卡片會被它蓋住)", () => {
    const target = { top: 4, left: 600, width: 120, height: 8 };
    const p = placeCallout({ target, viewport: VP, cardHeight: 160, topInset: 40 });
    expect(p.top).toBeGreaterThanOrEqual(40 + EDGE);
    // 沒有目標時的置中也要讓
    const c = centerPlacement({ width: 390, height: 200 }, 300, 40);
    expect(c.top).toBeGreaterThanOrEqual(40 + EDGE);
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

  it("**教學結束前要先丟掉還在等的合併寫入**", () => {
    // 2026-09-10 差點破的紅線: 連點合併之後那一趟 fetch 是延後才發的,
    // closeTour() 先解除攔截的話, 計時器醒來時就真的寫進資料庫了
    // (而且 swallowedWrites() 是 0, 連重新載入清樂觀更新都不會做)。
    const store = fs.readFileSync(
      path.join(process.cwd(), "src/components/tour/tour-store.ts"),
      "utf8"
    );
    expect(store, "closeTour 沒有丟掉還在等的寫入").toContain("dropPendingCoalescedWrites()");
    // 順序: drop 一定要在解除攔截之前
    const dropAt = store.indexOf("dropPendingCoalescedWrites()");
    const unblockAt = store.indexOf("setTourWritesBlocked(false)");
    expect(dropAt, "drop 必須排在 setTourWritesBlocked(false) 之前").toBeLessThan(unblockAt);
    // 而且那支函式要真的存在
    expect(
      fs.readFileSync(path.join(process.cwd(), "src/lib/pairs/use-coalesced-write.ts"), "utf8")
    ).toContain("export function dropPendingCoalescedWrites");
  });
});
