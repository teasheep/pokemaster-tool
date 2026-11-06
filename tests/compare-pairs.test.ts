// 比較的「指定拍組」+ 成員「全部」+ 點拍組名排序 (2026-11-06 使用者:
//  「如果要看特定 2-3 隻拍組的持有情況跟寶數 就要這樣分別點開來然後再截圖判斷」「人員應該要可以選全部」
//  「比較的UI再改 好醜 然後選拍組的下拉選單怎麼長那樣 不要亂長」
//  「比較的格子最好還可以點選排序 排序的對象可以不只一個」「第一組按照寶數高低下去排 第二組在第一組成立的前提下去排」)。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPARE_ALL,
  MAX_COMPARE_PAIRS,
  parseCompareMembers,
  parseComparePairs,
  resolveCompareMembers,
  serializeCompareMembers,
  serializeComparePairs,
} from "@/lib/gym/compare-params";
import { shortId } from "@/lib/url-params";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const view = strip(read("src/app/gyms/[id]/members/compare-view.tsx"));

const A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "33333333-cccc-4ccc-8ccc-cccccccccccc";

describe("?cmp=all", () => {
  it("名冊上的人全選了寫 all (不是一串短碼), 讀回來是名冊上的每一個人", () => {
    expect(serializeCompareMembers([A, B, C], [A], [A, B, C])).toBe(COMPARE_ALL);
    expect(parseCompareMembers("all")).toBe(COMPARE_ALL);
    // 之後加入的新成員也算在「全部」裡
    expect(resolveCompareMembers(COMPARE_ALL, [A, B, C, "44444444-dddd"])).toHaveLength(4);
  });

  it("沒全選照舊寫短碼; 等於預設 (只選自己) 照舊不留", () => {
    expect(serializeCompareMembers([A, B], [A], [A, B, C])).toBe([A, B].map(shortId).join(","));
    expect(serializeCompareMembers([A], [A], [A, B, C])).toBeNull();
    // 只有一個人的館: 全部 = 預設, 不留
    expect(serializeCompareMembers([A], [A], [A])).toBeNull();
  });

  it("成員那一排最前面是「全部」", () => {
    expect(view).toMatch(/<PickRow label="成員">\s*<Chip active=\{allPicked\} onClick=\{toggleAll\}/);
  });
});

