// 匯出成 PNG 的共用畫法 —— 貼到賴群的圖都從這裡畫 (排刀表 2026-10-02、比較 2026-11-06)。
// 自己用 canvas 畫, 不加截圖套件: 版面都是格子表, 畫起來比讓套件去抓 DOM (字型、捲動中的表格、側板) 穩。
// 從 battle-plan.tsx 抽出來的 —— 兩張圖的頭像、字型、斷行、下載是同一份, 不要各寫各的。

import { avatarText, nameHue, type MemberCardData } from "@/components/gym/member-card";
import type { SyncPairType } from "@/lib/supabase/types";

export const TYPE_HEX: Record<SyncPairType, string> = {
  normal: "#a8a878",
  fire: "#f08030",
  water: "#6890f0",
  electric: "#f8d030",
  grass: "#78c850",
  ice: "#98d8d8",
  fighting: "#c03028",
  poison: "#a040a0",
  ground: "#e0c068",
  flying: "#a890f0",
  psychic: "#f85888",
  bug: "#a8b820",
  rock: "#b8a038",
  ghost: "#705898",
  dragon: "#7038f8",
  dark: "#705848",
  steel: "#b8b8d0",
  fairy: "#ee99ac",
};
export const FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';

/** 匯出圖的底色 / 卡片 / 框線 / 字 —— 與畫面的米白主題同一組 */
export const INK = {
  bg: "#faf7f0",
  card: "#ffffff",
  head: "#f3eee4",
  border: "#e7e0d2",
  line: "#efe9dd",
  text: "#1f2937",
  muted: "#8a8174",
} as const;

/** 依寬度斷行 (中文沒有空白, 逐字量) */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > width) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** 名字放不下時從括號前斷 (「小伊布(Norma / n)」→「小伊布 / (Norman)」), 括號裡再放不下才逐字斷 */
export function wrapLabel(ctx: CanvasRenderingContext2D, label: string, width: number): string[] {
  const i = label.indexOf("(");
  if (ctx.measureText(label).width <= width || i <= 0) return wrap(ctx, label, width);
  return [...wrap(ctx, label.slice(0, i), width), ...wrap(ctx, label.slice(i), width)];
}

/** 一行放不下就截掉尾巴補「…」 */
export function ellipsis(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t && ctx.measureText(t + "…").width > width) t = t.slice(0, -1);
  return t + "…";
}

/** 成員在圖上的樣子 = 頭像 + 名字, 與畫面上一致 */
export type ExportMember = { m: MemberCardData | undefined; label: string };

export const AV = 24; // 頭像直徑 (排刀表)
export const AV_GAP = 6;

export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  em: ExportMember,
  images: Map<string, HTMLImageElement>,
  x: number,
  cy: number,
  size = AV,
) {
  const r = size / 2;
  const cx = x + r;
  const img = em.m?.avatarUrl ? images.get(em.m.avatarUrl) : undefined;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (img) {
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, size, size);
  } else {
    // 沒頭貼 = 與 MemberAvatar 同一個底色與縮寫
    const hue = nameHue(em.m?.displayName ?? em.label);
    ctx.fillStyle = `hsl(${hue} 52% 52%)`;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(size * 0.46)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(em.m ? avatarText(em.m) : "?", cx, cy + 0.5);
  }
  ctx.restore();
}

/**
 * 抓圖 (頭貼 / 卡面): 抓不到 (或 CORS 不給) 就略過, 不讓整張圖匯不出來 ——
 * 頭貼退回縮寫圓圈, 卡面就空著。
 */
export async function loadImages(urls: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...new Set(urls)].map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          const timer = setTimeout(resolve, 4000);
          img.onload = () => {
            clearTimeout(timer);
            out.set(url, img);
            resolve();
          };
          img.onerror = () => {
            clearTimeout(timer);
            resolve();
          };
          img.src = url;
        }),
    ),
  );
  return out;
}

/** 把屬性色往黑色混 (f=0.45 → 深 45%), 給卡頭的字用 */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - f));
  return `rgb(${ch((n >> 16) & 255)} ${ch((n >> 8) & 255)} ${ch(n & 255)})`;
}
/** 屬性色的淡底 (= 畫面上 TYPE_COLORS 那種 20% 底色) */
export function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 2 倍解析度的畫布 (手機看圖會放大, 1 倍字會糊); 呼叫端照邏輯尺寸畫 */
export function makeCanvas(w: number, h: number, scale = 2) {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * scale);
  cv.height = Math.ceil(h * scale);
  const ctx = cv.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  return { cv, ctx };
}

/** 存成 PNG 下載 */
export function downloadCanvas(cv: HTMLCanvasElement, filename: string) {
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
