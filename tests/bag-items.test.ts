// 背包 (member_candies) 的三條不變量。
//
// 為什麼值得寫測試 —— 三種壞法在畫面上都幾乎沒有徵兆:
//   1. UI 的種類多過 migration 的 check → 那一格按 ＋ 只會 toast「更新失敗」,
//      其他 12 格正常, 沒有人會想到是資料庫的值域少一種 (0036 那 5 種就是反過來:
//      check 加了但 UI 沒接, 從 2026-08 到今天一次都沒出現在畫面上)。
//   2. 少一張圖 → 那一格是破圖, 而本機開發時圖檔還在, 只有部署後才看得到。
//   3. 骨架的格數與實際分組對不上 → 資料一到整片重排 (skeletons.tsx 沒有 "use client",
//      不能 import candy.tsx, 所以那邊的數字是手抄的)。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CANDY_GROUPS, CANDY_LABELS, CANDY_TYPES } from "@/components/gym/candy";

const root = process.cwd();
/**
 * **最後一次**定義 member_candies 的 candy_type check 的那一份 migration。
 * 不要寫死檔名 —— 值域每加一次道具就換一份 (0015 → 0036 → 0064 → 0074),
 * 釘死檔名的話下次加道具時這支測試會對著一份過期的清單說「通過」。
 */
const sql = (() => {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const hit = files.filter((f) =>
    fs.readFileSync(path.join(dir, f), "utf8").includes("member_candies_candy_type_check check")
  );
  if (hit.length === 0) throw new Error("migrations 裡找不到 member_candies 的 candy_type check");
  return fs.readFileSync(path.join(dir, hit[hit.length - 1]), "utf8");
})();

describe("背包道具", () => {
  it("每一種都在**最新那份** check 的值域裡", () => {
    // 先把 -- 註解整行拿掉 —— 值域清單裡每一行都帶註解, 而註解裡有括號
    // (「招式糖 (依角色)」), 不先剝掉的話會在第一個右括號就把清單切斷。
    const bare = sql.replace(/--.*/g, "");
    const head = "candy_type in (";
    const i = bare.indexOf(head);
    expect(i).toBeGreaterThan(-1);
    const body = bare.slice(i + head.length, bare.indexOf(")", i));
    const allowed = body.split("'").filter((_, k) => k % 2 === 1);
    // check 是「值域的全集」不是選單: 0015 的 7 + 0036 的 5 + 0064 的 6 + 0074 的 5
    expect(allowed).toHaveLength(23);
    for (const t of CANDY_TYPES) expect(allowed).toContain(t);
    // 0036 那 5 種照舊在值域裡但**沒有圖**, 所以刻意不在 UI 上 —— 哪天補了圖再接
    for (const t of ["potential_cookie", "potential_scroll", "champion_spirit", "legendary_spirit", "skill_feather"]) {
      expect(allowed, `${t} 不該從值域裡消失`).toContain(t);
      expect(CANDY_TYPES as readonly string[], `${t} 還沒有圖, 不該上 UI`).not.toContain(t);
    }
  });

  it("每一種都有圖與繁中名稱", () => {
    for (const t of CANDY_TYPES) {
      const img = path.join(root, "public/reference/ui/candy", `${t}.webp`);
      expect(fs.existsSync(img), `缺圖: ${t}.webp`).toBe(true);
      expect(CANDY_LABELS[t], `缺名稱: ${t}`).toBeTruthy();
    }
  });

  it("分組沒有重複也沒有漏掉", () => {
    const flat = CANDY_GROUPS.flatMap((g) => g.types);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toEqual(CANDY_TYPES);
  });

  it("底盤顏色要有圖, 沒指定的就是金盤", () => {
    // 遊戲裡每個道具坐在哪一種圓盤上是固定的 (那就是稀有度): 0 藍綠 / 3 金 / 8 紅。
    // 2026-09-11 使用者:「兩個證是紅色的外框, 兩個券是一般藍綠色外框」。
    const src = fs.readFileSync(path.join(root, "src/components/gym/candy.tsx"), "utf8");
    for (const c of ["item_plate", "item_plate_red", "item_plate_teal"]) {
      expect(fs.existsSync(path.join(root, "public/reference/ui", c + ".webp")), "缺底盤: " + c).toBe(true);
      expect(src, "candy.tsx 沒有用到 " + c).toContain(c + ".webp");
    }
    // PLATE 裡列到的 key 都要是真的道具 (打錯字就是靜靜掉回金盤)
    const block = src.slice(src.indexOf("const PLATE:"), src.indexOf("const PLATE_SRC"));
    for (const m of block.matchAll(/^s{2}(w+):/gm)) {
      expect(CANDY_TYPES as readonly string[], "PLATE 裡的 " + m[1] + " 不是道具").toContain(m[1]);
    }
  });
  it("骨架的格數與分組一致", () => {
    const src = fs.readFileSync(path.join(root, "src/components/skeletons.tsx"), "utf8");
    const m = src.match(/\{\[([\d, ]+)\]\.map\(\(n, gi\)/);
    expect(m, "skeletons.tsx 找不到背包骨架的格數陣列").not.toBeNull();
    const counts = m![1]!.split(",").map((n) => Number(n.trim()));
    expect(counts).toEqual(CANDY_GROUPS.map((g) => g.types.length));
  });
});
