// 道館拍組名單的三條不變量 —— 全部都是「**兩個管理員同時在改**」才會壞的東西,
// 而且三條壞掉都**沒有徵兆**: 不會有錯誤、不會有載入中, 只是名單少幾張卡,
// 或是按下 ★ 跳出一句資料庫的英文錯誤。
//
// 2026-09-09 使用者同時回報了兩個症狀, 根因是同一件事:
//   「管理員設定完道館拍組, 我的道館拍組分頁沒有一起變」
//   「duplicate key value violates unique constraint gym_pairs_gym_id_pair_label_key」
//   (使用者自己的判斷:「有可能是兩個管理員同時進去新增造成的」—— 正是如此)
//
// 端對端的證明在 `npm run qa:gympair` (兩個真的管理員帳號 + 真的瀏覽器)。
// 這裡釘的是「程式碼有沒有保留那三個機制」, 因為那支要有 dev server 才能跑。

import fs from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("加入道館拍組必須是冪等的", () => {
  // 紅了怎麼辦: 改回 upsert + ignoreDuplicates。用 insert 的話, 第二個按下去的管理員
  // 會拿到 23505 的原文錯誤, 而他很可能再按一次 —— 那一次是 delete, 反而把名單弄掉。
  it("setGymPair 用 on conflict do nothing, 不是裸 insert", () => {
    const src = read("src/lib/gym/gym-pairs-client.ts");
    expect(src, "少了 ignoreDuplicates").toContain("ignoreDuplicates: true");
    expect(src, "衝突鍵要對上 unique (gym_id, pair_label)").toContain(
      'onConflict: "gym_id,pair_label"'
    );
    expect(src, "不要再用裸 insert (衝突會變成 409 + 原文錯誤)").not.toMatch(
      /from\("gym_pairs"\)\s*\.insert\(/
    );
  });
});

describe("畫面上的名單要跟著伺服器走", () => {
  // 紅了怎麼辦: 把 `useState(() => new Set(...))` 旁邊那段「props 變了就調整 state」加回去。
  // useState 的初始值**只在第一次掛載時算**, 而這些面板在切成員/切分頁時不一定重新掛載 →
  // 另一位管理員加的拍組要整頁重新載入才看得到。
  //
  // 比對的是 join 出來的**字串**不是陣列: server 每次渲染都給新陣列, 比對陣列身分
  // 會每次都重設, 把樂觀更新洗掉。
  // 寫在 render 期間 (不是 effect) 是 React 官方對這件事的作法, 而且
  // react-hooks/set-state-in-effect 會擋 effect 版本 —— 不要改回 useEffect。
  const PANELS = [
    "src/app/gyms/[id]/members/members-client.tsx",
    "src/app/gyms/[id]/pairs/pairs-client.tsx",
    "src/app/pairs/pairs-hub.tsx",
  ];
  for (const file of PANELS) {
    it(`${file} 的道館名單有跟著 props 同步`, () => {
      const src = read(file);
      expect(src, "少了 gymPairKey 這條同步").toContain("gymPairKey");
      expect(src, "少了『props 變了就調整 state』的比對").toMatch(
        /seenGymPairKey !== gymPairKey/
      );
    });
  }
});

describe("名單更新了也要畫得出來", () => {
  // 紅了怎麼辦: 把「名單裡有子集沒有的 pairId 就 load 整本圖鑑」那個 effect 加回去。
  // 成員頁的 catalog 是**進頁面當下**算的子集 (道館名單 ∪ 全館持有), 別人後來加的拍組
  // 不在裡面 —— 名單同步了、gymSet 也對了, 卡片還是不會出現 (這次最難查的一段)。
  it("成員頁在名單出現子集外的拍組時會自動補抓整本圖鑑", () => {
    const src = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(src).toContain("loadFullCatalog");
    expect(src, "要有『名單裡有子集沒有的 id』這個判斷").toMatch(
      /gymPairIds\.some\(\(id\) => !have\.has\(id\)\)/
    );
  });

  it("成員頁回到分頁時會重抓道館名單", () => {
    const src = read("src/app/gyms/[id]/members/members-client.tsx");
    expect(src).toContain("visibilitychange");
    expect(src).toContain("setRefetched");
  });
});
