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

import { pickParam } from "@/lib/url-params";

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

describe("寫進網址的參數, server 端都要讀得回來", () => {
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

  it("初始值一律由 server 傳下來 — client 不可以自己讀 useSearchParams (會 hydration mismatch)", () => {
    for (const f of [
      "src/app/pairs/pairs-hub.tsx",
      "src/app/gyms/[id]/members/members-client.tsx",
      "src/app/gyms/[id]/pairs/pairs-client.tsx",
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
    expect(directive("src/lib/use-url-state.ts"), "hook 檔要標 use client").toBe(true);
    for (const f of ["src/app/pairs/page.tsx", "src/app/gyms/[id]/members/page.tsx"]) {
      expect(read(f), `${f} 直接 import 了 client 專用的 use-url-state`).not.toContain(
        "@/lib/use-url-state"
      );
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
