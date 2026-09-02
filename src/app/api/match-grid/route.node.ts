import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { matchScreenshot, type GridOpts } from "@/lib/server/embed-matcher";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// embedding 辨識較慢 (model cold start + 20 格), 拉長 timeout
export const maxDuration = 300;

const DEFAULT_GRID: GridOpts = {
  cols: 4,
  rows: 5,
  top: 0.355,
  bottom: 0.895,
  left: 0.025,
  right: 0.975,
  gap: 0.05,
};

// client 送的 grid 不可信任: 不驗證的話 {cols:1e5,rows:1e5} 會在 fallback 路徑炸出
// 數十億個 cell rect / 推論 → 放大型 DoS。全部欄位收斂到合理範圍, 並硬限 cols*rows。
const MAX_CELLS = 60;
const gridSchema = z
  .object({
    cols: z.number().int().min(1).max(10),
    rows: z.number().int().min(1).max(10),
    top: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
    left: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    gap: z.number().min(0).max(0.4),
  })
  .partial()
  .transform((g) => ({ ...DEFAULT_GRID, ...g }))
  .refine((g) => g.left < g.right && g.top < g.bottom, "grid 邊界無效")
  .refine((g) => g.cols * g.rows <= MAX_CELLS, `grid 格數過多 (上限 ${MAX_CELLS})`);

// 拒絕過大圖片避免 sharp 把 server RAM 吃光 (典型截圖 1080-3000px 就夠了)
const MAX_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_DIM = 4096;

export async function POST(request: Request) {
  try {
    // 截圖辨識僅本機開發啟用 (線上版隱藏, 與 /upload 頁一致)
    if (process.env.NEXT_PUBLIC_ENABLE_RECOGNITION !== "1") {
      return NextResponse.json({ error: "辨識功能未啟用" }, { status: 404 });
    }
    // 這條 endpoint 跑昂貴的 ML 推論; 不要只靠 proxy 當唯一 auth 關卡 (防守縱深 + 乾淨的 401)。
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "未登入" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "缺少 image 欄位" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `圖檔太大 (${(file.size / 1024 / 1024).toFixed(1)}MB), 上限 ${MAX_BYTES / 1024 / 1024}MB` },
        { status: 413 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());

    // 解圖前先 metadata-only probe 確認尺寸 (sharp 不會 decode pixels 直到 .toBuffer())
    const probe = await sharp(buf).metadata();
    if ((probe.width ?? 0) > MAX_DIM || (probe.height ?? 0) > MAX_DIM) {
      return NextResponse.json(
        { error: `圖片解析度過高 (${probe.width}×${probe.height}), 上限 ${MAX_DIM}px` },
        { status: 413 }
      );
    }

    const gridJson = formData.get("grid");
    let grid: GridOpts = DEFAULT_GRID;
    if (typeof gridJson === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(gridJson);
      } catch {
        return NextResponse.json({ error: "grid 不是合法 JSON" }, { status: 400 });
      }
      const result = gridSchema.safeParse(parsed);
      if (!result.success) {
        return NextResponse.json({ error: "grid 參數無效" }, { status: 400 });
      }
      grid = result.data;
    }

    const filterType = formData.get("filterType");
    const result = await matchScreenshot(buf, grid, {
      autoDetect: true,
      filterType: typeof filterType === "string" ? filterType : undefined,
    });

    // 轉成上傳前端要的精簡格式 (含 EX style + 候選 + 超覺醒)
    const cells = result.cells.map((c) => {
      const top = c.candidates[0];
      const second = c.candidates[1];
      return {
        index: c.index,
        row: c.row,
        col: c.col,
        cellDataUrl: c.cellDataUrl,
        // 只回 pairId; client 已有完整 catalog (pairsById), 不需要每格再塞一份 40+ 欄位 record
        bestPairId: c.bestPair?.pairId ?? null,
        candidates: c.candidates.map((cand) => ({
          pairId: cand.pair.pairId,
          trainerId: cand.pair.trainerId,
          pokemonId: cand.pair.pokemonId,
          trainerName: cand.pair.trainerName,
          trainerNameZh: cand.pair.trainerNameZh ?? null,
          pokemonName: cand.pair.pokemonName,
          pokemonNameZh: cand.pair.pokemonNameZh ?? null,
          type: cand.pair.type,
          score: cand.score,
        })),
        score: top?.score ?? 0,
        gap: (top?.score ?? 0) - (second?.score ?? 0),
        metadata: {
          starCount: c.metadata.starCount,
          exUnlocked: c.metadata.exUnlocked,
          currentRarity: c.metadata.currentRarity,
          level: c.metadata.level,
          potential: c.metadata.potential,
          superAwakening: c.metadata.superAwakening,
        },
        exStyle: c.exStyle,
      };
    });

    return NextResponse.json({
      cells,
      durationMs: result.durationMs,
      detectMode: result.detectMode,
      detectReason: result.detectReason,
    });
  } catch (e) {
    // 完整錯誤只記在 server; 回給 client 的是通用訊息 (避免洩漏 sharp/onnx 內部細節)。
    console.error("[match-grid] error:", e);
    return NextResponse.json(
      { error: "辨識服務發生錯誤, 請稍後再試" },
      { status: 500 }
    );
  }
}
