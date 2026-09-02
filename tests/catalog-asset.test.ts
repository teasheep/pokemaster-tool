// 靜態圖鑑資產的防漂移測試 —— 這是 public/catalog/<指紋>.json 敢存在的唯一理由。
//
// 背景: 「全圖鑑」以前是 /api/catalog 路由現算的, 好處是投影欄位永遠等於 CLIENT_PAIR_FIELDS。
// 為了讓那條路徑在 Cloudflare Workers 上 0 CPU (由 Workers Assets 直接供應, Worker 不執行),
// 改成建置時產一份 JSON。代價就是「檔會跟程式碼走鐘」, 所以這裡把三件事釘死:
//   1. 檔裡的欄位清單 === CLIENT_PAIR_FIELDS (types.ts 仍是唯一來源)
//   2. 檔裡的資料 === 現在的 src/data/pomatools-pairs.json **扣掉尚未官方公布的那些**
//      (忘了重跑腳本就紅; 過濾規則見 loader.isUnreleasedPair 與 tests/unreleased-pairs.test.ts)
//   3. 檔名/常數裡的指紋 === 用檔案內容重算的指紋 (手改常數或改到一半就紅)
//
// 紅了怎麼辦: `npm run data:catalog` (= node scripts/emit-client-catalog.mjs), 然後把
// public/catalog/*.json 與 src/data/catalog-version.ts 一起 commit。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// loader.ts 第一行 import "server-only" (Next 自己 alias 的套件, node_modules 沒有實體) → 給空模組
vi.mock("server-only", () => ({}));

import { CATALOG_ASSET_PATH, CATALOG_VERSION } from "@/data/catalog-version";
import { isUnreleasedPair } from "@/lib/pairs/loader";
import { CLIENT_PAIR_FIELDS, type PairRecord } from "@/lib/pairs/types";
// 指紋演算法只有腳本那一份 —— 這裡 import 而不是重寫, 免得測試自己跟腳本走鐘
import { catalogVersion } from "../scripts/emit-client-catalog.mjs";

const repoRoot = join(__dirname, "..");
const assetFile = join(repoRoot, "public", CATALOG_ASSET_PATH);

type CatalogAsset = {
  version: string;
  fields: string[];
  records: Record<string, unknown>[];
};

const HINT = "→ 跑 `npm run data:catalog` 重新產生, 並 commit public/catalog/*.json 與 src/data/catalog-version.ts";

function readAsset(): CatalogAsset {
  expect(existsSync(assetFile), `找不到靜態圖鑑資產 ${CATALOG_ASSET_PATH}\n${HINT}`).toBe(true);
  return JSON.parse(readFileSync(assetFile, "utf8")) as CatalogAsset;
}

/**
 * 靜態檔是 loadPairsForClient() 的產物, 而它會濾掉「還不能對外送」的拍組
 * (判準見 loader.isUnreleasedPair) → 這裡的對照組也要濾, 否則永遠對不上。
 * **用 loader 那支具名判準, 不要在測試裡複製條件** (複製 = 兩份規則走鐘)。
 * 「濾掉的到底是哪幾筆、有沒有誤傷」由 tests/unreleased-pairs.test.ts 顧。
 *
 * ⏰ **這條會在「新拍組上架日」自己變紅, 那是刻意的**: 判準 B 是「releaseDate 晚於今天」,
 * 所以上架日一到, 這裡的對照組就會多出那幾筆, 而建置時產的靜態檔還沒有 → 數量對不上。
 * 那正是提醒「該重跑 `npm run data:catalog` 並重新部署了」的訊號, 不是壞掉。
 * (SSR 頁面不受影響 —— loadPairsForClient 的快取以台北日期為 key, 當天就會自己放行。)
 */
function readSource(): PairRecord[] {
  const raw = readFileSync(join(repoRoot, "src", "data", "pomatools-pairs.json"), "utf8");
  return (JSON.parse(raw) as { records: PairRecord[] }).records.filter((r) => !isUnreleasedPair(r));
}

