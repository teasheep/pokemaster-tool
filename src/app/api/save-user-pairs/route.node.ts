// 把使用者確認的截圖辨識結果寫入 Supabase user_collection
//   1. zod 驗證 client 送的 items (上限筆數 / notes 長度 / 型別)
//   2. 用 pomatools JSON catalog 確認每個 pairId 真實存在
//   3. 直接以 string pair_id upsert user_collection (user_id + pair_id 唯一)
//      — 不再經 sync_pairs slug 中轉, 也不依賴 seed-sync-pairs.mjs

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { loadPairsById } from "@/lib/pairs/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const itemSchema = z.object({
  pairId: z.string().min(1).max(64),
  starLevel: z.number().optional(),
  level: z.number().optional(),
  exUnlocked: z.boolean().optional(),
  exStyleWorn: z.boolean().optional(),
  potential: z.number().nullish(),
  superAwakening: z.number().nullish(),
  notes: z.string().max(2000).nullish(),
});
const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "未登入" }, { status: 401 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "items 格式不符 (最多 200 筆, notes 最長 2000 字)" },
        { status: 400 }
      );
    }
    const { items } = parsed.data;

    const pomaMap = await loadPairsById();

    type UpsertRow = {
      user_id: string;
      pair_id: string;
      owned: true;
      level: number;
      promotion: number;
      potential: number;
      super_awakening: number;
      ex_unlocked: boolean;
      ex_style_worn: boolean;
      notes: string | null;
    };
    const rows: UpsertRow[] = [];
    const results: Array<{ pairId: string; ok: boolean; error?: string; displayName?: string }> = [];
    const rowDisplay = new Map<string, string>();

    for (const item of items) {
      const poma = pomaMap.get(item.pairId);
      if (!poma) {
        results.push({ pairId: item.pairId, ok: false, error: "catalog 找不到此 pair" });
        continue;
      }
      const displayName = `${poma.trainerNameZh ?? poma.trainerName} & ${poma.pokemonNameZh ?? poma.pokemonName}`;
      rowDisplay.set(item.pairId, displayName);
      rows.push({
        user_id: user.id,
        pair_id: item.pairId,
        owned: true,
        level: clamp(item.level ?? 1, 1, 200),
        promotion: clamp(item.starLevel ?? poma.basePotential ?? 3, 1, 6),
        potential: clamp(item.potential ?? 0, 0, 5),
        super_awakening: clamp(item.superAwakening ?? 0, 0, 5),
        ex_unlocked: item.exUnlocked ?? false,
        // EX 裝依附在 6★EX 上, 且此拍組要真的有換裝 (catalog hasExStyle)
        ex_style_worn:
          (item.exStyleWorn ?? false) && (item.exUnlocked ?? false) && poma.hasExStyle === true,
        notes: item.notes ?? null,
      });
    }

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("user_collection")
        .upsert(rows, { onConflict: "user_id,pair_id" });

      if (upErr) {
        console.error("[save-user-pairs] upsert error:", upErr);
        for (const r of rows) {
          results.push({ pairId: r.pair_id, ok: false, error: "寫入失敗, 請重試" });
        }
      } else {
        for (const r of rows) {
          results.push({ pairId: r.pair_id, ok: true, displayName: rowDisplay.get(r.pair_id) });
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: true, saved: okCount, total: items.length, results });
  } catch (e) {
    console.error("[save-user-pairs] error:", e);
    return NextResponse.json({ error: "儲存服務發生錯誤, 請稍後再試" }, { status: 500 });
  }
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
