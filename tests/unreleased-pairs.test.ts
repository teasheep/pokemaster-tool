// 「還不能對外送的拍組」不得外流 —— 迴歸防線。
//
// 背景 (2026-08-21 線上實測): 訪客沒登入就能抓到 public/catalog/<指紋>.json 整本,
// 其中有資料管線從 datamine 先撈到、官方還沒宣布的拍組; /pairs 的訪客版 HTML 裡
// 那些 pairId 也一個不漏。原因是結構性的 —— /catalog/* 與 /reference/* 由
// Workers Assets 直送, 根本不經過 Worker, proxy.ts 的登入檢查對它們無效。
//
// 所以過濾只能做在資料離開伺服器的那個收口: loadPairsForClient()。
// 這條規則以後很容易在改管線 / 改投影時被弄丟, 這支測試就是為了那一天。
//
// 2026-09-01 追加判準 B (releaseDate 晚於今天 = 尚未上架): fandom roster 會收 datamine
// 先行列, reconcile 因此給了那些拍組 verifiedSources: ["wiki"] → 判準 A 一筆都擋不到,
// 7 筆官方還沒公布的拍組 (竹蘭&冰伊布 / 小光（冠軍）&帕路奇亞 / 明輝（冠軍）&帝牙盧卡 /
// 赤日&瑪狃拉 / 夥星 / 歲星 / 鎮星) 就這樣進了對外的 catalog。
//
// 紅了怎麼辦:
//   - 「loadPairsForClient 還有未公布拍組」→ 過濾被拿掉了, 把 isUnreleasedPair 的 filter 加回去。
//   - 「靜態資產還有未公布拍組」→ 忘了重跑 `npm run data:catalog` (檔+指紋要一起 commit)。
//   - 「判準 A 命中數變了」→ 資料管線抓到新的 datamine 先行拍組 (正常, 更新下面的期望值),
//      但**先確認被濾掉的每一筆真的沒上市**, 不要無腦改數字。
//   - 判準 B 的命中數刻意不寫死: 它會隨時間自然歸零 (上架日一到就放行)。

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// loader.ts 第一行 import "server-only" (Next 自己 alias 的套件, node_modules 裡沒有實體)
// → vitest 解析不到。給它一個空模組即可, 這支檔的邏輯與 server-only 無關。
vi.mock("server-only", () => ({}));

import { CATALOG_ASSET_PATH } from "@/data/catalog-version";
import { isUnreleasedPair, loadPairs, loadPairsById, loadPairsForClient } from "@/lib/pairs/loader";
import { isUpcomingPair } from "@/lib/pairs/name";
import type { PairRecord } from "@/lib/pairs/types";

const repoRoot = join(__dirname, "..");

function readSource(): PairRecord[] {
  const raw = readFileSync(join(repoRoot, "src", "data", "pomatools-pairs.json"), "utf8");
  return (JSON.parse(raw) as { records: PairRecord[] }).records;
}

function readAssetIds(): string[] {
  const raw = readFileSync(join(repoRoot, "public", CATALOG_ASSET_PATH), "utf8");
  return (JSON.parse(raw) as { records: { pairId: string }[] }).records.map((r) => r.pairId);
}

const source = readSource();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const unreleased = source.filter((r) => isUnreleasedPair(r));
const unreleasedIds = new Set(unreleased.map((r) => r.pairId));

// 判準 A/B 各自的命中集合 (兩者互斥: A 要求 releaseDate 為 null, B 要求它有值且在未來)
const noSourceNoDate = source.filter(
  (r) => (r.verifiedSources?.length ?? 0) === 0 && (r.releaseDate ?? null) === null
);
const futureDated = source.filter((r) => (r.releaseDate ?? null) !== null && r.releaseDate! > today);

