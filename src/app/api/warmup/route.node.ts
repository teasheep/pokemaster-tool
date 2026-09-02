// 預熱端點: 觸發 module-scope singletons (embedding cache / DINOv2 extractor /
// metadata templates / OCR worker pool), 讓第一個真實辨識 request 不必冷啟。
// 部署後可由 health-check / cron 打一次。輕量, 不需登入。
import { NextResponse } from "next/server";

import { warmup } from "@/lib/server/embed-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 冷啟載 model + cache 可能要數秒, 拉長 timeout
export const maxDuration = 120;

export async function GET() {
  try {
    // 截圖辨識僅本機開發啟用 (線上版連預熱都不跑, 避免載入 ML 依賴)
    if (process.env.NEXT_PUBLIC_ENABLE_RECOGNITION !== "1") {
      return NextResponse.json({ error: "辨識功能未啟用" }, { status: 404 });
    }
    await warmup();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[warmup] error:", e);
    return NextResponse.json({ ok: false, error: "預熱失敗" }, { status: 500 });
  }
}
