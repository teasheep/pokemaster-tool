// 成員頁的「比較」= 每個屬性一張表, 每一格是成員卡牆那一張卡 (不是文字); 手機與電腦的軸相反
// (2026-11-05 使用者:「不要單獨列 寶X Ex xx 這種」→「前面的那種表格好像也不錯 只是顯示按照拍組顯示」
//  →「最左邊的拍組名稱這樣顯示起來很醜」→「人員當作橫軸 拍組當作縱軸… 不同屬性就分不同個表」
//  →「手機電腦相反如果是為了 UX 是可接受的」)。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const view = read("src/app/gyms/[id]/members/compare-view.tsx");
const grid = read("src/components/gym/pair-type-grid.tsx");
const code = view.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fn = (name: string) => {
  const at = code.indexOf(`function ${name}(`);
  return code.slice(at, code.indexOf("\nfunction ", at + 10));
};

describe("比較的格子是卡牆的卡", () => {
  it("每一格畫 PairCell (卡牆 PairCardList 畫的也是它)", () => {
    expect(code).toContain("<PairCell");
    expect(grid).toMatch(/export const PairCell = memo/);
    expect(grid).toMatch(/<PairCell\s[\s\S]{0,40}key=\{it\.key\}/);
  });

  it("不另外用文字寫寶數 / 星數 / 等級", () => {
    expect(code).not.toMatch(/`寶\$\{|`覺\$\{|6★EX|`Lv\$\{|GRADE_LABELS/);
  });

  it("沒有的那格是灰卡 (owned: false), 不是空格", () => {
    expect(code).toMatch(/if \(!row\) return \{[^}]*owned: false/);
  });

  it("卡片點不了 (比較只讀, 不給 onSelect / onCount)", () => {
    const at = code.indexOf("<PairCell");
    expect(code.slice(at, code.indexOf("/>", at))).not.toMatch(/onSelect|onCount|onPromote/);
  });
});

describe("每個屬性一張表, 手機與電腦的軸相反", () => {
  it("每個屬性一段, 段裡兩張表: 手機那張 sm:hidden、電腦那張 max-sm:hidden", () => {
    expect(code).toMatch(/<section key=\{g\.key\}[\s\S]{0,1600}<PairsDownTable[\s\S]{0,400}<MembersDownTable/);
    expect(fn("PairsDownTable")).toMatch(/"sm:hidden"\)\} data-compare-layout="pairs-down"/);
    expect(fn("MembersDownTable")).toMatch(/"max-sm:hidden"\)\} data-compare-layout="members-down"/);
  });

  it("電腦: 一列一個人 (列頭是成員), 拍組在欄頭", () => {
    const t = fn("MembersDownTable");
    expect(t).toMatch(/<thead>[\s\S]*g\.rows\.map[\s\S]*<PairLabel[\s\S]*<\/thead>/);
    expect(t).toMatch(/<tbody>[\s\S]*columns\.map\(\(m, mi\)[\s\S]*scope="row"[\s\S]*memberCallName\(m\)/);
  });

  it("手機: 一列一組拍組, 人在欄頭; 拍組名是卡片上面橫跨整列的一行 (不是最左邊的窄欄)", () => {
    const t = fn("PairsDownTable");
    expect(t).toMatch(/<thead>[\s\S]*columns\.map[\s\S]*memberCallName\(m\)[\s\S]*<\/thead>/);
    expect(t).toMatch(/data-compare-label[\s\S]{0,200}colSpan=\{columns\.length\}[\s\S]{0,300}<PairLabel/);
    expect(t).not.toMatch(/scope="row"/);
  });

  it("「顯示」跟成員卡牆同一個網址參數", () => {
    expect(view).toMatch(/useUrlState\(\{[\s\S]{0,600}show: serializeCardInfo\(show\)/);
    expect(read("src/app/gyms/[id]/members/members-client.tsx")).toContain("show: initialView.show");
  });
});

describe("卡片跟著格子縮", () => {
  it("SyncPairCard 的 svg 有 max-w-full h-auto (手機卡牆 88px 的格子裝 96px 的卡會被切掉)", () => {
    const card = read("src/components/sync-pair-card.tsx");
    expect(card).toMatch(/<svg[\s\S]{0,400}"block h-auto max-w-full/);
  });
});
