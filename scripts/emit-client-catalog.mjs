#!/usr/bin/env node
/**
 * 產生「完整拍組圖鑑 (client 投影版)」的靜態資產 + 建置時的 catalog 指紋。
 *
 * 產出兩個檔 (都要 commit):
 *   public/catalog/<指紋>.json   {"version","fields","records"} — 645 筆投影後的拍組
 *   src/data/catalog-version.ts  CATALOG_VERSION / CATALOG_ASSET_PATH 兩個常數
 *
 * 為什麼要有這支 (Cloudflare Workers 免費方案每請求 CPU 上限 10ms):
 *   1. 舊的 /api/catalog 路由每次被打都重跑一次 JSON.stringify(整包 306KB) 再串流出去,
 *      實測整條路徑約 45-65ms CPU。改成 public/ 底下的檔之後由 Workers Assets 直接供應 —
 *      wrangler.jsonc 沒設 run_worker_first, 命中資產時**我們的 Worker 根本不會被叫起來**,
 *      那條路徑是真正的 0 CPU (不是「比較便宜」)。
 *   2. 舊的指紋在 src/lib/pairs/loader.ts 的 module scope 現算 (JSON.stringify + FNV 迴圈),
 *      每個 isolate 冷啟動白付一次 (本機 ~6ms, 換算線上約 45ms), 頁面還一行都沒渲染。
 *
 * **零漂移是硬需求**: 投影欄位必須永遠等於 CLIENT_PAIR_FIELDS。所以這支腳本
 *   *不自己複製一份欄位清單*, 而是用 esbuild 把 src/lib/pairs/loader.ts 打包成暫存 ESM
 *   再 import, 直接呼叫真正的 loadPairsForClient()。清單仍然只有 types.ts 一份。
 *   另有 tests/catalog-asset.test.ts 把產出的檔對回 CLIENT_PAIR_FIELDS 與 catalog 原始資料,
 *   忘了重跑就測試紅。
 *
 * 冪等: 內容沒變就不重寫檔 (mtime 不動); 產生新指紋時會刪掉 public/catalog 底下的舊檔。
 *
 * 用法:
 *   node scripts/emit-client-catalog.mjs   # 或 npm run data:catalog
 *   自動接在 npm run build 之前 (package.json 的 prebuild) 與資料管線 5d 階段。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const OUT_DIR = join(repoRoot, "public", "catalog");
const VERSION_TS = join(repoRoot, "src", "data", "catalog-version.ts");
// 暫存打包產物放 node_modules/.cache (已被 .gitignore 擋掉, 且與 tsconfig 同一顆硬碟)
const CACHE_DIR = join(repoRoot, "node_modules", ".cache", "pm-gym-catalog");

/** FNV-1a 32-bit — 只是版本號不是安全用途 */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * catalog 指紋 = f(投影形狀, 資料內容)。
 *
 * **形狀一定要進去**: 改 CLIENT_PAIR_FIELDS 或 isTera 判定時 catalog JSON 一個字都沒動,
 * 指紋若不變, 網址就不變 —— 而那條網址是 immutable 快取一年, 抓過整本的瀏覽器會整整一年
 * 拿到舊投影 (例: 之後重啟 EX 換裝把 exStyleImagePath 加回來, 從全圖鑑選的拍組會缺欄位)。
 *
 * 形狀用兩個來源: 宣告的 fields + **投影後實際長出來的 key**。後者讓 isTera 這類衍生欄位
 * 自動被涵蓋 —— 舊版是人工維護一條 `SHAPE = fields + "|isTera"` 的守則, 新增衍生欄位時
 * 忘了加就會漏掉。
 */
export function catalogVersion(fields, records) {
  const shape = JSON.stringify({ fields, keys: Object.keys(records[0] ?? {}) });
  return fnv1a(`${shape}\n${JSON.stringify(records)}`);
}

