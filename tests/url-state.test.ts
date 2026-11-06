// 「重新整理要留在原本的畫面」的兩半:
//   1. **寫**: client 端把畫面狀態同步進網址 (useUrlState, 需要 DOM 這裡不測);
//   2. **讀**: server 端的 page.tsx 從 searchParams 讀回來當初始值 —— 這一半只要漏掉,
//      症狀就是使用者回報的那個: 網址看起來對, 重新整理卻跳回預設分頁。
//
// 這支測兩件沒有徵兆的事: pickParam 的收斂行為, 以及**兩邊的參數名要對得起來**
// (client 寫 `?tab=`、server 讀 `sp.view` 的話, 永遠不會有人發現, 只是重整就跳回去)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gymSectionOf } from "@/lib/gym/tab-memory";
import {
  parsePositions,
  parseShortIds,
  pickParam,
  resolveShortIds,
  serializePositions,
  serializeShortIds,
  shortId,
} from "@/lib/url-params";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("pickParam", () => {
  it("允許的值原樣留著", () => {
    expect(pickParam("all", ["gym", "all"] as const, "gym")).toBe("all");
    expect(pickParam("gym", ["gym", "all"] as const, "all")).toBe("gym");
  });

  it("不認得的值回預設 (使用者可以手改網址, 不能因此壞掉)", () => {
    expect(pickParam("nonsense", ["gym", "all"] as const, "gym")).toBe("gym");
    expect(pickParam(undefined, ["gym", "all"] as const, "gym")).toBe("gym");
    expect(pickParam("", ["gym", "all"] as const, "gym")).toBe("gym");
  });

  it("重複的參數 (?scope=a&scope=b) 取第一個", () => {
    expect(pickParam(["all", "gym"], ["gym", "all"] as const, "gym")).toBe("all");
  });
});

describe("一組 id / 第幾個 的網址值", () => {
  const A = "1a2b3c4d-0000-4000-8000-000000000001";
  const B = "9f8e7d6c-0000-4000-8000-000000000002";

  it("短碼來回: 寫出去再讀回來是同一組 (照原本清單的順序)", () => {
    const raw = serializeShortIds([B, A], [A]);
    expect(raw).toBe(`${shortId(B)},${shortId(A)}`);
    expect(resolveShortIds(parseShortIds(raw ?? undefined) ?? [], [A, B])).toEqual([A, B]);
  });

  it("等於預設就不寫; 全部取消寫 none —— 否則重整會被當成「沒帶」又選回預設", () => {
    expect(serializeShortIds([A], [A])).toBeNull();
    expect(serializeShortIds([], [A])).toBe("none");
    expect(parseShortIds("none")).toEqual([]);
    expect(parseShortIds(undefined)).toBeNull();
  });

  it("手改網址塞垃圾不會壞", () => {
    expect(parseShortIds("zz,<script>,1a2b3c4d")).toEqual(["1a2b3c4d"]);
    expect(parsePositions("3,1,x,0,99,3", 8)).toEqual([1, 3]);
    expect(serializePositions([])).toBeNull();
    expect(serializePositions([5, 2, 5])).toBe("2,5");
  });
});

describe("道館分頁記住上次停在哪 (2026-11-04)", () => {
  it("認得出是哪一館的哪個分頁; 全館拍組的舊路徑 /pairs 算在「成員與拍組」頭上", () => {
    expect(gymSectionOf("/gyms/abc/members")).toEqual({ gymId: "abc", section: "members" });
    expect(gymSectionOf("/gyms/abc/pairs")).toEqual({ gymId: "abc", section: "members" });
    expect(gymSectionOf("/gyms/abc/battles/xyz")).toEqual({ gymId: "abc", section: "battles" });
    expect(gymSectionOf("/gyms/abc/guides")).toBeNull();
    expect(gymSectionOf("/pairs")).toBeNull();
  });

  it("分頁連結吃記住的網址, 而 useUrlState 改網址時會通知它", () => {
    const tabs = read("src/app/gyms/[id]/gym-tabs.tsx");
    expect(tabs).toContain("rememberGymUrl");
    expect(tabs).toContain("href={isActive(t) ? t.href : (rememberedOf(t.section) ?? t.href)}");
    // server 那份要是空的 (= 固定連結), 不然 hydration 對不起來
    expect(tabs).toMatch(/useSyncExternalStore\([\s\S]{0,200}\(\) => ""\s*\)/);
    // 沒有這一行的話, 在同一頁裡選人 (replaceState) 不會被記下來, 只記得剛進來那一刻
    expect(read("src/lib/use-url-state.ts")).toContain("URL_STATE_EVENT");
  });

  it("重新整理的捲動還原掛在道館 layout 上", () => {
    expect(read("src/app/gyms/[id]/layout.tsx")).toContain("<ReloadScrollRestore />");
  });
});

