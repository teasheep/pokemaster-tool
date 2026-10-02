"use client";

// 排刀表 (0083, 2026-10-02 使用者:「把排刀表那個格式長進系統內」)
//
// 照群組裡那張排刀表: 8 關各一張卡, 卡裡是自己取名的欄位 (預設 物攻 / 特攻), 加上全場一格的欄位
// (預設 降抗) 與一段敘述。全館成員都看得到、都能改, 顧問唯讀 (RLS 是 is_gym_editor)。
//
// 資料是三張表 (見 0083): 欄位 battle_plan_fields / 一格裡的一個人或那格備註 battle_plan_slots /
// 敘述 battle_plans。畫面吃的是由它們組出來的 Plan (欄位 → 每關的格子), 匯出圖也吃同一份。
// ⚠ **一人一列** —— 加人 = upsert 忽略重複, 拿掉 = 依 (欄位, 關卡, 成員) 刪除, 兩個都冪等,
//   多人同時在排也不會互相蓋掉 (別用「整格存一個陣列」那種寫法)。

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, COARSE_HIT_AREA } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import {
  MemberAvatar,
  MemberChip,
  avatarText,
  memberCallName,
  memberLabel,
  nameHue,
  type MemberCardData,
} from "@/components/gym/member-card";
import { useCatalogWithFullFallback } from "@/components/gym/pair-picker";
import { TypeIcon } from "@/components/sync-pair-badges";
import { SyncPairCard } from "@/components/sync-pair-card";
import { TYPE_COLORS, TYPE_LABELS } from "@/data/sync-pairs";
import { matchTemplate } from "@/lib/gym/battle-templates";
import { GRADE_LABELS } from "@/lib/gym/types";
import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  PLAN_FIELD_COLS,
  PLAN_SLOT_COLS,
  type PlanFieldRow,
  type PlanSlotRow,
} from "./battle-plan-data";

type Cell = { members: string[]; text: string };
type PlanRow = {
  id: string;
  label: string;
  wide: boolean;
  cells: Record<string, Cell>;
};
type Plan = { rows: PlanRow[]; note: string };

/** 整場一格的列, cells 只用這個 key */
const WIDE = "all";
const EMPTY_CELL: Cell = { members: [], text: "" };

/** 三張表 → 畫面用的 Plan (格子的 key: 關卡 id, 全場是 WIDE) */
function toPlan(fields: PlanFieldRow[], slots: PlanSlotRow[], note: string): Plan {
  const rows: PlanRow[] = [...fields]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => ({ id: f.id, label: f.label, wide: f.wide, cells: {} }));
  const byField = new Map(rows.map((r) => [r.id, r]));
  for (const s of slots) {
    const row = byField.get(s.field_id);
    if (!row) continue;
    const key = s.stage_id ?? WIDE;
    const cell = (row.cells[key] ??= { members: [], text: "" });
    if (s.member_id) cell.members.push(s.member_id);
    else if (s.note) cell.text = s.note;
  }
  return { rows, note };
}

// ── 匯出圖片 (2026-10-02 使用者:「這個區塊要可以單獨匯出」) ──
// 排刀表最後是貼到賴群的 → 匯出成 PNG。自己用 canvas 畫, 不加截圖套件:
// 版面就是一張格子表, 畫起來比讓套件去抓 DOM (字型、捲動中的表格、側板) 穩。
const TYPE_HEX: Record<SyncPairType, string> = {
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
const FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';

/** 依寬度斷行 (中文沒有空白, 逐字量) */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
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
function wrapLabel(ctx: CanvasRenderingContext2D, label: string, width: number): string[] {
  const i = label.indexOf("(");
  if (ctx.measureText(label).width <= width || i <= 0) return wrap(ctx, label, width);
  return [...wrap(ctx, label.slice(0, i), width), ...wrap(ctx, label.slice(i), width)];
}

/** 成員在圖上的樣子 = 頭像 + 社群名(遊戲名), 與畫面上一致 */
type ExportMember = { m: MemberCardData | undefined; label: string };

const AV = 24; // 頭像直徑
const AV_GAP = 6;

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  em: ExportMember,
  images: Map<string, HTMLImageElement>,
  x: number,
  cy: number,
) {
  const r = AV / 2;
  const cx = x + r;
  const img = em.m?.avatarUrl ? images.get(em.m.avatarUrl) : undefined;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (img) {
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, AV, AV);
  } else {
    // 沒頭貼 = 與 MemberAvatar 同一個底色與縮寫
    const hue = nameHue(em.m?.displayName ?? em.label);
    ctx.fillStyle = `hsl(${hue} 52% 52%)`;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(em.m ? avatarText(em.m) : "?", cx, cy + 0.5);
  }
  ctx.restore();
}

