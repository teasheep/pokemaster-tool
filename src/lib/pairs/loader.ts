import "server-only";

import catalogJson from "@/data/pomatools-pairs.json";

import { CLIENT_PAIR_FIELDS, type ClientPairRecord, type PairRecord } from "./types";

// catalog 以靜態 import 打進 server bundle (~770KB) — 不用 fs, 才能跑在
// Cloudflare Workers 這類無檔案系統的執行環境; Node 上行為相同。
// dev 時改 JSON 後需重啟 dev server (符合預期, JSON 是 scraper 輸出)。

const records = (catalogJson as unknown as { records: PairRecord[] }).records;

/**
 * catalog 指紋 —— **建置時算好的常數**, 這裡只是轉出去給 server 端沿用
 * (src/data/catalog-version.ts, 由 scripts/emit-client-catalog.mjs 產生)。
 *
 * 為什麼不再在執行期算: 舊版在 module scope 跑 `JSON.stringify(records)` + FNV 迴圈,
 * 每個 Cloudflare Workers isolate 冷啟動就要白付一次 (本機實測 ~6ms, 換算線上約 45ms),
 * 而免費方案每請求 CPU 上限只有 10ms —— 頁面一行都還沒渲染就先爆表 (error 1102 的成因之一)。
 *
 * 指紋的輸入**仍然同時涵蓋 catalog 內容與投影形狀** (原因照舊: 改 CLIENT_PAIR_FIELDS 或
 * isTera 判定時 catalog JSON 一個字都沒動, 指紋若不變, immutable 快取會讓抓過整本的瀏覽器
 * 整整一年拿到舊投影)。腳本的 catalogVersion() 把「宣告的欄位清單」與「投影後實際長出來的
 * key」一起餵進去 —— 衍生欄位自動涵蓋, 舊版那條「新增衍生欄位時記得加進 SHAPE」的人工守則
 * 因此消失。
 *
 * 忘了重跑腳本怎麼辦: (1) `npm run build` 前的 prebuild 一定重跑一次;
 * (2) tests/catalog-asset.test.ts 會把靜態檔對回 CLIENT_PAIR_FIELDS 與這份 catalog, 對不上就紅。
 *
 * (client 要「整本圖鑑在哪」不走這裡 —— 直接 import CATALOG_ASSET_PATH, 見 gym/pair-picker.tsx。)
 */
export { CATALOG_VERSION } from "@/data/catalog-version";

/** 台北日期 YYYY-MM-DD — Workers 跑 UTC, 直接 new Date() 會慢 8 小時 (同 lib/gym/types.ts 的寫法) */
function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/**
 * 還不能對外送的拍組 —— **兩條各自獨立的判準, 命中任何一條就擋**:
 *
 *   A. `verifiedSources` 空 **且** `releaseDate` 為 null
 *      = 只有 datamine 看得到、連上架日都沒有 (reconcile 對得上 pomatools/wiki 時會記來源)。
 *      這條的兩個條件缺一不可, 兩邊都單獨試過會誤傷:
 *        - 只看 `releaseDate == null`: 誤殺**早就上市**的劇情/一般拍組 (pomatools 就是沒給日期);
 *        - 只看 `series === "upcoming"`: 誤殺 11 個已上市的新拍組 (upcoming 是「上架時間」標記
 *          不是系列, 見 AGENTS.md), 例如 2026-08-16 的 蓋伊 & 大竺葵。
 *
 *   B. `releaseDate` 晚於今天 (台北) = 官方還沒上架的未來拍組。
 *      **2026-09-01 補上這條的原因**: fandom roster 會收 datamine 先行列, reconcile 因此給了
 *      它們 `verifiedSources: ["wiki"]` → 判準 A 一筆都擋不到。那次更新有 7 筆這種拍組
 *      (竹蘭&冰伊布 9/12、小光（冠軍）&帕路奇亞 9/12、明輝（冠軍）&帝牙盧卡 9/14、
 *      赤日&瑪狃拉 9/16、夥星/歲星/鎮星 9/16) 直接進了 public/catalog/<指紋>.json —— 而那個檔
 *      由 Workers Assets 直送、不經 Worker, 訪客沒登入就抓得到。交叉查證 Bulbapedia 與官方公告:
 *      這 7 筆全是「Datamined future release」, 官方一個字都還沒公布。
 *      **這是收緊不是放寬** (AGENTS.md 只禁止放寬); 已上市的拍組不受任何影響。
 *
 * 對外輸出一律不含它們 —— 收口只有一個: loadPairsForClient()。
 * `npm run data:catalog` 每次都會把被擋下的清單印出來, 誤傷看得見。
 */
