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
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/0064_roll_cakes.sql"),
  "utf8"
);

describe("背包道具", () => {
  it("每一種都在 0064 的 check 值域裡", () => {
    // 先把 -- 註解整行拿掉 —— 值域清單裡每一行都帶註解, 而註解裡有括號
    // (「招式糖 (依角色)」), 不先剝掉的話會在第一個右括號就把清單切斷。
    const bare = sql.replace(/--.*/g, "");
    const head = "candy_type in (";
    const i = bare.indexOf(head);
    expect(i).toBeGreaterThan(-1);
    const body = bare.slice(i + head.length, bare.indexOf(")", i));
    const allowed = body.split("'").filter((_, k) => k % 2 === 1);
    // 0064 是「值域的全集」: 0015 的 7 種 + 0036 的 5 種 + 0064 的 6 種
    expect(allowed).toHaveLength(18);
    for (const t of CANDY_TYPES) expect(allowed).toContain(t);
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

  it("骨架的格數與分組一致", () => {
    const src = fs.readFileSync(path.join(root, "src/components/skeletons.tsx"), "utf8");
    const m = src.match(/\{\[([\d, ]+)\]\.map\(\(n, gi\)/);
    expect(m, "skeletons.tsx 找不到背包骨架的格數陣列").not.toBeNull();
    const counts = m![1]!.split(",").map((n) => Number(n.trim()));
    expect(counts).toEqual(CANDY_GROUPS.map((g) => g.types.length));
  });
});
