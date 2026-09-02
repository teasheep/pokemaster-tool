// ⚠ 這個檔是**產生**出來的, 不要手改 —— 改了下次建置就被蓋回去。
// 產生器: scripts/emit-client-catalog.mjs (npm run data:catalog / build 前的 prebuild)
//
// CATALOG_VERSION  = catalog 內容 + client 投影形狀 的指紋 (見腳本的 catalogVersion())。
// CATALOG_ASSET_PATH = 完整圖鑑靜態資產的網址 (public/catalog/<指紋>.json)。
//   由 Workers Assets 直接供應 → 命中時我們的 Worker 完全不執行 (0 CPU),
//   檔名帶指紋所以敢對它下 immutable 一年 (見 public/_headers)。
//
// 這個檔 client / server 都會 import, 所以只能放純常數 (不要 import server-only 的東西)。

export const CATALOG_VERSION = "1n11plf";

export const CATALOG_ASSET_PATH = "/catalog/1n11plf.json";