describe("?pairs= / ?sort=", () => {
  it("照網址順序、去重、擋掉怪字串、最多 MAX_COMPARE_PAIRS 組", () => {
    expect(parseComparePairs("b,a,b")).toEqual(["b", "a"]);
    expect(parseComparePairs("ok_1,<script>,x y")).toEqual(["ok_1"]);
    expect(parseComparePairs(undefined)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`).join(",");
    expect(parseComparePairs(many)).toHaveLength(MAX_COMPARE_PAIRS);
  });

  it("寫回去是同一個順序 (排序的層次就是這個順序), 沒選就不留", () => {
    expect(serializeComparePairs(["b", "a"])).toBe("b,a");
    expect(serializeComparePairs([])).toBeNull();
  });

  it("server 端讀 sort 並傳下去", () => {
    expect(read("src/app/gyms/[id]/members/page.tsx")).toContain("compareSort: parseComparePairs(sp.sort)");
    expect(read("src/app/gyms/[id]/members/members-client.tsx")).toContain("sort: initialView.compareSort");
    expect(view).toMatch(/useUrlState\(\{[\s\S]{0,400}sort: serializeComparePairs\(sort\)/);
  });
});

describe("指定拍組不亂長", () => {
  it("跟屬性表格是同一張表, 不是另外一個矩陣元件", () => {
    expect(view).not.toMatch(/PickedPairsMatrix/);
    expect(view).toMatch(/out\.push\(build\("picked", null, pairRecs/);
  });

  it("挑拍組用隊伍庫那一塊搜尋面板 (PairPicker 開出來的同一個元件)", () => {
    expect(view).toMatch(/<PairSearchPanel/);
    const picker = read("src/components/gym/pair-picker.tsx");
    expect(picker).toMatch(/export function PairSearchPanel\(/);
    // PairPicker 自己也是用它, 兩邊不會走鐘
    expect(strip(picker)).toMatch(/export function PairPicker\([\s\S]*<PairSearchPanel[\s\S]*export function PairSearchPanel\(/);
  });

  it("點「拍組」那一排與面板以外的地方 = 收起 (「點其他位置的時候是不是應該收起來」, 與 PairPicker 同一套)", () => {
    expect(view).toMatch(/document\.addEventListener\("mousedown", onDown\);\s*document\.addEventListener\("touchstart", onDown\)/);
    expect(view).toMatch(/!pairPickRef\.current\.contains\(e\.target as Node\)\) setPickingPair\(false\)/);
    // 那一排 (＋ 拍組 / 已選拍組的 ×) 與面板都在同一個 ref 裡, 點它們不算外面
    expect(view).toMatch(/<div ref=\{pairPickRef\}[\s\S]{0,200}<PickRow label="拍組">[\s\S]*<PairSearchPanel[\s\S]{0,600}\) : null\}\s*<\/div>/);
  });

  it("已選的拍組是跟成員 / 屬性同一種 Chip", () => {
    expect(view).toMatch(/pairRecs\.map\(\(p\) => \(\s*<Chip key=\{p\.pairId\} active/);
  });

  it("有最多組的人排前面; 一組都沒有的人收成表格下面一行", () => {
    expect(view).toMatch(/b\.n - a\.n \|\| b\.sum - a\.sum/);
    expect(view).toMatch(/data-compare-rest[\s\S]{0,80}\{restLine\(g\.rest, g\.rows\.length > 1, "沒有"\)\}/);
    // 畫面與匯出圖是同一句
    expect(view).toContain('return `其餘 ${rest.length} 人${many ? "都" : ""}${verb}：${rest.map(memberCallName).join("、")}`;');
  });
});

describe("預設是精簡表格 (2026-11-06「還是不能一眼看完」「你看我貼的圖 至少要比那個好」)", () => {
  const fnBody = (name: string) => {
    const at = view.indexOf(`function ${name}(`);
    return view.slice(at, view.indexOf("\nfunction ", at + 10));
  };

  it("沒選卡片就畫 DenseTable; 卡片表要 ?cards=1", () => {
    expect(view).toMatch(/: !cards \? \(\s*<DenseTable/);
    expect(read("src/app/gyms/[id]/members/page.tsx")).toContain('compareCards: sp.cards === "1"');
  });

  it("一列一個人 (手機也是), 列高 36px (「橫列可以再高一點點 不然看起來頭像太擠」)、頭像 28px (AGENTS 的密集列尺寸)", () => {
    const t = fnBody("DenseTable");
    expect(t).toMatch(/<tbody>[\s\S]*g\.columns\.map\(\(m, mi\)[\s\S]*<MemberHead m=\{m\} \/>/);
    expect(fnBody("MemberHead")).toMatch(/scope="row"[\s\S]*<MemberAvatar[^>]*h-7 w-7/);
    expect(t).toMatch(/<td[^>]*className="h-9 /);
    expect(t).not.toMatch(/sm:hidden|max-sm:hidden/);
  });

  it("格子跟「全館拍組」側板的持有者 chip 同一顆 GradeBadge (「就跟側邊欄一樣顯示 badge 寶幾」)", () => {
    expect(fnBody("DenseCell")).toContain("<GradeBadge grade={grade} />");
    expect(read("src/app/gyms/[id]/pairs/pairs-client.tsx")).toContain("<GradeBadge grade={grade} />");
    // 六角 + 6★EX 星那一版「太亂了」—— 不要再畫回去
    expect(fnBody("DenseCell")).not.toMatch(/GradeGlyph|pex_ex|<img/);
  });

  it("0-10 那條軸組回去: 超覺醒 n = 5 + n, 否則就是寶數", () => {
    expect(fnBody("gradeOfCell")).toContain(
      "(item.superAwakening ?? 0) > 0 ? 5 + item.superAwakening! : (item.potential ?? 0)",
    );
  });

  it("「顯示」只在卡片表出現 (精簡畫不出等級 / 石盤 / 潛能)", () => {
    expect(view).toMatch(/\{cards \? <CardInfoSelect/);
  });

  it("屬性表也一樣: 一組都沒有的人收成下面那一行", () => {
    expect(view).toMatch(/ordered\.filter\(ownsAny\), ordered\.filter\(\(m\) => !ownsAny\(m\)\)/);
  });
});

describe("點拍組名排序, 可以疊好幾層", () => {
  it("一層一層比寶數 (高到低), 前一層同分才看下一層; 全部同分照名冊", () => {
    expect(view).toMatch(/for \(const id of activeSort\) \{\s*const d = valueOf\(b, id\) - valueOf\(a, id\);\s*if \(d\) return d;/);
    expect(view).toMatch(/bySort\(a, b\) \|\| roster\.get\(a\.id\)! - roster\.get\(b\.id\)!/);
  });

  it("點一下加到最後一層, 再點一下拿掉", () => {
    expect(view).toMatch(/sort: s\.sort\.includes\(id\) \? s\.sort\.filter\(\(x\) => x !== id\) : \[\.\.\.s\.sort, id\]/);
  });

  it("手機 (拍組那一行) 與電腦 (欄頭) 的拍組名都是排序鈕", () => {
    for (const name of ["PairsDownTable", "MembersDownTable"]) {
      const at = view.indexOf(`function ${name}(`);
      const body = view.slice(at, view.indexOf("\nfunction ", at + 10));
      expect(body, name).toMatch(/<SortButton[\s\S]{0,200}onClick=\{\(\) => onSort\(rec\.pairId\)\}[\s\S]{0,200}<PairLabel/);
    }
  });

  it("精簡表格的欄頭也是排序鈕", () => {
    const at = view.indexOf("function DenseTable(");
    const body = view.slice(at, view.indexOf("\nfunction ", at + 10));
    expect(body).toMatch(/<SortButton[\s\S]{0,120}onClick=\{\(\) => onSort\(rec\.pairId\)\}/);
  });

  it("卡片本身還是點不了 (比較只讀; 點得動的只有拍組名)", () => {
    const at = view.indexOf("<PairCell");
    expect(view.slice(at, view.indexOf("/>", at))).not.toMatch(/onSelect|onCount|onPromote/);
  });
});
