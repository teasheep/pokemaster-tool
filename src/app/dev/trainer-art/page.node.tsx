// 訓練家立繪的取景工具 —— **只在本機存在** (檔名 `.node.tsx`, cloudflare build 的
// pageExtensions 不含它, 線上根本不會被建出來; 與截圖辨識頁同一個做法)。
//
// 為什麼要有這頁 (2026-09-08 使用者要求):
// 通用職業 NPC 與主角的立繪 brybry 給的是全身圖, 要自己重裁成頭肩胸像。
// 「頭多大、在哪」有**正確答案** —— 官方遊戲內的顯示方式, 也就是那 460 張原生縮圖 ——
// 但對齊它們需要肉眼比對, 而且我之前**比對裸圖判斷錯過一次**:
// 卡片只顯示原圖的 x 20..108 / y 17..111, 裸圖看起來一致不代表卡片上一致。
// 所以這頁一律用**真正的 SyncPairCard** 並排原生基準, 拉滑桿即時看結果。

import { notFound } from "next/navigation";

import { loadPairs, toClientPair } from "@/lib/pairs/loader";
import trainerArt from "@/data/trainer-art.json";
import { TrainerArtClient } from "./trainer-art-client";

export const dynamic = "force-dynamic";

export default async function TrainerArtDevPage() {
  // 保險絲: 這頁在線上不該存在, 萬一被建出來也要 404
  if (process.env.NODE_ENV === "production") notFound();

  // 這裡刻意用 loadPairs 而不是 loadPairsForClient: 工具頁要能處理**還沒上市**的拍組
  // (那正是最可能缺正確立繪的一批), 而它只在本機跑, 不是對外輸出。
  const all = (await loadPairs().catch(() => [])).map(toClientPair);

  const items = trainerArt.targets.map((t) => {
    const pair = all.find((p) => p.trainerId === t.id) ?? null;
    return { ...t, pair };
  });

  // 取景基準: 隨便挑幾張原生縮圖當尺 (它們就是官方的正確答案)
  const refIds = ["ch0000_80_red", "ch0002_00_kotone", "ch0008_00_erika"];
  const refs = refIds
    .map((id) => all.find((p) => p.trainerId === id) ?? null)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return <TrainerArtClient items={items} refs={refs} />;
}