/** 產出檔的路徑 (跟著指紋走) */
export function catalogAssetPath(version) {
  return `/catalog/${version}.json`;
}

// ── 用真正的 loadPairsForClient() 產投影 ──
// esbuild 打包時要擋掉兩個 import:
//   server-only          — 這個套件沒有實體 (Next 自己 alias 掉的), 打包會解析不到
//   @/data/catalog-version — loader.ts 轉出去的就是「這支腳本的產物」, 不 stub 會變成
//                            「要先有產物才產得出產物」的死結 (第一次跑 / 刪檔重建時)
const STUBS = {
  "server-only": "export {};",
  "@/data/catalog-version": 'export const CATALOG_VERSION = "";\nexport const CATALOG_ASSET_PATH = "";',
};

const stubPlugin = {
  name: "pm-gym-stubs",
  setup(build) {
    const filter = /^(server-only|@\/data\/catalog-version)$/;
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "pm-gym-stub" }));
    build.onLoad({ filter: /.*/, namespace: "pm-gym-stub" }, (args) => ({
      contents: STUBS[args.path],
      loader: "ts",
    }));
  },
};

async function loadProjection() {
  const esbuild = await import("esbuild");
  mkdirSync(CACHE_DIR, { recursive: true });
  const entry = join(CACHE_DIR, "entry.ts");
  const outfile = join(CACHE_DIR, "bundle.mjs");
  writeFileSync(
    entry,
    [
      "// 由 scripts/emit-client-catalog.mjs 產生的暫存進入點 (用完即刪)",
      'export { loadPairsForClient, loadPairs } from "@/lib/pairs/loader";',
      'export { CLIENT_PAIR_FIELDS } from "@/lib/pairs/types";',
      "",
    ].join("\n"),
    "utf8"
  );
  try {
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      absWorkingDir: repoRoot,
      // `@/x` → src/x。用 alias 而不是靠 tsconfig 的 paths: 這份 tsconfig 沒有 baseUrl
      // (TS 5 / moduleResolution bundler 允許), esbuild 在那種情況下解析不到 paths。
      alias: { "@": join(repoRoot, "src") },
      logLevel: "warning",
      plugins: [stubPlugin],
    });
    // 加 query 打掉 ESM module cache (同一支腳本重跑時 outfile 路徑不變)
    const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    const records = await mod.loadPairsForClient();
    // 未過濾的全量 —— 只為了在下面印出「這次濾掉了哪些」, 不會寫進資產
    const allRecords = await mod.loadPairs();
    return { records, allRecords, fields: [...mod.CLIENT_PAIR_FIELDS] };
  } finally {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}

/** 內容一樣就不動檔案 (冪等; 避免無謂的 mtime 變動與 git 雜訊) */
function writeIfChanged(file, contents) {
  if (existsSync(file) && readFileSync(file, "utf8") === contents) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
  return true;
}

function versionModule(version) {
  return [
    "// ⚠ 這個檔是**產生**出來的, 不要手改 —— 改了下次建置就被蓋回去。",
    "// 產生器: scripts/emit-client-catalog.mjs (npm run data:catalog / build 前的 prebuild)",
    "//",
    "// CATALOG_VERSION  = catalog 內容 + client 投影形狀 的指紋 (見腳本的 catalogVersion())。",
    "// CATALOG_ASSET_PATH = 完整圖鑑靜態資產的網址 (public/catalog/<指紋>.json)。",
    "//   由 Workers Assets 直接供應 → 命中時我們的 Worker 完全不執行 (0 CPU),",
    "//   檔名帶指紋所以敢對它下 immutable 一年 (見 public/_headers)。",
    "//",
    "// 這個檔 client / server 都會 import, 所以只能放純常數 (不要 import server-only 的東西)。",
    "",
    `export const CATALOG_VERSION = ${JSON.stringify(version)};`,
    "",
    `export const CATALOG_ASSET_PATH = ${JSON.stringify(catalogAssetPath(version))};`,
    "",
  ].join("\n");
}

