// 卡面圖的兩條「壞掉沒有徵兆」的規則 (2026-09-10)。
//
// 使用者回報:「從成員與拍組移動到隊伍庫時, 很多拍組圖沒有被載出來, 一定要重新整理才會有」
// 與「隊伍庫那邊加寶數還是會卡頓, 拍組那邊好一點, 你不是處理過了嗎?」
//
// 查的時候實測到的 (線上, 隔離測試道館):
//   隊伍庫 (20 支隊伍 = 60 張卡, 與線上同規模):
//   **軟導覽 60 張只有 11 張看得到, 49 張透明; 硬重整 60 張全透明**。圖其實都載好了, 只是透明。
//   ⚠ 規模小的時候不會重現 (6 張卡時軟導覽是好的) —— 重現這條一定要用真實規模的資料。
// 「透明」與「沒有圖」在畫面上一模一樣, 所以這種壞法不會有人講得清楚, 只會說「圖沒出來」。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("卡面淡入不可以把卡片鎖成隱形", () => {
  const src = read("src/components/sync-pair-card.tsx");

  it("有一顆 HTMLImageElement 去問快取, 不是只靠 <image onLoad>", () => {
    // 紅了怎麼辦: 把那個 effect 加回去。只靠 onLoad 的話,
    // **SSR 出來的 <image href> 在 hydration 之前就載完了**, load 事件早就燒掉,
    // React 才掛監聽器 → artLoaded 永遠 false → 整張卡 opacity:0。
    expect(src).toContain("new Image()");
    expect(src).toMatch(/probe\.addEventListener\("load"/);
  });

  it("**監聽器要先掛, src 最後才設**", () => {
    // 反過來寫就白做了: 設 src 的當下快取命中的圖就會把 load 排進佇列, 而我們還沒訂閱。
    const at = src.indexOf("const probe = new Image()");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("}, [showArt", at));
    expect(block.indexOf('addEventListener("load"')).toBeLessThan(block.indexOf("probe.src ="));
  });

  it("**error 也要放行** — 圖 404 時不能留下一張隱形的卡", () => {
    expect(src).toMatch(/probe\.addEventListener\("error"/);
  });

  it("淡入本身還在 (使用者要的: 篩完不要用閃的出現)", () => {
    expect(src).toMatch(/artLoaded \? "opacity-100" : "opacity-0"/);
  });

  it("左下角計數有穩定的 QA 把手", () => {
    // 那一格沒有可及名稱, 用 class/巢狀去選一改版就爛掉 (qa:gymcode 的前科)
    expect(src).toContain('"data-count-hit"');
  });
});

describe("隊伍庫加寶數要合併寫入", () => {
  const src = read("src/components/gym/team-sheet.tsx");

  it("走 useCoalescedWrite (與 /pairs 同一條)", () => {
    // 前科: 每點一次寶數 = upsert → delete → 重抓整份 teams+team_pairs,
    // 三趟跨太平洋的往返序列跑完數字才會動, 而且還在 saveQueue 裡排隊。
    expect(src).toContain("useCoalescedWrite");
    expect(src).toContain("scheduleTeamPairs");
  });

  it("畫面是樂觀更新 — PairPicker 是全受控的, 沒有本地鏡像就一定要等網路", () => {
    expect(src).toContain("draftPairs");
    expect(src).toMatch(/setDraftPairs\(\(d\) => \(\{ \.\.\.d, \[teamId\]: picked \}\)\)/);
  });

  it("**成功之後不要重抓** (與 members-client 的 writeGrade 同一條規矩)", () => {
    const at = src.indexOf("const flushTeamPairs");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("const scheduleTeamPairs", at));
    // onChanged 只該出現在 catch 裡 (失敗才回滾重抓)
    const onChangedAt = body.indexOf("onChanged()");
    const catchAt = body.indexOf("} catch");
    expect(onChangedAt, "flush 裡沒有 onChanged? 那失敗時不會回滾").toBeGreaterThan(0);
    expect(onChangedAt, "成功路徑不可以重抓").toBeGreaterThan(catchAt);
  });

  it("upsert 與 delete 平行送 (兩者的列不重疊)", () => {
    expect(src).toContain("await Promise.all(jobs)");
  });

  it("樂觀值的 key 沿用同一格的舊 id (換 key 會讓卡片重掛載, 圖閃一下)", () => {
    expect(src).toMatch(/rows\.find\(\(r\) => r\.slot === i \+ 1\)\?\.id/);
  });
});