describe("client 圖鑑靜態資產 (public/catalog)", () => {
  it("路徑常數與檔名一致", () => {
    expect(CATALOG_ASSET_PATH).toBe(`/catalog/${CATALOG_VERSION}.json`);
    expect(existsSync(assetFile), `${assetFile} 不存在\n${HINT}`).toBe(true);
  });

  it("欄位清單 === CLIENT_PAIR_FIELDS (順序也一樣)", () => {
    const asset = readAsset();
    expect(asset.fields, `靜態檔的投影欄位與 types.ts 不一致\n${HINT}`).toEqual([
      ...CLIENT_PAIR_FIELDS,
    ]);
  });

  it("record 只長出宣告的欄位 + isTera (沒有多送、也沒有整欄消失)", () => {
    const asset = readAsset();
    const allowed = new Set([...asset.fields, "isTera"]);
    const seen = new Set<string>();
    for (const rec of asset.records) {
      for (const key of Object.keys(rec)) {
        // 多出來的 key = 投影漏了剝除 (每一個都是每頁白送的位元組)
        expect(allowed.has(key), `record 出現未宣告的欄位 ${key}`).toBe(true);
        seen.add(key);
      }
      expect(typeof rec.isTera, "isTera 應該是布林 (投影時折出來的衍生欄位)").toBe("boolean");
    }
    // 宣告了卻一筆都沒有 = 那個欄位在 catalog 裡根本不存在 (通常是新加欄位但 scraper 還沒填)
    const never = [...allowed].filter((k) => !seen.has(k));
    expect(never, `這些欄位宣告了但沒有任何一筆有值: ${never.join(", ")}`).toEqual([]);
  });

  it("內容與現在的 catalog 一致 (忘了重跑腳本就會紅)", () => {
    const asset = readAsset();
    const source = readSource();

    expect(asset.records.length, `拍組數量對不上\n${HINT}`).toBe(source.length);
    expect(
      asset.records.map((r) => r.pairId),
      `pairId 清單對不上\n${HINT}`
    ).toEqual(source.map((r) => r.pairId));

    // 逐欄位比 — 欄位清單取自檔案本身 (上一個 it 已經釘死它 === CLIENT_PAIR_FIELDS),
    // 所以這裡沒有第二份欄位清單可以走鐘。
    // `?? null`: 來源缺欄位時投影出來是 undefined, JSON 會直接把 key 丟掉 (不是不一致)。
    const mismatches: string[] = [];
    for (let i = 0; i < source.length; i++) {
      const src = source[i] as unknown as Record<string, unknown>;
      const out = asset.records[i];
      for (const f of asset.fields) {
        if (JSON.stringify(out[f] ?? null) !== JSON.stringify(src[f] ?? null)) {
          mismatches.push(`${out.pairId as string}.${f}`);
        }
      }
    }
    expect(mismatches.slice(0, 10), `這些欄位與 catalog 不同步\n${HINT}`).toEqual([]);
  });

  it("指紋 = f(投影形狀, 資料) 且與 CATALOG_VERSION 相符", () => {
    const asset = readAsset();
    const recomputed = catalogVersion(asset.fields, asset.records);
    expect(asset.version, `檔案裡的 version 與內容對不上\n${HINT}`).toBe(recomputed);
    expect(CATALOG_VERSION, `常數與檔案內容對不上\n${HINT}`).toBe(recomputed);
  });

  it("投影形狀變了指紋一定跟著變 (immutable 快取一年的前提)", () => {
    const asset = readAsset();
    const base = catalogVersion(asset.fields, asset.records);
    // 只加一個欄位名 (資料一個字沒動) → 指紋必須不同, 否則舊瀏覽器會被鎖在舊投影
    expect(catalogVersion([...asset.fields, "exStyleImagePath"], asset.records)).not.toBe(base);
    // 只改一筆資料 → 指紋也必須不同
    const tweaked = asset.records.map((r, i) => (i === 0 ? { ...r, type: "__x__" } : r));
    expect(catalogVersion(asset.fields, tweaked)).not.toBe(base);
  });
});
