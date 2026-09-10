// 初上線日的迴歸防線。
//
// `releaseDate` 的語意是「拍組第一次在遊戲裡登場」(2026-09-09 使用者指定, 用詞一律「初上線」),
// 復刻、二次開放、活動檔期開始日都不算。18 筆已查證的修正登記在
// src/data/pair-debut-dates.json, 由 scripts/apply-debut-dates.mjs 在管線最後一階套用。
//
// 這裡要擋的三種壞法, 共同點是**畫面照樣顯示, 只是日期是錯的**:
//   1. 資料管線重跑之後把登記的日期洗掉 (pomatools / wiki 會寫同一個欄位)。
//   2. remap-pair-ids 換了 pairId, 登記簿沒跟著改 → 那一筆的修正靜靜失效。
//   3. 上游資料更新後冒出**新的**日期歧異, 沒有人去查證就跟著上線。
//
// 紅了怎麼辦:
//   -「登記簿與 catalog 對不上」→ 跑 npm run data:debut (管線少跑了最後一階)。
//   -「登記簿指到不存在的 pairId」→ remap 之後要跟著改登記簿, 不是刪測試。
//   -「有未登記的日期歧異」→ **逐筆查證後補一筆進登記簿** (一定要附來源網址),
//      不要改這裡的數字。查證確認我方是對的就填 debut = 現值, 那筆會變成防漂移的錨點。

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// loader.ts 第一行 import "server-only" (Next 自己 alias 的套件, node_modules 裡沒有實體)
vi.mock("server-only", () => ({}));

import { loadPairs } from "@/lib/pairs/loader";
import type { PairRecord } from "@/lib/pairs/types";

const repoRoot = join(__dirname, "..");

type DebutEntry = {
  label: string;
  debut: string;
  was: string | null;
  why: string;
  otherDates?: string[];
  sources: string[];
};

const registry = JSON.parse(
  readFileSync(join(repoRoot, "src", "data", "pair-debut-dates.json"), "utf8")
).entries as Record<string, DebutEntry>;

const upstream = JSON.parse(
  readFileSync(join(repoRoot, "src", "data", "pomasters", "syncpairs.json"), "utf8")
).SYNCPAIRS as { internalTrainerName: string; internalPokemonName: string; releaseDate: string }[];

const upstreamByKey = new Map(
  upstream.map((r) => [`${r.internalTrainerName}|${r.internalPokemonName}`, r])
);

describe("初上線日登記簿", () => {
  it("每一筆都套進 catalog 了", async () => {
    const all = await loadPairs();
    const byId = new Map(all.map((r) => [r.pairId, r]));
    const wrong: string[] = [];
    for (const [pairId, e] of Object.entries(registry)) {
      const rec = byId.get(pairId);
      if (!rec) continue; // 下一條測試負責這件事
      if (rec.releaseDate !== e.debut) {
        wrong.push(`${pairId} ${e.label}: catalog ${rec.releaseDate} ≠ 登記 ${e.debut}`);
      }
    }
    expect(wrong, "跑 npm run data:debut").toEqual([]);
  });

  it("沒有指到不存在的 pairId", async () => {
    const known = new Set((await loadPairs()).map((r) => r.pairId));
    const orphans = Object.entries(registry)
      .filter(([pairId]) => !known.has(pairId))
      .map(([pairId, e]) => `${pairId} ${e.label}`);
    expect(orphans, "remap-pair-ids 之後登記簿要跟著改").toEqual([]);
  });

  it("每一筆都有來源網址與判定依據", () => {
    const bad: string[] = [];
    for (const [pairId, e] of Object.entries(registry)) {
      if (!e.sources?.length) bad.push(`${pairId} 沒有 sources`);
      if (!e.why?.trim()) bad.push(`${pairId} 沒有 why`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.debut)) bad.push(`${pairId} debut 格式不對: ${e.debut}`);
      if (!e.sources?.every((s) => s.startsWith("http"))) bad.push(`${pairId} sources 不是網址`);
    }
    expect(bad, "沒有來源就不該進登記簿 — 下一個人要能自己複查").toEqual([]);
  });

  it("label 與 catalog 的實際名稱相符 (全形半形也算)", async () => {
    const byId = new Map((await loadPairs()).map((r) => [r.pairId, r]));
    const mismatched: string[] = [];
    for (const [pairId, e] of Object.entries(registry)) {
      const rec = byId.get(pairId) as PairRecord | undefined;
      if (!rec) continue;
      const actual = `${rec.trainerNameZh ?? rec.trainerName} & ${rec.pokemonNameZh ?? rec.pokemonName}`;
      if (actual !== e.label) mismatched.push(`${pairId}: 登記「${e.label}」實際「${actual}」`);
    }
    expect(mismatched, "label 用腳本從 catalog 產, 不要手打").toEqual([]);
  });
});

describe("與第三方來源的日期歧異", () => {
  // pomasters 是獨立的第三方。兩邊不同的每一筆都必須是**查證過的刻意歧異**,
  // 否則就是還沒有人看過的新問題。
  it("每一筆歧異都在登記簿裡", async () => {
    const all = await loadPairs();
    const undocumented: string[] = [];
    for (const rec of all) {
      if (!rec.releaseDate) continue;
      const u = upstreamByKey.get(`${rec.trainerId}|${rec.pokemonId}`);
      if (!u?.releaseDate) continue;
      if (u.releaseDate === rec.releaseDate) continue;
      if (registry[rec.pairId]) continue;
      undocumented.push(
        `${rec.pairId} ${rec.trainerNameZh} & ${rec.pokemonNameZh}: 我方 ${rec.releaseDate} / 上游 ${u.releaseDate}`
      );
    }
    expect(
      undocumented,
      "冒出新的日期歧異 — 逐筆查證後補進 src/data/pair-debut-dates.json, 不要改這裡"
    ).toEqual([]);
  });
});