describe("寫進網址的參數, server 端都要讀得回來", () => {
  it("成員頁的「比較」: 寫 cmp / types / pairs, page.tsx 就要讀 cmp / types / pairs 並傳下去", () => {
    const view = read("src/app/gyms/[id]/members/compare-view.tsx");
    const page = read("src/app/gyms/[id]/members/page.tsx");
    expect(view).toMatch(/useUrlState\(\{[\s\S]{0,200}cmp:[\s\S]{0,200}types:[\s\S]{0,200}pairs:/);
    for (const key of ["cmp", "types", "pairs", "sort", "cards", "res"]) {
      expect(page, `成員頁的 page.tsx 沒讀 ${key}`).toMatch(
        new RegExp(`searchParams[\\s\\S]{0,400}${key}\\?:`)
      );
    }
    expect(page).toContain("compareMembers: parseCompareMembers(sp.cmp)");
    expect(page).toContain("compareTypes: parseCompareTypes(sp.types)");
    expect(page).toContain("comparePairs: parseComparePairs(sp.pairs)");
    expect(page).toContain('compareCards: sp.cards === "1"');
    expect(view).toMatch(/useUrlState\(\{[\s\S]{0,600}cards: cards \? "1" : null/);
    expect(read("src/app/gyms/[id]/members/members-client.tsx")).toContain("pairs: initialView.comparePairs");
    expect(read("src/app/gyms/[id]/members/members-client.tsx")).toContain("cards: initialView.compareCards");
    expect(page).toContain("compareRes: parseCompareRes(sp.res)");
    expect(view).toMatch(/useUrlState\(\{[\s\S]{0,700}res: serializeCompareRes\(res\)/);
    expect(read("src/app/gyms/[id]/members/members-client.tsx")).toContain("res: initialView.compareRes");
  });

  it("道館戰一覽: 寫 open (展開了哪幾場), page.tsx 就要讀 open", () => {
    const client = read("src/app/gyms/[id]/battles-index-client.tsx");
    const page = read("src/app/gyms/[id]/battles/page.tsx");
    expect(client).toMatch(/useUrlState\(\{\s*open:/);
    expect(page).toMatch(/searchParams[\s\S]{0,300}open\?:/);
    expect(page).toContain("initialOpen={parseShortIds(sp.open)}");
  });

  it("賽事頁: 看板的收合 (fold / done / ahead) 與開著的側板 (panel) 都要讀得回來", () => {
    const board = read("src/app/gyms/[id]/battles/[battleId]/stage-board.tsx");
    const client = read("src/app/gyms/[id]/battles/[battleId]/battle-client.tsx");
    const page = read("src/app/gyms/[id]/battles/[battleId]/page.tsx");
    expect(board).toMatch(/useUrlState\(\{\s*fold:[\s\S]{0,80}done:[\s\S]{0,80}ahead:/);
    expect(client).toMatch(/useUrlState\(\{[\s\S]{0,120}panel:/);
    for (const key of ["panel", "fold", "done", "ahead"]) {
      expect(page, `賽事頁的 page.tsx 沒讀 ${key}`).toMatch(
        new RegExp(`searchParams[\\s\\S]{0,400}${key}\\?:`)
      );
    }
    // 讀回來要真的傳到看板, 不是停在 battle-client
    expect(client).toContain("initialView={initialBoardView}");
    // 收合狀態要在看板那一層 —— 卡片自己的 useState 寫不進網址, 一重新整理就沒了
    expect(board).not.toMatch(/const \[showAllRounds, setShowAllRounds\] = useState/);
    expect(board).not.toMatch(/const \[showFuture, setShowFuture\] = useState/);
  });

  it("/pairs: 寫 tab / owned, page.tsx 就要讀 tab / owned", () => {
    const client = read("src/app/pairs/pairs-hub.tsx");
    const page = read("src/app/pairs/page.tsx");
    expect(client, "pairs-hub 沒有同步網址").toContain("useUrlState");
    for (const key of ["tab", "owned"]) {
      expect(page, `/pairs 的 page.tsx 沒讀 ${key}`).toMatch(
        new RegExp(`searchParams[\\s\\S]{0,200}${key}\\?:`)
      );
    }
    // 讀回來要真的傳下去, 不是讀了放著
    expect(page).toContain("initialTab");
    expect(page).toContain("initialOwnedOnly");
  });

  it("道館成員頁: 寫 member / view / scope / owned, page.tsx 就要讀同樣那四個", () => {
    const client = read("src/app/gyms/[id]/members/members-client.tsx");
    const page = read("src/app/gyms/[id]/members/page.tsx");
    expect(client, "members-client 沒有同步網址").toContain("useUrlState");
    for (const key of ["member", "view", "scope", "owned"]) {
      expect(page, `成員頁的 page.tsx 沒讀 ${key}`).toMatch(
        new RegExp(`searchParams[\\s\\S]{0,300}${key}\\?:`)
      );
    }
    expect(page).toContain("initialView");
  });

  it("道館紀錄: 寫 member / kind / days / from / to, page.tsx 就要讀同樣那五個", () => {
    // 2026-09-10 加回來的分頁 (2026-08-17 曾下架)。五個篩選都要留得住,
    // 不然「看某個人上個月改了什麼」重整一次就跳回預設的近 30 天全員。
    const client = read("src/app/gyms/[id]/activity/activity-client.tsx");
    const page = read("src/app/gyms/[id]/activity/page.tsx");
    expect(client, "activity-client 沒有同步網址").toContain("useUrlState");
    for (const key of ["member", "kind", "days", "from", "to"]) {
      expect(page, `道館紀錄的 page.tsx 沒讀 ${key}`).toMatch(
        new RegExp(`searchParams[\\s\\S]{0,300}${key}\\?:`)
      );
    }
    expect(page).toContain("initialDays");
    // 入口要真的在導覽列上 (前科: 功能還在但 tabs 沒有 = 使用者找不到)
    expect(read("src/app/gyms/[id]/gym-tabs.tsx")).toContain("/activity");
    // 而且 next.config 不可以還把它轉導走
    expect(read("next.config.ts")).not.toMatch(/source:\s*"\/gyms\/:id\/activity"/);
  });

  it("賽事頁: 寫 rules (標題列的「規則」開關), page.tsx 就要讀 rules, 看板要拿到開關狀態", () => {
    // 2026-09-28 加: 開關預設關, 開了之後重整或把連結貼給別人都要留在「開」
    const board = read("src/app/gyms/[id]/battles/[battleId]/stage-board.tsx");
    const page = read("src/app/gyms/[id]/battles/[battleId]/page.tsx");
    const client = read("src/app/gyms/[id]/battles/[battleId]/battle-client.tsx");
    expect(client, "battle-client 沒有同步網址").toMatch(/useUrlState\(\{\s*rules:/);
    expect(page, "賽事頁的 page.tsx 沒讀 rules").toMatch(/searchParams[\s\S]{0,300}rules\?:/);
    expect(page).toContain("initialShowRules");
    // 開關在標題列、畫 tag 的是看板 —— 漏傳的話網址對、開關也亮了, 看板卻永遠沒有 tag
    expect(client).toMatch(/showRules=\{showRules\}/);
    for (const f of [board, client]) expect(f).not.toContain("useSearchParams");
  });

  it("初始值一律由 server 傳下來 — client 不可以自己讀 useSearchParams (會 hydration mismatch)", () => {
    for (const f of [
      "src/app/pairs/pairs-hub.tsx",
      "src/app/gyms/[id]/members/members-client.tsx",
      "src/app/gyms/[id]/pairs/pairs-client.tsx",
      "src/app/gyms/[id]/members/compare-view.tsx",
      "src/app/gyms/[id]/battles-index-client.tsx",
      "src/app/gyms/[id]/battles/[battleId]/battle-client.tsx",
      "src/app/gyms/[id]/battles/[battleId]/stage-board.tsx",
      "src/app/gyms/[id]/gym-tabs.tsx",
    ]) {
      expect(read(f), `${f} 用了 useSearchParams`).not.toContain("useSearchParams");
    }
  });

  it("**server 的 page.tsx 不可以 import 標了 use client 的模組** (前科: 整頁炸掉)", () => {
    // 2026-09-08: pickParam 本來跟 useUrlState 放在同一個 "use client" 檔案裡,
    // server component 一呼叫就是
    //   「Attempted to call pickParam() from the server but pickParam is on the client」
    // —— tsc 與 lint 都不會擋, 只有實際開頁面才看得到。
    // 只看檔案開頭的**指示詞**, 不是內文提到的字 (註解裡會寫「這支不可以標 use client」)
    const directive = (p: string) => read(p).trimStart().startsWith('"use client"');
    expect(directive("src/lib/url-params.ts"), "url-params 不該標 use client").toBe(false);
    // 成員頁「比較」的參數 (page.tsx 要呼叫它的 parse)、分頁記憶 (use-url-state 要 import 它的事件名)
    expect(directive("src/lib/gym/compare-params.ts"), "compare-params 不該標 use client").toBe(false);
    expect(directive("src/lib/gym/tab-memory.ts"), "tab-memory 不該標 use client").toBe(false);
    expect(directive("src/lib/use-url-state.ts"), "hook 檔要標 use client").toBe(true);
    // 2026-09-10 又踩了一次: 道館紀錄的值域本來放在 activity-client.tsx (use client),
    // server 的 page.tsx import 到的是 client reference 不是陣列 →
    // 「allowed.includes is not a function」整頁掛掉。
    expect(
      directive("src/app/gyms/[id]/activity/activity-filters.ts"),
      "activity-filters 不該標 use client (page.tsx 要 import 它的陣列)"
    ).toBe(false);
    expect(
      read("src/app/gyms/[id]/activity/page.tsx"),
      "道館紀錄的 page.tsx 從 client 檔 import 了值域"
    ).toMatch(/ACTIVITY_KINDS[\s\S]{0,120}from "\.\/activity-filters"/);
    for (const f of ["src/app/pairs/page.tsx", "src/app/gyms/[id]/members/page.tsx"]) {
      expect(read(f), `${f} 直接 import 了 client 專用的 use-url-state`).not.toContain(
        "@/lib/use-url-state"
      );
    }
  });

  it("**訪客不吃 ?owned=1** — 他沒有那顆開關, 吃了會看到空白圖鑑而且救不回來", () => {
    // 前科 (2026-09-08): 成員把 /pairs?owned=1 貼給別人 / 自己登出後回到同一個網址,
    // 會看到「沒有符合的拍組」而且畫面上沒有任何辦法關掉那個篩選 (/pairs 是公開路由)。
    expect(read("src/app/pairs/page.tsx")).toMatch(/initialOwnedOnly=\{signedIn && owned === "1"\}/);
  });

  it("**從網址掛載成 scope=all 時要自己補抓整本圖鑑**", () => {
    // 前科 (2026-09-08): 抓整本只掛在 switchScope 的點擊上, 從網址直接掛載會顯示一份
    // 「只有 146 隻」的假全圖鑑 —— 沒有載入中也沒有錯誤, 使用者以為站上沒收錄那隻拍組。
    for (const f of [
      "src/app/gyms/[id]/members/members-client.tsx",
      "src/app/gyms/[id]/pairs/pairs-client.tsx",
    ]) {
      expect(read(f), `${f} 少了掛載時補抓整本圖鑑`).toMatch(/askedFull/);
    }
  });

  it("用 replaceState 不是 pushState (切分頁不該塞滿上一頁的歷史)", () => {
    const hook = read("src/lib/use-url-state.ts");
    expect(hook).toContain("history.replaceState");
    expect(hook, "用了 pushState — 按上一頁會變成一次退一個分頁").not.toContain(
      "history.pushState"
    );
  });
});