async function main() {
  const { records, allRecords, fields } = await loadProjection();

  // 防呆: 投影空了就是上游壞了, 寧可整支失敗也不要發一份空圖鑑出去
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("loadPairsForClient() 回傳空陣列 — catalog 壞了?");
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("CLIENT_PAIR_FIELDS 是空的 — types.ts 壞了?");
  }
  const missingId = records.findIndex((r) => !r?.pairId);
  if (missingId >= 0) throw new Error(`第 ${missingId} 筆沒有 pairId`);

  const version = catalogVersion(fields, records);
  const assetFile = join(OUT_DIR, `${version}.json`);
  const payload = JSON.stringify({ version, fields, records });

  const wroteAsset = writeIfChanged(assetFile, payload);

  // 舊指紋的檔要刪 — 不刪的話每次資料更新都在 public/ 堆一份 300KB 廢檔上部署
  const stale = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json") && f !== `${version}.json`);
  for (const f of stale) rmSync(join(OUT_DIR, f), { force: true });

  const wroteVersion = writeIfChanged(VERSION_TS, versionModule(version));

  const kb = (Buffer.byteLength(payload, "utf8") / 1024).toFixed(0);
  console.log("=== client 圖鑑靜態資產 ===");
  console.log(`  拍組       ${records.length} 筆 ・ 欄位 ${fields.length} + isTera`);
  console.log(`  指紋       ${version}`);
  console.log(`  資產       public${catalogAssetPath(version)}  (${kb} KB)${wroteAsset ? "  [已寫入]" : "  [內容未變]"}`);
  console.log(`  常數       src/data/catalog-version.ts${wroteVersion ? "  [已寫入]" : "  [內容未變]"}`);
  if (stale.length) console.log(`  清掉舊檔   ${stale.join(", ")}`);

  // 濾掉哪些拍組要「說出來」—— 兩種擋法各自都可能誤傷, 印出來才看得見
  // (這段會出現在 npm run data:update 的輸出裡):
  //   A 來源未收錄: 剛實裝但 pomatools/wiki 還沒跟上的新拍組會被一起擋掉 → 重跑資料管線就好。
  //   B 還沒上架: 上架日一到就會自動放行, 但**靜態資產是建置時產的** →
  //     那天要重跑這支腳本並重新部署, 「全圖鑑」才看得到。
  const dropped = allRecords.length - records.length;
  if (dropped > 0) {
    const kept = new Set(records.map((y) => y.pairId));
    const held = allRecords.filter((x) => !kept.has(x.pairId));
    const future = held.filter((r) => r.releaseDate);
    console.log(`\n  未對外送 ${dropped} 筆 (判準見 lib/pairs/loader.ts 的 isUnreleasedPair):`);
    for (const r of held) {
      const why = r.releaseDate ? `尚未上架 ${r.releaseDate}` : "來源未收錄";
      console.log(`    ${r.pairId}  ${r.trainerName ?? "?"} & ${r.pokemonName ?? "?"}  [${why}]`);
    }
    console.log(`  ↑「來源未收錄」裡若出現**已經上市**的拍組, 表示上游還沒跟上 —`);
    console.log(`    重跑 npm run data:update 讓 verifiedSources/releaseDate 補上, 不要改判準。`);
    if (future.length) {
      const next = future.map((r) => r.releaseDate).sort()[0];
      console.log(`  ↑「尚未上架」的最早一筆是 ${next} — 那天要重跑這支腳本並重新部署才會出現。`);
    }
  }
  if (wroteAsset || wroteVersion) console.log("\n記得把這兩個檔一起 commit (測試會檢查它們與 catalog 一致)。");
}

// 被 import 時 (測試) 只拿工具函式, 不執行
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((e) => {
    console.error("\n✖ 產生 client 圖鑑資產失敗:", e);
    process.exit(1);
  });
}
