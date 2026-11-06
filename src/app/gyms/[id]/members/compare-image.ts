// 成員頁「比較」的下載圖片 (2026-11-06 使用者:「幫我加個下載按鈕好了 可以匯出這張圖片」)。
// 原本大家是去全館拍組一張一張開側板、截圖、拼起來貼賴群 —— 這張圖就是要直接取代那個截圖。
//
// 畫的是**畫面上那幾張精簡表格本人**: 同樣的順序 (含排序)、同樣收起來的「其餘 N 人」(同一句, 呼叫端給)、
// 格子是同一顆「寶N」徽章 (GRADE_SWATCH = GradeBadge 的同一組顏色)、欄頭是同一張官方卡面。
// 資源表 (同日:「可以再幫我加比較資源的部分嗎?」) 也一起畫: 道具的欄頭是背包那一格 (同一張圓盤 + 道具圖),
// 投入屬性的格子是同一套屬性圖示。
// 零件 (頭像 / 字型 / 斷行 / 下載) 與排刀表的匯出圖共用 (components/gym/export-image.ts)。
// 這個檔只在按下載時才 dynamic import, 不進成員頁的首包。

import { candyIconSrc, candyPlateSrc, type CandyType } from "@/components/gym/candy";
import { GRADE_SWATCH } from "@/components/gym/gym-ui";
import { TYPE_FOCUS_KINDS, TYPE_FOCUS_LABELS, type TypeFocus } from "@/components/gym/type-focus";
import {
  FONT,
  INK,
  TYPE_HEX,
  downloadCanvas,
  drawAvatar,
  ellipsis,
  loadImages,
  makeCanvas,
  roundRect,
  shade,
  tint,
  wrap,
  type ExportMember,
} from "@/components/gym/export-image";
import { cardImageUrl } from "@/components/sync-pair-card";
import { TYPE_LABELS, typeIconUrl } from "@/data/sync-pairs";
import { GRADE_LABELS } from "@/lib/gym/types";
import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

type Common = {
  /** 表格下面那一行 (「其餘 N 人都沒有：…」), 沒有人被收起來 = null */
  restNote: string | null;
  /** 表格畫不出來時的那一行 (例: 道館名單上沒有這個屬性的拍組 / 選到的人都沒有) */
  empty?: string;
};

export type CompareImageGroup =
  | (Common & {
      kind: "pairs";
      /** null = 指定拍組 */
      type: SyncPairType | null;
      pairs: { rec: ClientPairRecord; starred: boolean; holders: number }[];
      /** 這張表比了幾個人 (含收在下面那一行的) */
      total: number;
      /** 已經照畫面的順序排好; grades[i] = 第 i 組拍組的寶數 (0-10, 0 = 沒有) */
      members: { em: ExportMember; grades: number[] }[];
    })
  | (Common & {
      kind: "items";
      label: string;
      items: CandyType[];
      /** counts[i] = 第 i 種道具的數量 (0 = 空著) */
      members: { em: ExportMember; counts: number[] }[];
    })
  | (Common & {
      kind: "focus";
      label: string;
      members: { em: ExportMember; focus: TypeFocus }[];
    });

const PAD = 24;
const GROUP_GAP = 28;
const TITLE_H = 52;
const LABEL_H = 24;
const LABEL_GAP = 10;
const MEM_W = 156;
const ROW_H = 40;
const AV_SIZE = 28;
const NOTE_LINE = 18;
// 拍組欄
const COL_W = 84;
const CARD = 52;
const NAME_LINE = 14;
const PAIR_HEAD_H = 10 + CARD + 6 + NAME_LINE * 2 + 4 + 14 + 8;
// 道具欄
const ITEM_W = 56;
const PLATE = 38;
const ITEM_HEAD_H = 10 + PLATE + 10;
// 投入屬性欄
const FOCUS_W = 200;
const FOCUS_HEAD_H = 34;
const TYPE_ICON = 22;
const TYPE_STEP = TYPE_ICON + 3;
const TYPES_PER_LINE = Math.floor((FOCUS_W - 20 + 3) / TYPE_STEP);

