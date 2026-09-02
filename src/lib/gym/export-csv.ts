"use client";

// 成員 × 拍組 CSV 匯出 — 架構對齊道館慣用的調查表:
//   一列一成員 (遊戲名/社群名), 一欄一個道館拍組 (欄名 = 拍組名, 依屬性排序),
//   值 = 無持有 / 寶1-5 / 超覺醒1-5 (與站內同一條軸)。

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ALL_TYPES } from "@/data/sync-pairs";
import { GRADE_LABELS } from "@/lib/gym/types";
import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export async function buildMembersCsv(
  supabase: SupabaseClient,
  gymId: string,
  members: { id: string; displayName: string; lineName: string | null; role: string }[],
  catalog: ClientPairRecord[]
): Promise<string> {
  // 兩支都分頁全量 (member_pairs 線上 2055 列, 單次查詢只會回「剛好 1000 列」且不報錯),
  // 並且都補 `.order("id")` —— offset 分頁沒有穩定排序時, 讀取期間的寫入會讓列位移,
  // 邊界重複/漏列。CSV 的呈現順序不受影響: 欄序在下面依「屬性 → 拍組名」重排,
  // 列序依傳進來的 members, 練度用 Map 查 (同鍵取 max)。
  const [gymPairs, grades] = await Promise.all([
    fetchAllRows<{ pair_id: string | null; type: SyncPairType }>((a, b) =>
      supabase.from("gym_pairs").select("pair_id, type").eq("gym_id", gymId).order("id").range(a, b)
    ),
    fetchAllRows<{ member_id: string; pair_id: string | null; grade: number }>((a, b) =>
      supabase
        .from("member_pairs")
        .select("member_id, pair_id, grade")
        .eq("gym_id", gymId)
        .order("id")
        .range(a, b)
    ),
  ]);

  const byId = new Map(catalog.map((p) => [p.pairId, p]));

  // 欄 = 道館拍組名單, 依屬性順序再依名稱; 欄名就是拍組名, 不加別的
  const cols = gymPairs
    .filter((g): g is { pair_id: string; type: SyncPairType } => !!g.pair_id && byId.has(g.pair_id))
    .sort((a, b) => {
      const t = ALL_TYPES.indexOf(a.type) - ALL_TYPES.indexOf(b.type);
      if (t !== 0) return t;
      return pairName(byId.get(a.pair_id)!).localeCompare(pairName(byId.get(b.pair_id)!), "zh-Hant");
    });

  const header = ["遊戲名字", "社群名字", ...cols.map((c) => pairName(byId.get(c.pair_id)!))];

  const gradeByKey = new Map<string, number>();
  for (const g of grades) {
    if (!g.pair_id) continue;
    const k = `${g.member_id}|${g.pair_id}`;
    gradeByKey.set(k, Math.max(gradeByKey.get(k) ?? 0, g.grade));
  }

  const lines = [header.map(csvCell).join(",")];
  for (const m of members.filter((m) => m.role !== "advisor")) {
    const row = [
      m.displayName,
      m.lineName ?? "",
      ...cols.map((c) => GRADE_LABELS[gradeByKey.get(`${m.id}|${c.pair_id}`) ?? 0] ?? "無持有"),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  // BOM — Excel 才不會把繁中開成亂碼
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
