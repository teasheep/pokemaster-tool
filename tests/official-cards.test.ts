// 官方卡面資產的迴歸防線。
//
// 卡面改用 pomasters 的成品卡之後 (public/reference/card/<pairId>_<3|4|5|EX>.webp),
// 出現了兩種**壞掉完全沒有徵兆**的新失敗:
//
//   1. 少一張圖 = 647 張卡牆裡的一張變空白。沒有人會發現, 而且本機因為 .cache/ 的 PNG
//      還在, 完全看不出來 —— 與 AGENTS 記過的「.assetsignore 排錯一行, 線上 404 空圖
//      而本機看不出來」是同一種形狀。
//   2. 多一張圖 = 官方還沒公布的拍組美術被放上 public/。那裡由 Workers Assets 直送,
//      訪客知道網址就抓得到, 正是 1.1.0 那次外洩的形狀換成圖片。
//
// 設計上這兩件事都靠 scripts/fetch-official-cards.mjs 的「不產生」而不是「產生了再排除」:
// PNG 快取在 .cache/ (不在 public/), webp 只產 !isUnreleasedPair() 的拍組。
// 這支測試是那個設計的守門員。
//
// 紅了怎麼辦:
//   -「缺卡面」→ 跑 npm run data:cards (上游剛出新拍組的話先 npm run data:pomasters -- --bump)。
//   -「未上架拍組出現在 public」→ **不要手動刪了就算**, 先確認 fetch-official-cards 的
//     emit 判斷還在走 isUnreleasedPair, 那是紅線本身。
//   -「對照表對不到」→ 跑 npm run data:cardmap, 它會指名是哪一筆、哪一段比對沒接上。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// loader.ts 第一行 import "server-only" (Next 自己 alias 的套件, node_modules 裡沒有實體)
vi.mock("server-only", () => ({}));

import { isUnreleasedPair, loadPairs, loadPairsForClient } from "@/lib/pairs/loader";

const repoRoot = join(__dirname, "..");
const CARD_DIR = join(repoRoot, "public", "reference", "card");
const MAP_FILE = join(repoRoot, "src", "data", "official-card-map.json");

type CardMap = {
  entries: { pairId: string; files: Record<string, string>; basePotential: number }[];
};

const cardMap = JSON.parse(readFileSync(MAP_FILE, "utf8")) as CardMap;
const mapById = new Map(cardMap.entries.map((e) => [e.pairId, e]));
const onDisk = new Set(
  existsSync(CARD_DIR) ? readdirSync(CARD_DIR).filter((f) => f.endsWith(".webp")) : []
);

const cardFile = (pairId: string, tier: string) => `${pairId}_${tier}.webp`;

describe("官方卡面對照表", () => {
  it("每一筆對外可見的拍組都對得到官方卡面", async () => {
    const visible = await loadPairsForClient();
    const missing = visible.filter((p) => !mapById.has(p.pairId));
    expect(
      missing.map((p) => `${p.pairId} ${p.trainerNameZh} & ${p.pokemonNameZh}`),
      "對不到官方卡面 — 跑 npm run data:cardmap 看是哪一段比對沒接上"
    ).toEqual([]);
  });

  it("對照表只收 catalog 裡真的存在的 pairId", async () => {
    const all = await loadPairs();
    const known = new Set(all.map((p) => p.pairId));
    const ghosts = cardMap.entries.filter((e) => !known.has(e.pairId)).map((e) => e.pairId);
    expect(ghosts, "對照表指到不存在的 pairId — remap-pair-ids 之後忘了重跑 data:cardmap").toEqual([]);
  });

  it("星級階梯從原始星級到 5★ 沒有缺口", () => {
    const gaps: string[] = [];
    for (const e of cardMap.entries) {
      for (let s = e.basePotential; s <= 5; s++) {
        if (!e.files[String(s)]) gaps.push(`${e.pairId} 缺 ${s}★`);
      }
    }
    expect(gaps, "上游少了某一階的卡面 — 升星到那一階會變空卡").toEqual([]);
  });
});

describe("官方卡面資產", () => {
  it("對外可見的拍組, 每一階都有 webp", async () => {
    const visible = await loadPairsForClient();
    const missing: string[] = [];
    for (const p of visible) {
      const entry = mapById.get(p.pairId);
      if (!entry) continue; // 上一個 describe 已經擋這件事
      for (const tier of Object.keys(entry.files)) {
        if (!onDisk.has(cardFile(p.pairId, tier))) missing.push(cardFile(p.pairId, tier));
      }
    }
    expect(missing.slice(0, 20), "缺卡面 — 跑 npm run data:cards 並把 webp 一起 commit").toEqual([]);
  });

  it("⛔ 未公布/未上架的拍組, public 底下一個檔都不准有", async () => {
    const all = await loadPairs();
    const leaked: string[] = [];
    for (const p of all) {
      if (!isUnreleasedPair(p)) continue;
      const entry = mapById.get(p.pairId);
      if (!entry) continue;
      for (const tier of Object.keys(entry.files)) {
        if (onDisk.has(cardFile(p.pairId, tier))) leaked.push(cardFile(p.pairId, tier));
      }
    }
    expect(
      leaked,
      "未公布拍組的美術素材進了 public/ — 那裡由 Workers Assets 直送, 訪客抓得到"
    ).toEqual([]);
  });

  it("沒有孤兒 webp (對照表指不到的檔會被白帶上部署)", () => {
    const wanted = new Set<string>();
    for (const e of cardMap.entries) {
      for (const tier of Object.keys(e.files)) wanted.add(cardFile(e.pairId, tier));
    }
    const orphans = [...onDisk].filter((f) => !wanted.has(f));
    expect(orphans.slice(0, 20), "跑 npm run data:cards 會自動清掉").toEqual([]);
  });
});