export async function exportCompareImage(
  groups: CompareImageGroup[],
  { title, subtitle, filename }: { title: string; subtitle: string; filename: string },
) {
  const urls = groups.flatMap((g) => [
    ...(g.kind === "pairs" ? g.pairs.map((p) => cardImageUrl(p.rec)) : []),
    ...(g.kind === "items" ? g.items.flatMap((t) => [candyPlateSrc(t), candyIconSrc(t)]) : []),
    ...(g.kind === "focus"
      ? g.members.flatMap((r) => TYPE_FOCUS_KINDS.flatMap((k) => r.focus[k].map(typeIconUrl)))
      : []),
    ...g.members.map((r) => r.em.m?.avatarUrl).filter((u): u is string => !!u),
  ]);
  const images = await loadImages([...new Set(urls)]);
  downloadCanvas(drawCompareImage(groups, title, subtitle, images), filename);
}

/** 值那幾欄一共多寬 */
function valuesW(g: CompareImageGroup): number {
  if (g.kind === "pairs") return g.pairs.length * COL_W;
  if (g.kind === "items") return g.items.length * ITEM_W;
  return TYPE_FOCUS_KINDS.length * FOCUS_W;
}

function headH(g: CompareImageGroup): number {
  return g.kind === "pairs" ? PAIR_HEAD_H : g.kind === "items" ? ITEM_HEAD_H : FOCUS_HEAD_H;
}

/** 每一列多高 —— 只有投入屬性會因為選了很多個屬性而折行 */
function rowHeights(g: CompareImageGroup): number[] {
  if (g.kind !== "focus") return g.members.map(() => ROW_H);
  return g.members.map((r) => {
    const lines = Math.max(1, ...TYPE_FOCUS_KINDS.map((k) => Math.ceil(r.focus[k].length / TYPES_PER_LINE)));
    return Math.max(ROW_H, lines * TYPE_STEP + 12);
  });
}