/** 頭貼是外部網址: 抓不到 (或 CORS 不給) 就退回縮寫圓圈, 不讓整張圖匯不出來 */
async function loadAvatars(urls: string[]): Promise<Map<string, HTMLImageElement>> {
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
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - f));
  return `rgb(${ch((n >> 16) & 255)} ${ch((n >> 8) & 255)} ${ch(n & 255)})`;
}
/** 屬性色的淡底 (= 畫面上 TYPE_COLORS 那種 20% 底色) */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}

function roundRect(
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

/**
 * 匯出的圖 = 畫面的長相 (2026-10-02 使用者:「下載圖片的圖也好看一點」):
 * 米白底 + 每關一張圓角卡 (卡頭屬性淡底 + 屬性徽章 + 館主) + 全場欄位一條 + 敘述一塊,
 * 人是頭像 + 社群名(遊戲名)。一排 4 張卡, 8 關剛好兩排, 貼到賴群一眼看完。
 */
function drawPlanImage(
  title: string,
  subtitle: string,
  stages: { id: string; weak_type: SyncPairType; leader?: string }[],
  plan: Plan,
  memberOf: (id: string) => ExportMember,
  images: Map<string, HTMLImageElement>,
): HTMLCanvasElement {
  const PAD = 28,
    COLS = Math.min(4, Math.max(1, stages.length)),
    CARD_W = 260,
    GAP = 14,
    HEAD_H = 42,
    IN = 14, // 卡片內距
    LINE = 20,
    LABEL_H = 22,
    ENTRY_GAP = 6;
  const W = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP;
  const innerW = W - PAD * 2;
  const BG = "#faf7f0",
    CARD = "#ffffff",
    BORDER = "#e7e0d2",
    INK = "#1f2937",
    MUTED = "#8a8174";
  const nameFont = `14px ${FONT}`;
  const labelFont = `600 12px ${FONT}`;
  const textFont = `12px ${FONT}`;
  const measure = document.createElement("canvas").getContext("2d")!;

  const stageRows = plan.rows.filter((r) => !r.wide);
  const wideRows = plan.rows.filter((r) => r.wide);

  // ── 版面 ──
  type Entry = { em: ExportMember; lines: string[] };
  type Section = { label: string; entries: Entry[]; text: string[]; h: number };
  const sectionOf = (row: PlanRow, c: Cell): Section => {
    measure.font = nameFont;
    const entries = c.members.map((id) => {
      const em = memberOf(id);
      return { em, lines: wrapLabel(measure, em.label, CARD_W - IN * 2 - AV - AV_GAP) };
    });
    measure.font = textFont;
    const text = c.text ? wrap(measure, c.text, CARD_W - IN * 2) : [];
    const body = entries.length
      ? entries.reduce((s, e) => s + Math.max(AV, e.lines.length * LINE) + ENTRY_GAP, 0) - ENTRY_GAP
      : LINE;
    return {
      label: row.label,
      entries,
      text,
      h: IN / 1.4 + LABEL_H + body + text.length * LINE + IN / 1.4,
    };
  };
  const cards = stages.map((s) =>
    stageRows.map((row) => sectionOf(row, row.cells[s.id] ?? EMPTY_CELL)),
  );
  const cardH = cards.map((secs) => HEAD_H + secs.reduce((a, x) => a + x.h, 0));
  const gridRows: number[] = [];
  for (let i = 0; i < stages.length; i += COLS)
    gridRows.push(Math.max(...cardH.slice(i, i + COLS)));

  // 全場欄位: 晶片 (頭像 + 名字) 橫排, 滿了換行
  type Chip = { em: ExportMember; x: number; line: number; w: number };
  const CHIP_H = 32;
  const wides = wideRows.map((row) => {
    const c = row.cells[WIDE] ?? EMPTY_CELL;
    measure.font = nameFont;
    const chips: Chip[] = [];
    let x = 0,
      line = 0;
    for (const id of c.members) {
      const em = memberOf(id);
      const w = 4 + AV + AV_GAP + measure.measureText(em.label).width + 12;
      if (x > 0 && x + w > innerW - IN * 2) {
        x = 0;
        line++;
      }
      chips.push({ em, x, line, w });
      x += w + 8;
    }
    measure.font = textFont;
    const text = c.text ? wrap(measure, c.text, innerW - IN * 2) : [];
    const lines = c.members.length ? line + 1 : 0;
    const h = IN + LABEL_H + Math.max(LINE, lines * (CHIP_H + 8) - 8) + text.length * LINE + IN;
    return { label: row.label, chips, text, lines, h };
  });

  measure.font = `14px ${FONT}`;
  const noteLines = plan.note.trim() ? wrap(measure, plan.note.trim(), innerW - IN * 2) : [];
  const noteH = noteLines.length ? IN + LABEL_H + noteLines.length * 22 + IN : 0;

  const HEADER_H = 64;
  const H =
    PAD +
    HEADER_H +
    gridRows.reduce((a, b) => a + b, 0) +
    GAP * Math.max(0, gridRows.length - 1) +
    wides.reduce((a, w) => a + GAP + w.h, 0) +
    (noteH ? GAP + noteH : 0) +
    PAD;

  // ── 畫 ──
  const scale = 2;
  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(title, PAD, PAD + 14);
  ctx.fillStyle = MUTED;
  ctx.font = `14px ${FONT}`;
  ctx.fillText(subtitle, PAD, PAD + 42);

  const card = (x: number, y: number, w: number, h: number) => {
    roundRect(ctx, x, y, w, h, 14);
    ctx.fillStyle = CARD;
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const drawEntry = (e: Entry, x: number, top: number) => {
    const bh = Math.max(AV, e.lines.length * LINE);
    drawAvatar(ctx, e.em, images, x, top + bh / 2);
    ctx.fillStyle = e.em.m ? INK : MUTED;
    ctx.font = nameFont;
    ctx.textAlign = "left";
    const ty = top + (bh - e.lines.length * LINE) / 2 + LINE / 2;
    e.lines.forEach((l, i) => ctx.fillText(l, x + AV + AV_GAP, ty + i * LINE));
    return bh;
  };

  let y = PAD + HEADER_H;
  gridRows.forEach((rowH, gi) => {
    for (let ci = 0; ci < COLS; ci++) {
      const si = gi * COLS + ci;
      const s = stages[si];
      if (!s) break;
      const x = PAD + ci * (CARD_W + GAP);
      card(x, y, CARD_W, rowH);
      // 卡頭: 屬性淡底 + 白色徽章 + 館主
      const hex = TYPE_HEX[s.weak_type];
      ctx.save();
      roundRect(ctx, x, y, CARD_W, HEAD_H, [14, 14, 0, 0]);
      ctx.fillStyle = tint(hex, 0.28);
      ctx.fill();
      ctx.restore();
      ctx.font = `bold 13px ${FONT}`;
      const tl = TYPE_LABELS[s.weak_type];
      const bw = ctx.measureText(tl).width + 20;
      roundRect(ctx, x + IN, y + 10, bw, 22, 11);
      ctx.fillStyle = "rgb(255 255 255 / 0.85)";
      ctx.fill();
      ctx.fillStyle = shade(hex, 0.45);
      ctx.textAlign = "center";
      ctx.fillText(tl, x + IN + bw / 2, y + 21);
      if (s.leader) {
        ctx.textAlign = "left";
        ctx.font = `600 14px ${FONT}`;
        ctx.fillText(s.leader, x + IN + bw + 10, y + 21, CARD_W - IN * 2 - bw - 10);
      }
      // 欄位一段一段
      let top = y + HEAD_H;
      cards[si].forEach((sec, k) => {
        if (k > 0) {
          ctx.strokeStyle = BORDER;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x + CARD_W, top);
          ctx.stroke();
        }
        let t = top + IN / 1.4;
        ctx.fillStyle = MUTED;
        ctx.font = labelFont;
        ctx.textAlign = "left";
        ctx.fillText(sec.label || "未命名欄位", x + IN, t + LABEL_H / 2 - 2);
        t += LABEL_H;
        if (!sec.entries.length) {
          ctx.fillStyle = "#c4bcae";
          ctx.font = nameFont;
          ctx.fillText("—", x + IN, t + LINE / 2);
          t += LINE;
        }
        sec.entries.forEach((e, i) => {
          t += drawEntry(e, x + IN, t) + (i < sec.entries.length - 1 ? ENTRY_GAP : 0);
        });
        ctx.fillStyle = MUTED;
        ctx.font = textFont;
        sec.text.forEach((l, i) => ctx.fillText(l, x + IN, t + i * LINE + LINE / 2));
        top += sec.h;
      });
    }
    y += rowH + (gi < gridRows.length - 1 ? GAP : 0);
  });

  for (const w of wides) {
    y += GAP;
    card(PAD, y, innerW, w.h);
    let t = y + IN;
    ctx.fillStyle = MUTED;
    ctx.font = labelFont;
    ctx.textAlign = "left";
    ctx.fillText(w.label || "未命名欄位", PAD + IN, t + LABEL_H / 2 - 2);
    t += LABEL_H;
    for (const c of w.chips) {
      const cx = PAD + IN + c.x;
      const cy = t + c.line * (CHIP_H + 8);
      roundRect(ctx, cx, cy, c.w, CHIP_H, CHIP_H / 2);
      ctx.fillStyle = "#fffdf8";
      ctx.fill();
      ctx.strokeStyle = BORDER;
      ctx.stroke();
      drawAvatar(ctx, c.em, images, cx + 4, cy + CHIP_H / 2);
      ctx.fillStyle = INK;
      ctx.font = nameFont;
      ctx.textAlign = "left";
      ctx.fillText(c.em.label, cx + 4 + AV + AV_GAP, cy + CHIP_H / 2);
    }
    if (!w.chips.length) {
      ctx.fillStyle = "#c4bcae";
      ctx.font = nameFont;
      ctx.fillText("—", PAD + IN, t + LINE / 2);
    }
    t += Math.max(LINE, w.lines * (CHIP_H + 8) - 8);
    ctx.fillStyle = MUTED;
    ctx.font = textFont;
    w.text.forEach((l, i) => ctx.fillText(l, PAD + IN, t + i * LINE + LINE / 2));
    y += w.h;
  }

  if (noteH) {
    y += GAP;
    card(PAD, y, innerW, noteH);
    ctx.fillStyle = MUTED;
    ctx.font = labelFont;
    ctx.textAlign = "left";
    ctx.fillText("敘述", PAD + IN, y + IN + LABEL_H / 2 - 2);
    ctx.fillStyle = INK;
    ctx.font = `14px ${FONT}`;
    noteLines.forEach((l, i) => ctx.fillText(l, PAD + IN, y + IN + LABEL_H + i * 22 + 11));
  }
  return cv;
}

export function BattlePlan({
  open,
  onOpenChange,
  gymId,
  battleId,
  battleName,
  canEdit,
  stages,
  members,
  memberGrades,
  catalog,
  fullCatalogUrl,
  gymPairsList,
  initialFields,
  initialSlots,
  initialNote,
}: {
  /** 區塊展開/收起 (由 battle-client 管, 狀態進網址 ?plan=1) */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gymId: string;
  battleId: string;
  battleName: string;
  /** 正式成員與管理員 (顧問唯讀) —— 與 RLS 的 is_gym_editor 同一條 */
  canEdit: boolean;
  stages: { id: string; weak_type: SyncPairType }[];
  members: MemberCardData[];
  memberGrades: Record<string, Record<string, number>>;
  catalog: ClientPairRecord[];
  /** 「全部該屬性拍組」要整本圖鑑, 按需載入 */
  fullCatalogUrl: string;
  gymPairsList: { pairId: string; type: SyncPairType }[];
  initialFields: PlanFieldRow[];
  initialSlots: PlanSlotRow[];
  initialNote: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [fields, setFields] = useState(initialFields);
  const [slots, setSlots] = useState(initialSlots);
  const [note, setNote] = useState(initialNote);
  const plan = useMemo(() => toPlan(fields, slots, note), [fields, slots, note]);

  /** 重抓 (別人改了 / 自己寫失敗要回滾) —— 回到分頁時抓一次, 5 秒節流, 與看板同一套新鮮度 */
  const refetch = async () => {
    const [f, sl, pl] = await Promise.all([
      supabase.from("battle_plan_fields").select(PLAN_FIELD_COLS).eq("battle_id", battleId),
      supabase
        .from("battle_plan_slots")
        .select(PLAN_SLOT_COLS)
        .eq("battle_id", battleId)
        .order("created_at")
        .order("id"),
      supabase.from("battle_plans").select("note").eq("battle_id", battleId).maybeSingle(),
    ]);
    if (f.data) setFields(f.data);
    if (sl.data) setSlots(sl.data);
    // 正在打敘述的人不要被重抓蓋掉
    if (!pl.error && document.activeElement !== noteRef.current) setNote(pl.data?.note ?? "");
  };
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    let last = Date.now();
    const onBack = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 5000) return;
      last = Date.now();
      void refetchRef.current();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, []);
  const failed = (what: string, message: string) => {
    toast.error(`${what}失敗`, { description: message });
    void refetch();
  };
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // ── 寫入 (畫面先變, 失敗才重抓回滾) ──
  const stageOf = (cellKey: string) => (cellKey === WIDE ? null : cellKey);
  const sameCell = (s: PlanSlotRow, fieldId: string, cellKey: string) =>
    s.field_id === fieldId && s.stage_id === stageOf(cellKey);

  const toggleMember = async (fieldId: string, cellKey: string, memberId: string) => {
    const stageId = stageOf(cellKey);
    const has = slots.some((s) => sameCell(s, fieldId, cellKey) && s.member_id === memberId);
    if (has) {
      setSlots((prev) =>
        prev.filter((s) => !(sameCell(s, fieldId, cellKey) && s.member_id === memberId)),
      );
      let q = supabase
        .from("battle_plan_slots")
        .delete()
        .eq("field_id", fieldId)
        .eq("member_id", memberId);
      q = stageId ? q.eq("stage_id", stageId) : q.is("stage_id", null);
      const { error } = await q;
      if (error) failed("移除", error.message);
    } else {
      setSlots((prev) => [
        ...prev,
        { field_id: fieldId, stage_id: stageId, member_id: memberId, note: null },
      ]);
      // 冪等: 別人剛好也加了同一個人 → 什麼都不做 (不要跳 duplicate key 的錯)
      const { error } = await supabase.from("battle_plan_slots").upsert(
        {
          gym_id: gymId,
          battle_id: battleId,
          field_id: fieldId,
          stage_id: stageId,
          member_id: memberId,
        },
        { onConflict: "field_id,stage_id,member_id", ignoreDuplicates: true },
      );
      if (error) failed("排入", error.message);
    }
  };

  /** 那一格的備註: 打字只改畫面, 離開輸入框才存 (空白 = 刪掉那一列) */
  const setCellText = (fieldId: string, cellKey: string, text: string) =>
    setSlots((prev) => {
      const rest = prev.filter((s) => !(sameCell(s, fieldId, cellKey) && s.member_id === null));
      return text
        ? [...rest, { field_id: fieldId, stage_id: stageOf(cellKey), member_id: null, note: text }]
        : rest;
    });
  const saveCellText = async (fieldId: string, cellKey: string, raw: string) => {
    const text = raw.trim();
    const stageId = stageOf(cellKey);
    if (!text) {
      let q = supabase
        .from("battle_plan_slots")
        .delete()
        .eq("field_id", fieldId)
        .is("member_id", null);
      q = stageId ? q.eq("stage_id", stageId) : q.is("stage_id", null);
      const { error } = await q;
      if (error) failed("儲存備註", error.message);
      return;
    }
    const { error } = await supabase.from("battle_plan_slots").upsert(
      {
        gym_id: gymId,
        battle_id: battleId,
        field_id: fieldId,
        stage_id: stageId,
        member_id: null,
        note: text,
      },
      { onConflict: "field_id,stage_id,member_id" },
    );
    if (error) failed("儲存備註", error.message);
  };

  const renameField = (id: string, label: string) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)));
  const saveFieldLabel = async (id: string, label: string) => {
    const { error } = await supabase
      .from("battle_plan_fields")
      .update({ label: label.trim() })
      .eq("id", id);
    if (error) failed("改欄位名稱", error.message);
  };
  /** 欄位裡有人時要按兩下才刪 (與名冊的叉叉同一個手勢) */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const deleteField = async (id: string) => {
    const used = slots.some((s) => s.field_id === id);
    if (used && confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSlots((prev) => prev.filter((s) => s.field_id !== id));
    const { error } = await supabase.from("battle_plan_fields").delete().eq("id", id);
    if (error) failed("刪除欄位", error.message);
  };
  const addField = async (wide: boolean) => {
    const sort = Math.max(0, ...fields.map((f) => f.sort_order)) + 1;
    const { data, error } = await supabase
      .from("battle_plan_fields")
      .insert({ gym_id: gymId, battle_id: battleId, label: "", wide, sort_order: sort })
      .select(PLAN_FIELD_COLS)
      .single();
    if (error || !data) {
      failed("新增欄位", error?.message ?? "");
      return;
    }
    setFields((prev) => [...prev, data]);
  };
  const saveNote = async (raw: string) => {
    const { error } = await supabase
      .from("battle_plans")
      .upsert({ battle_id: battleId, gym_id: gymId, note: raw }, { onConflict: "battle_id" });
    if (error) failed("儲存敘述", error.message);
  };

  const roster = useMemo(() => members.filter((m) => m.role !== "advisor"), [members]);
  const byId = useMemo(() => new Map(roster.map((m) => [m.id, m])), [roster]);
  const catById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);

  /** 同一個人在「每關一格」的列裡出現幾次 —— 超過一次標黃 (主打只站一格是館內規矩) */
  const stageCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of plan.rows) {
      if (r.wide) continue;
      for (const c of Object.values(r.cells))
        for (const id of c.members) n.set(id, (n.get(id) ?? 0) + 1);
    }
    return n;
  }, [plan]);

  const [editing, setEditing] = useState<{
    rowId: string;
    cellKey: string;
  } | null>(null);
  const editRow = editing ? plan.rows.find((r) => r.id === editing.rowId) : undefined;
  const editStage = editing ? stages.find((s) => s.id === editing.cellKey) : undefined;
  const editCell = editRow?.cells[editing!.cellKey] ?? EMPTY_CELL;

  /**
   * 候選人: 這關屬性的拍組全部列出來, 練度高的排前面 (2026-10-02 使用者:「不用幫他們分物攻特攻,
   * 就是把那個屬性的道館拍組/全體該屬性拍組列出來就好」)。
   * 範圍兩種: 道館拍組 (預設) / 全部該屬性拍組 (要整本圖鑑, 切過去才載)。
   * 成員排序 = 列出來那幾隻的練度加總 (寶N=N、覺N=5+N)。
   */
  const [pairScope, setPairScope] = useState<"gym" | "all">("gym");
  const heldIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of Object.values(memberGrades)) for (const id of Object.keys(g)) ids.add(id);
    return ids;
  }, [memberGrades]);
  const fullCatalog = useCatalogWithFullFallback(
    catalog,
    pairScope === "all" ? { ids: heldIds, fullCatalogUrl } : undefined,
  );
  const candidates = useMemo(() => {
    if (!editing) return [];
    const type = editStage?.weak_type;
    const pool = !type
      ? []
      : pairScope === "gym"
        ? gymPairsList
            .filter((g) => g.type === type)
            .map((g) => catById.get(g.pairId))
            .filter((p): p is ClientPairRecord => !!p)
        : fullCatalog.filter((p) => p.type === type);
    return roster
      .map((m) => {
        const g = memberGrades[m.id] ?? {};
        const held = pool
          .map((p) => ({ p, grade: g[p.pairId] ?? 0 }))
          .filter((x) => x.grade > 0)
          .sort((a, b) => b.grade - a.grade);
        return { m, score: held.reduce((sum, x) => sum + x.grade, 0), held };
      })
      .sort((a, b) => b.score - a.score || memberCallName(a.m).localeCompare(memberCallName(b.m)));
  }, [editing, editStage, pairScope, gymPairsList, fullCatalog, catById, roster, memberGrades]);

  const leaders = useMemo(() => matchTemplate(stages.map((s) => s.weak_type)), [stages]);

  const exportImage = async () => {
    const memberOf = (id: string) => {
      const m = byId.get(id);
      return { m, label: m ? memberLabel(m) : "（已離開）" };
    };
    const urls = plan.rows.flatMap((r) =>
      Object.values(r.cells).flatMap((c) =>
        c.members.map((id) => byId.get(id)?.avatarUrl).filter((u): u is string => !!u),
      ),
    );
    const images = await loadAvatars(urls);
    const withLeader = stages.map((s) => {
      const l = leaders?.byType.get(s.weak_type);
      return { ...s, leader: l ? `${l.leader}＆${l.pokemon}` : undefined };
    });
    const cv = drawPlanImage("排刀表", battleName, withLeader, plan, memberOf, images);
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${battleName}-排刀表.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // 版面跟著站上其他地方走 (2026-10-02 使用者:「表格的 UI 可以不要長那麼死板嗎? 跟我們系統的 UI 對齊」):
  // 不畫試算表格線, 改成看板那種「每關一張卡」—— 卡頭是屬性色 + 館主, 卡裡一個欄位一段,
  // 人用 MemberChip (頭像 + 社群名(遊戲名))。整場一格的欄位 (降抗支援手) 是卡片牆上方一整條。
  // 匯出的圖仍然是表格 (貼到賴群要一眼看完 8 關), 那是給群組看的版本, 不必跟畫面長一樣。
  const stageRows = plan.rows.filter((r) => !r.wide);
  const wideRows = plan.rows.filter((r) => r.wide);

  const renderSlot = (row: PlanRow, key: string, showLabel = true) => {
    const c = row.cells[key] ?? EMPTY_CELL;
    const body = (
      <>
        {showLabel ? (
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {row.label || "未命名欄位"}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5">
          {c.members.map((id) => {
            const m = byId.get(id);
            const dup = !row.wide && (stageCount.get(id) ?? 0) > 1;
            return m ? (
              <MemberChip
                key={id}
                member={m}
                className={cn(dup && "border-amber-400 bg-amber-50 dark:bg-amber-400/15")}
                right={
                  dup ? (
                    <span className="text-[10px] text-amber-700 dark:text-amber-300">
                      已排 {stageCount.get(id)} 格
                    </span>
                  ) : undefined
                }
              />
            ) : (
              <span key={id} className="text-xs text-muted-foreground">
                （已離開）
              </span>
            );
          })}
          {canEdit ? (
            <span className="inline-flex h-8 items-center rounded-full border border-dashed px-3 text-xs text-muted-foreground">
              {c.members.length ? "編輯" : "＋ 指派"}
            </span>
          ) : !c.members.length ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : null}
        </span>
        {c.text ? (
          <span className="mt-1.5 block whitespace-pre-wrap text-xs text-muted-foreground">
            {c.text}
          </span>
        ) : null}
      </>
    );
    return canEdit ? (
      <button
        type="button"
        onClick={() => setEditing({ rowId: row.id, cellKey: key })}
        className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        {body}
      </button>
    ) : (
      <div className="px-3 py-2.5">{body}</div>
    );
  };

  /** 欄位名稱列: 可改名、可刪、可新增。每關欄位與全場欄位各一列, 放在各自的區塊旁邊 */
  const fieldBar = (rows: PlanRow[], wide: boolean) =>
    canEdit ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((row) => (
          <span
            key={row.id}
            className="inline-flex h-8 items-center gap-1 rounded-full border bg-background pl-3 pr-1 text-sm shadow-sm"
          >
            <input
              value={row.label}
              maxLength={20}
              placeholder="欄位名稱"
              // 寬度用 em 算: size 屬性是照英文字寬估的, 中文會被切掉一截
              style={{ width: `${Math.max(4, [...row.label].length) + 0.5}em` }}
              onChange={(e) => renameField(row.id, e.target.value)}
              onBlur={(e) => void saveFieldLabel(row.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="min-w-0 bg-transparent font-medium outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              title={confirmDelete === row.id ? "再按一次刪除 (欄位裡已經有人)" : "刪除欄位"}
              aria-label="刪除欄位"
              onClick={() => void deleteField(row.id)}
              onBlur={() => setConfirmDelete((c) => (c === row.id ? null : c))}
              className={cn(
                "relative rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-destructive",
                confirmDelete === row.id &&
                  "bg-destructive px-2 text-xs text-white hover:bg-destructive hover:text-white",
                COARSE_HIT_AREA,
              )}
            >
              {confirmDelete === row.id ? "確定刪除" : <X className="h-3.5 w-3.5" />}
            </button>
          </span>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-muted-foreground"
          onClick={() => void addField(wide)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {wide ? "新增欄位" : "新增關卡欄位"}
        </Button>
      </div>
    ) : null;

  return (
    // 一整塊可展開/收起 (2026-10-02 使用者:「排刀整塊做成一個區塊, 可以展開關閉, 不要用上面的開關, UI 不明」)
    <section className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left font-semibold pointer-coarse:min-h-11"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
          />
          排刀表
        </button>
        {open ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            onClick={() => void exportImage()}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            匯出圖片
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t p-3">
          {/* 每關欄位 (名稱自己填, 可加可刪) —— 在關卡卡片上方 */}
          {fieldBar(stageRows, false)}

          {/* 每關一張卡 —— 卡頭與看板的關卡卡片同一個長相 */}
          {stageRows.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {stages.map((s) => {
                const lead = leaders?.byType.get(s.weak_type);
                return (
                  <div key={s.id} className="overflow-hidden rounded-xl border bg-background">
                    <div
                      className={cn("flex items-center gap-2 px-3 py-2", TYPE_COLORS[s.weak_type])}
                    >
                      <Badge variant="outline" className="gap-1 bg-background/70">
                        <TypeIcon type={s.weak_type} className="h-4 w-4" />
                        {TYPE_LABELS[s.weak_type]}
                      </Badge>
                      {lead ? (
                        <span className="truncate text-sm font-medium">
                          {lead.leader}＆{lead.pokemon}
                        </span>
                      ) : null}
                    </div>
                    <div className="divide-y">
                      {stageRows.map((row) => (
                        <div key={row.id}>{renderSlot(row, s.id)}</div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* 全場欄位 (例如降抗支援手) —— 放在關卡與敘述之間 (2026-10-02 使用者指定) */}
          {/* 全場欄位的名稱與新增 —— 在全場區塊上方 (2026-10-02 使用者指定) */}
          {fieldBar(wideRows, true)}
          {wideRows.map((row) => (
            <div key={row.id} className="overflow-hidden rounded-xl border bg-background">
              {renderSlot(row, WIDE)}
            </div>
          ))}

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">敘述</div>
            {canEdit ? (
              <textarea
                value={plan.note}
                maxLength={2000}
                rows={4}
                placeholder="例：降抗順序、注意事項"
                ref={noteRef}
                onChange={(e) => setNote(e.target.value)}
                onBlur={(e) => void saveNote(e.target.value)}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              />
            ) : plan.note ? (
              <p className="whitespace-pre-wrap rounded-xl border bg-background px-3 py-2 text-sm">
                {plan.note}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">尚無敘述</p>
            )}
          </div>
        </div>
      ) : null}

      <SidePanel
        open={!!editRow}
        onClose={() => setEditing(null)}
        className="sm:max-w-lg"
        title={
          editRow
            ? `${editStage ? TYPE_LABELS[editStage.weak_type] : "全場"} · ${editRow.label || "未命名欄位"}`
            : ""
        }
      >
        <div>
          <label className="mb-1 block text-sm font-semibold" htmlFor="plan-cell-text">
            備註
          </label>
          <textarea
            id="plan-cell-text"
            value={editCell.text}
            maxLength={60}
            rows={3}
            placeholder="例：備用"
            onChange={(e) => setCellText(editing!.rowId, editing!.cellKey, e.target.value)}
            onBlur={(e) => void saveCellText(editing!.rowId, editing!.cellKey, e.target.value)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <div className="mt-6 flex items-center gap-2 border-t pt-4">
            <span className="flex-1 text-sm font-semibold">成員</span>
            {editStage ? (
              <span className="inline-flex rounded-md border p-0.5 text-xs">
                {(
                  [
                    ["gym", "道館拍組"],
                    ["all", `所有${TYPE_LABELS[editStage.weak_type]}屬性拍組`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={pairScope === k}
                    onClick={() => setPairScope(k)}
                    className={cn(
                      "rounded px-2 py-1 pointer-coarse:min-h-11",
                      pairScope === k ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          <div className="mb-1" />
          <ul className="divide-y">
            {/* 已選的人排最上面 (2026-10-02 使用者指定), 其餘照練度加總 */}
            {[...candidates]
              .sort(
                (a, b) =>
                  Number(editCell.members.includes(b.m.id)) -
                  Number(editCell.members.includes(a.m.id)),
              )
              .map(({ m, held }) => {
                const on = editCell.members.includes(m.id);
                const n = stageCount.get(m.id) ?? 0;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => void toggleMember(editing!.rowId, editing!.cellKey, m.id)}
                      className={cn(
                        "w-full px-1 py-2 text-left",
                        on ? "bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <span className="flex min-h-9 items-center gap-2">
                        <MemberAvatar member={m} size="sm" />
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {memberLabel(m)}
                          {n > 0 && !on ? (
                            <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-300">
                              已排 {n} 格
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "h-4 w-4 shrink-0 rounded border",
                            on && "border-primary bg-primary",
                          )}
                        />
                      </span>
                      {held.length ? (
                        <span className="mt-1.5 flex flex-wrap gap-1.5 pl-10">
                          {held.map(({ p, grade }) => (
                            <span
                              key={p.pairId}
                              title={`${pairName(p)} ${GRADE_LABELS[grade]}`}
                              className="flex w-14 flex-col items-center"
                            >
                              <SyncPairCard
                                pair={p}
                                size="sm"
                                showName={false}
                                minimal
                                potential={Math.min(5, grade)}
                                superAwakening={grade > 5 ? grade - 5 : 0}
                                awakenable={p.hasAwakening}
                                className="[&>svg]:h-14 [&>svg]:w-14"
                              />
                              <span className="text-[10px] leading-tight text-muted-foreground max-sm:text-xs">
                                {GRADE_LABELS[grade]}
                              </span>
                            </span>
                          ))}
                        </span>
                      ) : editStage ? (
                        <span className="mt-1 block pl-10 text-xs text-muted-foreground">
                          {pairScope === "gym" ? "無此屬性的道館拍組" : "無此屬性的拍組"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      </SidePanel>
    </section>
  );
}