// ⚠ 判準 A 的語意是「外部來源還沒收錄」, 不完全等於「官方還沒公布」: 剛實裝但上游還沒跟上的
// 新拍組會暫時被擋在外面 —— 那是**安全的方向**(寧可晚一天上架也不要提前外洩)。修法是重跑資料
// 管線讓來源補上, 不要放寬判準。
export function isUnreleasedPair(
  rec: Pick<PairRecord, "verifiedSources" | "releaseDate">,
  today: string = taipeiToday()
): boolean {
  const releaseDate = rec.releaseDate ?? null;
  // A: datamine 先行, 沒來源也沒日期
  if ((rec.verifiedSources?.length ?? 0) === 0 && releaseDate === null) return true;
  // B: 有日期但還沒到 (ISO YYYY-MM-DD 字串可直接字典序比較)
  return releaseDate !== null && releaseDate > today;
}

/**
 * server 端完整資料 (**不過濾**未公布拍組)。
 *
 * 這裡刻意保留全部 645 筆: 它與 loadPairsById() 都只在 server 內部被「用 pairId 查既有資料」
 * 的地方使用 (/api/export 的 pairInfo()、辨識管線 embed-matcher、本機 upload 路由),
 * 沒有任何一處會把整包列舉出去。濾在這裡的話, 萬一某人的收藏真的存了那種 id,
 * 卡片會掉成灰字 pair_id, 反而丟資訊。對外的收口只有一個 → loadPairsForClient()。
 */
export function loadPairs(): Promise<PairRecord[]> {
  return Promise.resolve(records);
}

/**
 * pairId → 完整 record 的查表 (**同樣不過濾**, 理由見 loadPairs)。
 * 使用者: /api/export (金鑰授權, 只對「資料庫裡既有的 pair_id」查名字/屬性)、
 * src/lib/server/embed-matcher.ts 與 /api/save-user-pairs (都是 *.node.* 的本機路由,
 * pageExtensions 讓它們根本不會被部署到 Cloudflare)。三者都不列舉整包。
 */
let byIdCache: Promise<Map<string, PairRecord>> | null = null;
export function loadPairsById(): Promise<Map<string, PairRecord>> {
  if (!byIdCache) {
    byIdCache = loadPairs().then(
      (records) => new Map(records.map((p) => [p.pairId, p]))
    );
  }
  return byIdCache;
}

// client 用: 只投影 CLIENT_PAIR_FIELDS, 建新物件以實際剝除多餘欄位 (TS cast 不會剝)。
//
// **這裡是「拍組資料離開伺服器」的唯一收口** —— 每一頁 (/pairs、/share/[token]、道館的
// 成員/隊伍/看板、本機 upload)、/api/catalog, 以及產生 public/catalog/<指紋>.json 的
// scripts/emit-client-catalog.mjs (用 esbuild 打包這支檔再呼叫同一個函式) 全部經過它。
// 所以未公布拍組濾在這一層 = 對外全部乾淨, 而 server 內部的 by-id 查詢不受影響。
//
// ⚠ 靜態資產是**建置時**產的: 改了下面的過濾就要重跑 `npm run data:catalog`
//    (指紋會跟著換 → 新網址; 腳本同時刪掉 public/catalog 底下的舊檔, 舊網址在下次部署後 404)。
//
// ⚠ 快取以「台北日期」為 key: isUnreleasedPair 的判準 B 會隨日期改變 (上架日一到就該放行),
//    而 Workers 的 isolate 可以活很久 —— 不帶日期的話, 拍組上架當天有些 isolate 會整天不放行。
//    每天最多重算一次, CPU 成本可以忽略 (免費方案每請求 10ms 上限)。
//    靜態資產那條路徑是**建置時**產的, 不會自己更新 → 新拍組上架當天要重跑
//    `npm run data:catalog` 並重新部署, 「全圖鑑」才看得到 (SSR 頁面則會自動放行)。
let clientCache: { day: string; value: Promise<ClientPairRecord[]> } | null = null;
export function loadPairsForClient(): Promise<ClientPairRecord[]> {
  const day = taipeiToday();
  if (!clientCache || clientCache.day !== day) {
    const value = loadPairs().then((records) =>
      // 還不能對外送的拍組一律濾掉 (判準見 isUnreleasedPair)
      records.filter((r) => !isUnreleasedPair(r, day)).map((r) => {
        const out = {} as Record<string, unknown>;
        for (const k of CLIENT_PAIR_FIELDS) out[k] = r[k];
        // 太晶化判定 = change 是 TERA, 或 forms 裡有 TERA_* 形態 (太晶前是一般型態的拍組)。
        // 判定放這裡而不是卡片裡: forms 是 catalog 最肥的欄位 (~62KB/頁), client 只為了這
        // 十來隻太晶拍組載整包不划算 → 投影時折成一個布林。
        out.isTera =
          r.change === "TERA" ||
          (r.forms ?? []).some((f) => String(f.kind ?? "").startsWith("TERA"));
        return out as ClientPairRecord;
      })
    );
    clientCache = { day, value };
  }
  return clientCache.value;
}
