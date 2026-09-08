// 訓練家立繪取景工具的後端 —— **只在本機存在**。
//
// 檔名是 `.node.ts`: cloudflare build 的 pageExtensions 不含它, 所以這條路由在線上
// **根本不會被建出來** (不是執行期 404)。必須這樣, 因為它 import sharp (原生模組),
// Workers 載不動 —— 與截圖辨識那幾條同一個做法, 見 next.config.ts 檔頭。
//
// 它做兩件事:
//   POST { id, gain, dx, dy }          → 回傳裁好的 PNG (即時預覽, 不落地)
//   POST { id, gain, dx, dy, save:1 }  → 落地: 寫 PNG + 轉 WebP + 參數寫回
//                                        src/data/trainer-art.json
//
// 原圖從 ref/.art-src/ 的快取讀 (第一次會去 wiki 抓一次就留著) —— 拉滑桿要重算很多次,
// 不該每次都打 wiki。

import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

// scripts/ 是 .mjs, 這裡用相對路徑 import (兩邊共用同一份裁切邏輯與快取, 不要各自抄)
import { alignToNative, sourceBuffer } from "../../../../../scripts/lib-trainer-image.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA = path.join(process.cwd(), "src/data/trainer-art.json");
const TRAINER_DIR = path.join(process.cwd(), "public/reference/trainer");

type Target = { id: string; note: string; url: string; gain: number; dx: number; dy: number };
type Body = { id?: string; gain?: number; dx?: number; dy?: number; save?: boolean };

function readTargets(): { _note?: string; targets: Target[] } {
  return JSON.parse(readFileSync(DATA, "utf8"));
}

export async function POST(req: Request) {
  // 保險: 這條路由在線上不該存在, 萬一被建出來也要擋死
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "本機限定" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "請求不是 JSON" }, { status: 400 });
  }

  const data = readTargets();
  const target = data.targets.find((t) => t.id === body.id);
  if (!target) {
    return NextResponse.json({ error: `找不到 ${body.id}` }, { status: 404 });
  }

  const gain = Number.isFinite(body.gain) ? Number(body.gain) : target.gain;
  const dx = Number.isFinite(body.dx) ? Number(body.dx) : target.dx;
  const dy = Number.isFinite(body.dy) ? Number(body.dy) : target.dy;

  let png: Buffer;
  try {
    const src = await sourceBuffer(target.id, target.url);
    png = await alignToNative(src, { gain, dx, dy });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "裁切失敗" },
      { status: 500 }
    );
  }

  if (!body.save) {
    // 預覽: 直接回 PNG, 前端用 blob URL 餵進真正的卡片
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }

  // 落地。WebP 的參數要與 scripts/convert-card-images.mjs 一致 (q90 + alphaQuality 100)
  // —— alpha 一走樣, 卡框內就會看到白邊。
  try {
    writeFileSync(path.join(TRAINER_DIR, `${target.id}_128.png`), png);
    await sharp(png)
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toFile(path.join(TRAINER_DIR, `${target.id}_128.webp`));
    // 參數寫回單一來源, 之後 npm run art:trainer 重跑會產出同一張
    for (const t of data.targets) {
      if (t.id === target.id) Object.assign(t, { gain, dx, dy });
    }
    writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "寫檔失敗" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: target.id, gain, dx, dy });
}