describe("判準 A — 沒有來源證實也沒有上架日 (datamine 先行)", () => {
  it("恰好命中 10 筆, 每一筆都同時滿足兩個條件", () => {
    expect(noSourceNoDate.length).toBe(10);
    for (const r of noSourceNoDate) {
      expect(r.verifiedSources ?? [], `${r.pairId} 竟然有來源`).toEqual([]);
      expect(r.releaseDate ?? null, `${r.pairId} 竟然有上架日`).toBeNull();
      expect(isUnreleasedPair(r), `${r.pairId} 沒被擋下來`).toBe(true);
    }
  });

  it("不誤傷已上市的拍組 (是 AND 不是「沒日期就砍」)", () => {
    // 早就在遊戲裡、只是上游沒給日期的拍組 —— 只看 releaseDate 會把它們一起砍掉
    const noDateButReleased = source.filter(
      (r) => (r.releaseDate ?? null) === null && (r.verifiedSources?.length ?? 0) > 0
    );
    for (const r of noDateButReleased) expect(isUnreleasedPair(r)).toBe(false);

    // series === "upcoming" 是「上架時間」標記不是系列 (AGENTS.md), 已上市的新拍組也掛著它
    const upcomingButReleased = source.filter(
      (r) => r.series === "upcoming" && !unreleasedIds.has(r.pairId)
    );
    expect(upcomingButReleased.length).toBeGreaterThan(0);
    for (const r of upcomingButReleased) expect(r.releaseDate ?? null).not.toBeNull();
  });
});

describe("尚未上架 — 標示而不是擋住 (2026-09-09 改)", () => {
  // 固定日期的純函式測試 (不依賴今天是哪天, 才不會隨時間變紅/變綠)
  const withSource = { verifiedSources: ["wiki"] };

  it("有來源但日期在未來 = 照樣輸出, 只是標成尚未上架", () => {
    const rec = { ...withSource, releaseDate: "2026-09-16" };
    expect(isUnreleasedPair(rec)).toBe(false);
    expect(isUpcomingPair(rec, "2026-09-01")).toBe(true);
  });

  it("上架當天就不再標示 (是 > 不是 >=)", () => {
    expect(isUpcomingPair({ releaseDate: "2026-09-16" }, "2026-09-16")).toBe(false);
    expect(isUpcomingPair({ releaseDate: "2026-09-16" }, "2026-09-17")).toBe(false);
  });

  it("已上市的拍組不標示, 沒有日期的也不標示", () => {
    expect(isUpcomingPair({ releaseDate: "2019-08-29" }, "2026-09-01")).toBe(false);
    expect(isUpcomingPair({ releaseDate: null }, "2026-09-01")).toBe(false);
  });

  it("catalog 裡未來日期的拍組全部進得了對外輸出 (數量隨時間自然歸零, 不寫死)", async () => {
    const visible = new Set((await loadPairsForClient()).map((p) => p.pairId));
    for (const r of futureDated) {
      expect(visible.has(r.pairId), `${r.pairId} ${r.releaseDate} 應該要對外輸出`).toBe(true);
      expect(isUpcomingPair(r, "2026-09-09")).toBe(true);
    }
    expect(unreleased.length).toBe(noSourceNoDate.length);
  });
});

describe("對外輸出不得含未公布拍組", () => {
  it("loadPairsForClient() 一筆都不含 (所有頁面 / /api/catalog / 靜態資產的共同收口)", async () => {
    const out = await loadPairsForClient();
    const leaked = out.filter((r) => unreleasedIds.has(r.pairId)).map((r) => r.pairId);
    expect(leaked, "未公布拍組外流到 client 投影").toEqual([]);
    expect(out.length).toBe(source.length - unreleased.length);
  });

  it("投影本身不含 verifiedSources (它是過濾的輸入, 不是要送出去的欄位)", async () => {
    const out = await loadPairsForClient();
    expect(Object.keys(out[0] ?? {})).not.toContain("verifiedSources");
  });

  it("靜態資產 public/catalog/<指紋>.json 也一筆都不含 (訪客真正下載的就是這個檔)", () => {
    const leaked = readAssetIds().filter((id) => unreleasedIds.has(id));
    expect(leaked, "忘了重跑 `npm run data:catalog`?").toEqual([]);
  });
});

describe("server 內部查表刻意不過濾", () => {
  it("loadPairs() / loadPairsById() 仍看得到全部 (by-id 查既有資料, 濾了只會讓卡片掉成灰字)", async () => {
    const [all, byId] = await Promise.all([loadPairs(), loadPairsById()]);
    expect(all.length).toBe(source.length);
    for (const id of unreleasedIds) expect(byId.has(id), `${id} 在 by-id 查表裡消失了`).toBe(true);
  });
});