function drawCompareImage(
  groups: CompareImageGroup[],
  title: string,
  subtitle: string,
  images: Map<string, HTMLImageElement>,
): HTMLCanvasElement {
  const measure = document.createElement("canvas").getContext("2d")!;
  const hasTable = (g: CompareImageGroup) => !g.empty && g.members.length > 0 && valuesW(g) > 0;
  const tableW = (g: CompareImageGroup) => MEM_W + valuesW(g);
  const innerW = Math.max(320, ...groups.map((g) => (hasTable(g) ? tableW(g) : 0)));

  // ── 版面 ──
  measure.font = `12px ${FONT}`;
  const laid = groups.map((g) => {
    const note = g.empty
      ? [g.empty]
      : g.restNote
        ? wrap(measure, g.restNote, hasTable(g) ? tableW(g) : innerW)
        : [];
    const rows = hasTable(g) ? rowHeights(g) : [];
    const tableH = hasTable(g) ? headH(g) + rows.reduce((a, b) => a + b, 0) : 0;
    const h = LABEL_H + LABEL_GAP + tableH + (note.length ? (tableH ? 8 : 0) + note.length * NOTE_LINE : 0);
    return { g, note, rows, tableH, h };
  });
  const W = PAD * 2 + innerW;
  const H =
    PAD + TITLE_H + laid.reduce((a, l) => a + l.h, 0) + GROUP_GAP * Math.max(0, laid.length - 1) + PAD;

  // ── 畫 ──
  const { cv, ctx } = makeCanvas(W, H);
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "left";
  ctx.fillStyle = INK.text;
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(title, PAD, PAD + 12);
  ctx.fillStyle = INK.muted;
  ctx.font = `13px ${FONT}`;
  ctx.fillText(subtitle, PAD, PAD + 36);

  let y = PAD + TITLE_H;
  for (const { g, note, rows, tableH, h } of laid) {
    drawLabel(ctx, g, PAD, y, images);
    let ty = y + LABEL_H + LABEL_GAP;
    if (tableH) {
      drawTable(ctx, g, rows, PAD, ty, images);
      ty += tableH + 8;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = INK.muted;
    ctx.font = `12px ${FONT}`;
    note.forEach((line, i) => ctx.fillText(line, PAD, ty + NOTE_LINE / 2 + i * NOTE_LINE));
    y += h + GROUP_GAP;
  }
  return cv;
}

/**
 * 表格上面那一列 —— 與畫面同一個長相: 屬性徽章 (屬性色淡底) +「N 組」/「指定拍組」+「N 組」/
 * 資源的灰色徽章 (道具組前面一顆道具圖)。
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  g: CompareImageGroup,
  x: number,
  y: number,
  images: Map<string, HTMLImageElement>,
) {
  const type = g.kind === "pairs" ? g.type : null;
  const text = g.kind === "pairs" ? (type ? TYPE_LABELS[type] : "指定拍組") : g.label;
  const icon = g.kind === "items" ? images.get(candyIconSrc(g.items[0]!)) : undefined;
  const iconW = icon ? 18 : 0;
  ctx.font = `600 12px ${FONT}`;
  const w = ctx.measureText(text).width + 20 + iconW;
  roundRect(ctx, x, y, w, LABEL_H, LABEL_H / 2);
  ctx.fillStyle = type ? tint(TYPE_HEX[type], 0.22) : INK.line;
  ctx.fill();
  if (icon) ctx.drawImage(icon, x + 8, y + (LABEL_H - 16) / 2, 16, 16);
  ctx.fillStyle = type ? shade(TYPE_HEX[type], 0.45) : INK.text;
  ctx.textAlign = "center";
  ctx.fillText(text, x + iconW + (w - iconW) / 2, y + LABEL_H / 2 + 0.5);
  if (g.kind === "pairs") {
    ctx.textAlign = "left";
    ctx.fillStyle = INK.muted;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`${g.pairs.length} 組`, x + w + 8, y + LABEL_H / 2 + 0.5);
  }
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  g: CompareImageGroup,
  rows: number[],
  x: number,
  y: number,
  images: Map<string, HTMLImageElement>,
) {
  const w = MEM_W + valuesW(g);
  const hh = headH(g);
  const h = hh + rows.reduce((a, b) => a + b, 0);
  // 外框 + 欄頭底色
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = INK.card;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = INK.head;
  ctx.fillRect(x, y, w, hh);
  ctx.restore();

  drawHead(ctx, g, x + MEM_W, y, images);

  // 一列一個人
  let ry = y + hh;
  g.members.forEach((r, ri) => {
    const rh = rows[ri]!;
    ctx.fillStyle = INK.line;
    ctx.fillRect(x, ry, w, 1);
    const cy = ry + rh / 2;
    drawAvatar(ctx, r.em, images, x + 12, cy, AV_SIZE);
    ctx.textAlign = "left";
    ctx.fillStyle = INK.text;
    ctx.font = `14px ${FONT}`;
    const nx = x + 12 + AV_SIZE + 8;
    ctx.fillText(ellipsis(ctx, r.em.label, x + MEM_W - 8 - nx), nx, cy + 0.5);
    drawValues(ctx, g, ri, x + MEM_W, ry, rh, images);
    ry += rh;
  });
  // 外框線最後畫 (蓋在底色上面)
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 12);
  ctx.strokeStyle = INK.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 欄頭: 拍組 = 卡面 + 名字 (兩行) + 持有 n/人數 (★ 疊在左上角); 道具 = 背包那一格; 投入屬性 = 欄名 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  g: CompareImageGroup,
  x0: number,
  y: number,
  images: Map<string, HTMLImageElement>,
) {
  if (g.kind === "pairs") {
    g.pairs.forEach(({ rec, starred, holders }, i) => {
      const cx = x0 + i * COL_W + COL_W / 2;
      const top = y + 10;
      const img = images.get(cardImageUrl(rec));
      if (img) ctx.drawImage(img, cx - CARD / 2, top, CARD, CARD);
      if (starred) {
        ctx.fillStyle = "#f59e0b";
        ctx.font = `13px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText("★", cx - CARD / 2 - 6, top + 6);
      }
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = INK.text;
      ctx.textAlign = "center";
      const nameW = COL_W - 8;
      let lines = wrap(ctx, pairName(rec), nameW);
      if (lines.length > 2) lines = [lines[0]!, ellipsis(ctx, lines.slice(1).join(""), nameW)];
      const ny = top + CARD + 6 + NAME_LINE / 2;
      lines.forEach((l, li) => ctx.fillText(l, cx, ny + li * NAME_LINE));
      ctx.fillStyle = INK.muted;
      ctx.fillText(`${holders}/${g.total}`, cx, top + CARD + 6 + NAME_LINE * 2 + 4 + 7);
    });
    return;
  }
  if (g.kind === "items") {
    g.items.forEach((t, i) => {
      const cx = x0 + i * ITEM_W + ITEM_W / 2;
      const top = y + 10;
      const plate = images.get(candyPlateSrc(t));
      const icon = images.get(candyIconSrc(t));
      if (plate) ctx.drawImage(plate, cx - PLATE / 2, top, PLATE, PLATE);
      const s = Math.round(PLATE * 0.82);
      if (icon) ctx.drawImage(icon, cx - s / 2, top + (PLATE - s) / 2, s, s);
    });
    return;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = INK.muted;
  ctx.font = `500 12px ${FONT}`;
  TYPE_FOCUS_KINDS.forEach((k, i) => {
    ctx.fillText(ellipsis(ctx, TYPE_FOCUS_LABELS[k], FOCUS_W - 20), x0 + i * FOCUS_W + 10, y + FOCUS_HEAD_H / 2 + 1);
  });
}

function drawValues(
  ctx: CanvasRenderingContext2D,
  g: CompareImageGroup,
  ri: number,
  x0: number,
  ry: number,
  rh: number,
  images: Map<string, HTMLImageElement>,
) {
  const cy = ry + rh / 2;
  if (g.kind === "pairs") {
    g.members[ri]!.grades.forEach((grade, i) => {
      if (grade > 0) drawGradeBadge(ctx, grade, x0 + i * COL_W + COL_W / 2, cy);
    });
    return;
  }
  if (g.kind === "items") {
    ctx.textAlign = "center";
    ctx.fillStyle = INK.text;
    ctx.font = `600 14px ${FONT}`;
    g.members[ri]!.counts.forEach((n, i) => {
      if (n > 0) ctx.fillText(String(n), x0 + i * ITEM_W + ITEM_W / 2, cy + 0.5);
    });
    return;
  }
  const focus = g.members[ri]!.focus;
  TYPE_FOCUS_KINDS.forEach((k, i) => {
    const list = focus[k];
    const lines = Math.max(1, Math.ceil(list.length / TYPES_PER_LINE));
    const top = cy - (lines * TYPE_STEP - 3) / 2;
    list.forEach((t, ti) => {
      const img = images.get(typeIconUrl(t));
      if (!img) return;
      const col = ti % TYPES_PER_LINE;
      const line = Math.floor(ti / TYPES_PER_LINE);
      ctx.drawImage(img, x0 + i * FOCUS_W + 10 + col * TYPE_STEP, top + line * TYPE_STEP, TYPE_ICON, TYPE_ICON);
    });
  });
}

/** 與 GradeBadge 同一顆: 膠囊 h-5、text-xs、500 字重、500 階的淡底 + 700 階的字 */
function drawGradeBadge(ctx: CanvasRenderingContext2D, grade: number, cx: number, cy: number) {
  const g = Math.max(0, Math.min(grade, GRADE_LABELS.length - 1));
  const sw = GRADE_SWATCH[g]!;
  const text = GRADE_LABELS[g];
  ctx.font = `500 12px ${FONT}`;
  const bw = ctx.measureText(text).width + 16;
  roundRect(ctx, cx - bw / 2, cy - 10, bw, 20, 10);
  ctx.fillStyle = tint(sw.bg, sw.alpha);
  ctx.fill();
  ctx.fillStyle = sw.fg;
  ctx.textAlign = "center";
  ctx.fillText(text, cx, cy + 0.5);
}
