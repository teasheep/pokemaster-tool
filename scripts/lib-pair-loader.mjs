/**
 * 讓 .mjs 腳本拿到 **真正的** src/lib/pairs/loader.ts —— 不要在腳本裡複製一份判準。
 *
 * 為什麼要這樣繞:
 *   `isUnreleasedPair()` 是「還不能對外送的拍組」那條紅線的唯一收口 (AGENTS.md)。
 *   腳本若自己抄一份兩行的判斷, 哪天判準改了就會有一份悄悄沒跟上 ——
 *   而那個壞法沒有任何徵兆 (圖照樣產、頁面照樣渲染, 只是某幾筆該擋沒擋 / 該放沒放)。
 *   所以一律用 esbuild 把 loader.ts 打包成暫存 ESM 再 import 真的那支。
 *
 * 兩個要 stub 掉的 import (與 emit-client-catalog.mjs 同一組理由):
 *   server-only            這個套件沒有實體 (Next 自己 alias 掉的), 打包會解析不到。
 *   @/data/catalog-version 那是 emit-client-catalog.mjs 的產物; 不 stub 就變成
 *                          「要先有產物才產得出產物」的死結 (第一次跑 / 刪檔重建時)。
 *
 * ⚠ scripts/emit-client-catalog.mjs 目前還有自己的一份同樣邏輯 (它先寫的)。
 *   兩份行為一致, 但之後要收斂成這一份 —— 動它之前記得 npm run build 會跑 prebuild,
 *   改壞就是整個建置掛掉, 所以刻意不在同一批改。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const CACHE_DIR = join(repoRoot, "node_modules", ".cache", "pm-gym-pair-loader");

const STUBS = {
  "server-only": "export {};",
  "@/data/catalog-version":
    'export const CATALOG_VERSION = "";\nexport const CATALOG_ASSET_PATH = "";',
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

/**
 * @returns {Promise<{
 *   all: import("../src/lib/pairs/types").PairRecord[],
 *   client: import("../src/lib/pairs/types").PairRecord[],
 *   isUnreleasedPair: (rec: unknown) => boolean,
 *   clientFields: string[],
 * }>}
 *   all    未過濾的全量 (catalog 有幾筆就幾筆)
 *   client 走 loadPairsForClient() 的收口, 已濾掉未公布拍組
 */
export async function loadPairModule() {
  const esbuild = await import("esbuild");
  mkdirSync(CACHE_DIR, { recursive: true });
  const entry = join(CACHE_DIR, "entry.ts");
  const outfile = join(CACHE_DIR, "bundle.mjs");
  writeFileSync(
    entry,
    [
      "// 由 scripts/lib-pair-loader.mjs 產生的暫存進入點 (用完即刪)",
      'export { loadPairs, loadPairsForClient, isUnreleasedPair } from "@/lib/pairs/loader";',
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
      // `@/x` → src/x。用 alias 不靠 tsconfig 的 paths: 這份 tsconfig 沒有 baseUrl,
      // esbuild 在那種情況下解析不到 paths。
      alias: { "@": join(repoRoot, "src") },
      logLevel: "warning",
      plugins: [stubPlugin],
    });
    // 加 query 打掉 ESM module cache (同一支腳本重跑時 outfile 路徑不變)
    const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    return {
      all: await mod.loadPairs(),
      client: await mod.loadPairsForClient(),
      isUnreleasedPair: mod.isUnreleasedPair,
      clientFields: [...mod.CLIENT_PAIR_FIELDS],
    };
  } finally {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}
