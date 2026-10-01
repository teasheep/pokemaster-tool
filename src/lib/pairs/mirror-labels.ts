// 補鏡像要傳給 backfill_my_member_pairs (0080) 的 pair_label 清單 —— 純函式, 沒有 "use client" 也沒有 server-only,
// 兩邊都 import 得到 (測試也是)。
//
// pair_label 一律走 pairLabel() —— member_pairs 的唯一鍵是 (member_id, pair_label), 寫法不一會讓同一張卡長出兩列
// (AGENTS「拍組顯示名一律 pairName()」)。資料庫沒有圖鑑, 所以由這裡算好傳進去。

import { pairLabel } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";

export type MirrorLabel = { pair_id: string; label: string };

/** 帳號持有的 pairId → 送進 RPC 的 [{pair_id, label}] (圖鑑查不到的跳過: 沒有名字就生不出 label) */
export function mirrorLabels(
  ownedPairIds: Iterable<string>,
  byId: ReadonlyMap<string, Pick<ClientPairRecord, "trainerName" | "pokemonName" | "trainerNameZh" | "pokemonNameZh">>
): MirrorLabel[] {
  const out: MirrorLabel[] = [];
  const seen = new Set<string>();
  for (const id of ownedPairIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (p) out.push({ pair_id: id, label: pairLabel(p) });
  }
  return out;
}
