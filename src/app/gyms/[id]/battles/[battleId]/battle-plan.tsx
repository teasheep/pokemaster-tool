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

import { Chip } from "@/components/pair-filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button, COARSE_HIT_AREA } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import {
  MemberAvatar,
  MemberChip,
  memberCallName,
  memberLabel,
  type MemberCardData,
} from "@/components/gym/member-card";
import { useCatalogWithFullFallback } from "@/components/gym/pair-picker";
import { TypeIcon } from "@/components/sync-pair-badges";
import {
  AV,
  AV_GAP,
  FONT,
  TYPE_HEX,
  downloadCanvas,
  drawAvatar,
  loadImages,
  roundRect,
  shade,
  tint,
  wrap,
  wrapLabel,
  type ExportMember,
} from "@/components/gym/export-image";
import { SyncPairCard } from "@/components/sync-pair-card";
import { TYPE_COLORS, TYPE_LABELS } from "@/data/sync-pairs";
import { matchTemplate } from "@/lib/gym/battle-templates";
import { formatTaipeiDateTime } from "@/lib/gym/pairs-updated";
import { GRADE_LABELS } from "@/lib/gym/types";
import { useCoalescedWrite } from "@/lib/pairs/use-coalesced-write";
import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { shortId } from "@/lib/url-params";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import {
  MAX_PLAN_DRAFTS,
  PLAN_DRAFT_COLS,
  PLAN_FIELD_COLS,
  PLAN_SLOT_COLS,
  PLAN_WIDE,
  normalizeDraftRow,
  type PlanCell,
  type PlanDoc,
  type PlanDraftRow,
  type PlanFieldRow,
  type PlanRow,
  type PlanSlotRow,
  type StageRequiredPairRow,
} from "./battle-plan-data";

type Cell = PlanCell;
type Plan = PlanDoc;

const WIDE = PLAN_WIDE;
const EMPTY_CELL: Cell = { members: [], text: "" };

/** 分頁裡改一格: 回傳新的一份 (原本那份不動, 畫面才看得到變化) */
function withCell(doc: Plan, rowId: string, cellKey: string, fn: (c: Cell) => Cell): Plan {
  return {
    ...doc,
    rows: doc.rows.map((r) => {
      if (r.id !== rowId) return r;
      const next = fn(r.cells[cellKey] ?? EMPTY_CELL);
      const cells = { ...r.cells };
      if (next.members.length || next.text) cells[cellKey] = next;
      else delete cells[cellKey];
      return { ...r, cells };
    }),
  };
}

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
// 排刀表最後是貼到賴群的 → 匯出成 PNG。畫法的零件 (頭像 / 字型 / 斷行 / 下載) 在 components/gym/export-image.ts,
// 與成員頁「比較」的匯出圖共用。

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
  requiredPairs,
  initialFields,
  initialSlots,
  initialNote,
  initialDrafts,
  initialDraftId,
  memberIdByUser,
  myUserId,
  isAdmin,
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
  /** 關卡的必要拍組 (0089, 看板上設定) —— 選人側板可以切過去看「每個人那幾隻幾寶」 */
  requiredPairs: StageRequiredPairRow[];
  initialFields: PlanFieldRow[];
  initialSlots: PlanSlotRow[];
  initialNote: string;
  /** 排刀表的分頁 (0087/0088, 全館的); 表還沒套上時是空陣列 */
  initialDrafts: PlanDraftRow[];
  /** 網址 ?draft= 指到的那一個 (server 已經從短碼解回完整 id) */
  initialDraftId: string | null;
  /** 分頁是誰加的: user_id → 成員 id (查不到 = 已經不在名冊上) */
  memberIdByUser: Record<string, string>;
  myUserId: string;
  /** 管理員刪得掉別人的分頁 (人離開之後要收得掉) —— 與 0088 的 delete policy 同一條 */
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [fields, setFields] = useState(initialFields);
  const [slots, setSlots] = useState(initialSlots);
  const [note, setNote] = useState(initialNote);
  const officialPlan = useMemo(() => toPlan(fields, slots, note), [fields, slots, note]);

  // ── 分頁 (0087 試排 → 0088 改成全館看得到。2026-11-07 使用者:「改成所有人都可以加排刀表 …
  //    排刀表可以有分頁1 分頁2...的長相 然後標註是誰 在什麼時候加的就好 也可以自己命名」) ──
  // 同一套卡片 / 側板 / 匯出, 只是資料來源換成那一個分頁 (battle_plan_drafts 一份一列),
  // 正式那三張表一個字都不碰 (仍然沒有「套用成正式」)。全館看得到; **只有建立的人改得動** ——
  // 整份存一格 jsonb, 兩個人一起改就是後存的蓋掉先存的。新分頁是空白的 (不複製, 2026-11-08 使用者指定)。
  // 顧問不能改正式那張, 也就不能加分頁 (RLS 同一條 is_gym_editor), 但看得到。
  const [drafts, setDrafts] = useState(initialDrafts);
  const [view, setView] = useState<string | null>(
    initialDraftId && initialDrafts.some((d) => d.id === initialDraftId) ? initialDraftId : null,
  );
  const active = useMemo(
    () => (view ? drafts.find((d) => d.id === view) : undefined),
    [view, drafts],
  );
  useUrlState({ draft: active ? shortId(active.id) : null });
  const plan = useMemo(() => (active ? active.plan : officialPlan), [active, officialPlan]);
  const mine = !!active && active.user_id === myUserId;
  /** 分頁只有建立的人改得動 (而且他還是正式成員); 正式那張照舊看身分 */
  const editable = active ? canEdit && active.user_id === myUserId : canEdit;
  const myDraftCount = drafts.filter((d) => d.user_id === myUserId).length;

  /**
   * 分頁的存檔: 一份只有建立的人在改, 所以整份覆蓋就好 (正式那張的「一人一列」是為了多人同時改)。
   * 連點 / 打字合併成一次 (450ms), 而且**同一份排隊送** —— 只合併不排隊的話,
   * 跨視窗的兩趟可能後到先至, 舊的那份會把新的蓋掉 (與背包糖果 2026-09-10 同一個坑)。
   */
  const draftQueue = useRef(new Map<string, Promise<void>>());
  const scheduleDraftSave = useCoalescedWrite<{ name?: string; plan?: Plan }>((id, payload) => {
    const prev = draftQueue.current.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const { error } = await supabase.from("battle_plan_drafts").update(payload).eq("id", id);
      if (error) toast.error("分頁儲存失敗", { description: error.message });
    });
    draftQueue.current.set(id, next);
    return next;
  });
  // 最新的分頁放一份在 ref: 同一個 render 裡連改兩次 (例如連點兩個人) 時, 第二次要接在第一次後面,
  // 從 render 當下的 active.plan 算的話第一次的改動會被吃掉。只在事件處理裡寫, 不在 render 裡寫。
  const draftsRef = useRef(initialDrafts);
  const putDraft = (id: string, patch: Partial<Pick<PlanDraftRow, "name" | "plan">>) => {
    draftsRef.current = draftsRef.current.map((d) => (d.id === id ? { ...d, ...patch } : d));
    setDrafts(draftsRef.current);
  };
  const updateDraft = (fn: (doc: Plan) => Plan) => {
    // 別人的分頁不給改 (畫面上本來就沒有可按的東西, 這裡再擋一次; RLS 也會擋)
    const cur = active && editable && draftsRef.current.find((d) => d.id === active.id);
    if (!cur) return;
    const nextPlan = fn(cur.plan);
    putDraft(cur.id, { plan: nextPlan });
    scheduleDraftSave(cur.id, { plan: nextPlan });
  };
  const renameDraft = (name: string) => {
    if (!active || !editable) return;
    putDraft(active.id, { name });
    scheduleDraftSave(active.id, { name: name.trim() });
  };
  /**
   * 「＋ 分頁」= 一張**空白的** (2026-11-08 使用者:「加新分頁的時候 不用複製前一張阿」):
   * 欄位沿用正在看的那張 (物攻 / 特攻 / 降抗 這些名字, 不然每開一張都要重加), 格子裡的人、備註、敘述全部是空的。
   */
  const blankPlan = (): Plan => ({
    rows: plan.rows.map((r) => ({ id: r.id, label: r.label, wide: r.wide, cells: {} })),
    note: "",
  });
  const [creating, setCreating] = useState(false);
  const createDraft = async () => {
    if (creating || !canEdit || myDraftCount >= MAX_PLAN_DRAFTS) return;
    setCreating(true);
    // 預設名稱「分頁 N」, 全館一起數 (別人的分頁也算), 撞名就往後跳
    const names = new Set(drafts.map((d) => d.name.trim()));
    let k = drafts.length + 1;
    while (names.has(`分頁 ${k}`)) k++;
    const { data, error } = await supabase
      .from("battle_plan_drafts")
      .insert({ gym_id: gymId, battle_id: battleId, name: `分頁 ${k}`, plan: blankPlan() })
      .select(PLAN_DRAFT_COLS)
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("新增分頁失敗", { description: error?.message ?? "" });
      return;
    }
    const row = normalizeDraftRow(data);
    draftsRef.current = [...draftsRef.current, row];
    setDrafts(draftsRef.current);
    setView(row.id);
  };
  /** 刪分頁要按兩下 (與刪欄位同一個手勢)。建立的人, 或管理員 (人離開之後他的分頁要有人收得掉) */
  const canDeleteDraft = !!active && ((mine && canEdit) || isAdmin);
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState(false);
  const deleteDraft = async () => {
    if (!active || !canDeleteDraft) return;
    if (!confirmDeleteDraft) {
      setConfirmDeleteDraft(true);
      return;
    }
    setConfirmDeleteDraft(false);
    const id = active.id;
    // 還在排隊的存檔先等它送完, 不然刪掉之後那一趟 update 會撲空 (0 列, 不報錯但白跑)
    await draftQueue.current.get(id);
    const { data: gone, error } = await supabase
      .from("battle_plan_drafts")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      toast.error("刪除分頁失敗", { description: error.message });
      return;
    }
    // RLS 擋下的刪除不會報錯, 只是 0 列 (例如管理員剛被降級) —— 不要讓畫面以為刪掉了
    if (!gone?.length) {
      toast.error("刪除分頁失敗", { description: "沒有權限刪除這個分頁" });
      return;
    }
    draftsRef.current = draftsRef.current.filter((d) => d.id !== id);
    setDrafts(draftsRef.current);
    setView(null);
  };

  /** 重抓 (別人改了 / 自己寫失敗要回滾) —— 回到分頁時抓一次, 5 秒節流, 與看板同一套新鮮度 */
  const refetch = async () => {
    const [f, sl, pl, dr] = await Promise.all([
      supabase.from("battle_plan_fields").select(PLAN_FIELD_COLS).eq("battle_id", battleId),
      supabase
        .from("battle_plan_slots")
        .select(PLAN_SLOT_COLS)
        .eq("battle_id", battleId)
        .order("created_at")
        .order("id"),
      supabase.from("battle_plans").select("note").eq("battle_id", battleId).maybeSingle(),
      // 別人新加 / 改名 / 刪掉的分頁 (與 page.tsx 同一支查詢)
      supabase
        .from("battle_plan_drafts")
        .select(PLAN_DRAFT_COLS)
        .eq("battle_id", battleId)
        .order("created_at")
        .order("id"),
    ]);
    if (f.data) setFields(f.data);
    if (sl.data) setSlots(sl.data);
    if (dr.data) {
      // 自己的分頁以畫面上這份為準: 只有自己在改, 存檔可能還在路上, 拿資料庫的會把剛打的字蓋回去。
      // 別人的照資料庫 (他改了名、改了內容); 資料庫裡沒有的 (被刪了) 就拿掉。
      const local = new Map(draftsRef.current.map((d) => [d.id, d]));
      draftsRef.current = dr.data.map((raw) => {
        const cur = local.get(raw.id);
        return cur && cur.user_id === myUserId ? cur : normalizeDraftRow(raw);
      });
      setDrafts(draftsRef.current);
    }
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

  // 每一支寫入都先看「現在是不是在分頁」: 是的話只改那一個分頁 (battle_plan_drafts, 而且只有建立的人改得動), 正式那三張表不碰。
  const toggleMember = async (fieldId: string, cellKey: string, memberId: string) => {
    if (active) {
      updateDraft((doc) =>
        withCell(doc, fieldId, cellKey, (c) => ({
          ...c,
          members: c.members.includes(memberId)
            ? c.members.filter((x) => x !== memberId)
            : [...c.members, memberId],
        })),
      );
      return;
    }
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
  const setCellText = (fieldId: string, cellKey: string, text: string) => {
    // 分頁只有建立的人在改, 打字當下就排進存檔 (合併成一次), 不必等離開輸入框
    if (active) return updateDraft((doc) => withCell(doc, fieldId, cellKey, (c) => ({ ...c, text })));
    setSlots((prev) => {
      const rest = prev.filter((s) => !(sameCell(s, fieldId, cellKey) && s.member_id === null));
      return text
        ? [...rest, { field_id: fieldId, stage_id: stageOf(cellKey), member_id: null, note: text }]
        : rest;
    });
  };
  const saveCellText = async (fieldId: string, cellKey: string, raw: string) => {
    const text = raw.trim();
    if (active) {
      if (text !== raw) updateDraft((doc) => withCell(doc, fieldId, cellKey, (c) => ({ ...c, text })));
      return;
    }
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

  const mapRows = (fn: (r: PlanRow) => PlanRow) =>
    updateDraft((doc) => ({ ...doc, rows: doc.rows.map(fn) }));
  const renameField = (id: string, label: string) => {
    if (active) return mapRows((r) => (r.id === id ? { ...r, label } : r));
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)));
  };
  const saveFieldLabel = async (id: string, label: string) => {
    if (active) {
      if (label.trim() !== label) mapRows((r) => (r.id === id ? { ...r, label: label.trim() } : r));
      return;
    }
    const { error } = await supabase
      .from("battle_plan_fields")
      .update({ label: label.trim() })
      .eq("id", id);
    if (error) failed("改欄位名稱", error.message);
  };
  /** 欄位裡有人時要按兩下才刪 (與名冊的叉叉同一個手勢) */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const deleteField = async (id: string) => {
    // plan = 正在看的那一份 (正式或分頁), 兩邊同一個判斷
    const used = Object.keys(plan.rows.find((r) => r.id === id)?.cells ?? {}).length > 0;
    if (used && confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    if (active) {
      updateDraft((doc) => ({ ...doc, rows: doc.rows.filter((r) => r.id !== id) }));
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== id));
    setSlots((prev) => prev.filter((s) => s.field_id !== id));
    const { error } = await supabase.from("battle_plan_fields").delete().eq("id", id);
    if (error) failed("刪除欄位", error.message);
  };
  const addField = async (wide: boolean) => {
    if (active) {
      const row: PlanRow = { id: crypto.randomUUID(), label: "", wide, cells: {} };
      updateDraft((doc) => ({ ...doc, rows: [...doc.rows, row] }));
      return;
    }
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
  const changeNote = (text: string) => {
    if (active) return updateDraft((doc) => ({ ...doc, note: text }));
    setNote(text);
  };
  const saveNote = async (raw: string) => {
    if (active) return; // 打字當下就排進存檔了
    const { error } = await supabase
      .from("battle_plans")
      .upsert({ battle_id: battleId, gym_id: gymId, note: raw }, { onConflict: "battle_id" });
    if (error) failed("儲存敘述", error.message);
  };

  const roster = useMemo(() => members.filter((m) => m.role !== "advisor"), [members]);
  const byId = useMemo(() => new Map(roster.map((m) => [m.id, m])), [roster]);
  const catById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  /** 分頁是誰加的 (名冊上查不到 = 已經離開 / 改成顧問) */
  const creatorOf = (d: PlanDraftRow) => byId.get(memberIdByUser[d.user_id] ?? "");
  const tabName = (d: PlanDraftRow) => d.name.trim() || "未命名分頁";
  /** 「泡茶綿羊 · 2026/11/07 22:22」—— 畫面與匯出圖同一句 */
  const tabByline = (d: PlanDraftRow) => {
    const m = creatorOf(d);
    return `${m ? memberLabel(m) : "（已離開）"} · ${formatTaipeiDateTime(d.created_at) ?? ""}`;
  };

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
  const switchView = (id: string | null) => {
    setView(id);
    setEditing(null);
    setConfirmDelete(null);
    setConfirmDeleteDraft(false);
  };
  const editRow = editing ? plan.rows.find((r) => r.id === editing.rowId) : undefined;
  const editStage = editing ? stages.find((s) => s.id === editing.cellKey) : undefined;
  const editCell = editRow?.cells[editing!.cellKey] ?? EMPTY_CELL;

  /**
   * 候選人: 這關屬性的拍組全部列出來, 練度高的排前面 (2026-10-02 使用者:「不用幫他們分物攻特攻,
   * 就是把那個屬性的道館拍組/全體該屬性拍組列出來就好」)。
   * 範圍兩種: 道館拍組 (預設) / 全部該屬性拍組 (要整本圖鑑, 切過去才載)。
   * 成員排序 = 列出來那幾隻的練度加總 (寶N=N、覺N=5+N)。
   */
  /**
   * 這一關的**必要拍組** (0089/0090) 跟道館拍組**合成一個分頁「必要/道館拍組」**
   * (2026-11-08 使用者:「側邊的必要拍組 跟道館拍組好像可以放在一起顯示」「必要/道館拍組 這樣呈現」
   * 「就是合成一個Tab 不用分兩個看」「計算排序的時候也按照這個排」)。
   * 每個人上下兩排: 「必要」= 這一關的必要拍組全部列出來 (照看板順序, 沒有的反灰, 不到要求的標黃),
   * 每個人同一格是同一組, 往下掃得過去; 「道館」= 這一關屬性的道館拍組裡他有的 (跟必要重複的不再列)。
   * 排序也是先必要再道館。不做左右: 必要拍組最多 10 組, 左右擺一定換行換得亂七八糟。
   * 「所有X屬性拍組」那個分頁照舊一排 (不放必要那一排 —— 分頁名寫的就只有屬性拍組);
   * 沒設必要拍組的關, 第一個分頁就叫「道館拍組」、也只有一排, 跟以前一樣。
   */
  const [pairScope, setPairScope] = useState<"gym" | "all">("gym");
  /** 這一關的必要拍組 (照看板上的順序) 與各自要求的寶數 (0090) */
  const keyReq = useMemo(
    () => (editStage ? requiredPairs.filter((r) => r.stage_id === editStage.id) : []),
    [requiredPairs, editStage],
  );
  const heldIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of Object.values(memberGrades)) for (const id of Object.keys(g)) ids.add(id);
    return ids;
  }, [memberGrades]);
  // 必要拍組可以是名單外的 (看板勾「全圖鑑」挑的) —— 子集裡查不到就抓整本 (與看板同一條規矩)
  const neededIds = useMemo(() => {
    const ids = new Set(requiredPairs.map((r) => r.pair_id));
    if (pairScope === "all") for (const id of heldIds) ids.add(id);
    return ids;
  }, [requiredPairs, pairScope, heldIds]);
  const fullCatalog = useCatalogWithFullFallback(catalog, { ids: neededIds, fullCatalogUrl });
  const fullById = useMemo(() => new Map(fullCatalog.map((p) => [p.pairId, p])), [fullCatalog]);
  const candidates = useMemo(() => {
    if (!editing) return [];
    const type = editStage?.weak_type;
    const keyPool = (pairScope === "gym" ? keyReq : [])
      .map((r) => {
        const p = fullById.get(r.pair_id);
        return p ? { p, need: r.min_grade } : null;
      })
      .filter((x): x is { p: ClientPairRecord; need: number } => !!x);
    const keyIds = new Set(keyPool.map((x) => x.p.pairId));
    const pool = (
      !type
        ? []
        : pairScope === "gym"
          ? gymPairsList
              .filter((g) => g.type === type)
              .map((g) => catById.get(g.pairId))
              .filter((p): p is ClientPairRecord => !!p)
          : fullCatalog.filter((p) => p.type === type)
    ).filter((p) => !keyIds.has(p.pairId));
    return roster
      .map((m) => {
        const g = memberGrades[m.id] ?? {};
        const key = keyPool.map(({ p, need }) => ({ p, grade: g[p.pairId] ?? 0, need }));
        // 屬性那一排一屬性幾十組: 只列有的、高的在前
        const rest = pool
          .map((p) => ({ p, grade: g[p.pairId] ?? 0, need: undefined as number | undefined }))
          .filter((x) => x.grade > 0)
          .sort((a, b) => b.grade - a.grade);
        const keyOwned = key.filter((x) => x.grade > 0);
        const hasAll = key.length > 0 && keyOwned.length === key.length;
        return {
          m,
          // 綠燈 (必要拍組都有、都達標) → 黃燈 (都有) → 有幾組 → 必要寶數加總 → 另一排寶數加總
          tier: !hasAll ? 0 : key.every((x) => x.grade >= x.need) ? 2 : 1,
          count: keyOwned.length,
          keyScore: keyOwned.reduce((sum, x) => sum + x.grade, 0),
          restScore: rest.reduce((sum, x) => sum + x.grade, 0),
          key,
          rest,
        };
      })
      .sort(
        (a, b) =>
          b.tier - a.tier ||
          b.count - a.count ||
          b.keyScore - a.keyScore ||
          b.restScore - a.restScore ||
          memberCallName(a.m).localeCompare(memberCallName(b.m)),
      );
  }, [editing, editStage, pairScope, keyReq, fullById, gymPairsList, fullCatalog, catById, roster, memberGrades]);

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
    const images = await loadImages(urls);
    const withLeader = stages.map((s) => {
      const l = leaders?.byType.get(s.weak_type);
      return { ...s, leader: l ? `${l.leader}＆${l.pokemon}` : undefined };
    });
    // 分頁的圖: 標題寫分頁名、副標寫是誰什麼時候加的 —— 貼到賴群時不會被當成正式那張
    const draftName = active ? tabName(active) : "";
    const cv = drawPlanImage(
      active ? `排刀表：${draftName}` : "排刀表",
      active ? `${battleName} · ${tabByline(active)}` : battleName,
      withLeader,
      plan,
      memberOf,
      images,
    );
    downloadCanvas(cv, active ? `${battleName}-排刀表-${draftName}.png` : `${battleName}-排刀表.png`);
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
          {editable ? (
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
    return editable ? (
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
    editable ? (
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
          {/* 收起來時也看得出來現在選的不是正式那張 */}
          {active ? (
            <Badge
              variant="outline"
              className="ml-1 min-w-0 max-w-40 truncate border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"
            >
              {tabName(active)}
            </Badge>
          ) : null}
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
          {/* 分頁: 正式 + 全館加的 (每個分頁寫著是誰加的)。顧問看得到但不能加 */}
          {canEdit || drafts.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={!active} onClick={() => switchView(null)}>
                正式
              </Chip>
              {drafts.map((d) => {
                const m = creatorOf(d);
                return (
                  <Chip
                    key={d.id}
                    active={active?.id === d.id}
                    onClick={() => switchView(d.id)}
                    activeClass="bg-amber-50 border-amber-400 dark:bg-amber-400/15"
                    title={tabByline(d)}
                  >
                    <span className="max-w-40 truncate">{tabName(d)}</span>
                    <span className="font-normal text-muted-foreground">
                      · {m ? memberCallName(m) : "已離開"}
                    </span>
                  </Chip>
                );
              })}
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  disabled={creating || myDraftCount >= MAX_PLAN_DRAFTS}
                  title={
                    myDraftCount >= MAX_PLAN_DRAFTS
                      ? `一個人最多 ${MAX_PLAN_DRAFTS} 個分頁`
                      : "新增一個空白分頁"
                  }
                  onClick={() => void createDraft()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  分頁
                </Button>
              ) : null}
            </div>
          ) : null}
          {active ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2 dark:border-amber-400/40 dark:bg-amber-400/10">
              {editable ? (
                <input
                  value={active.name}
                  maxLength={20}
                  placeholder="分頁名稱"
                  aria-label="分頁名稱"
                  style={{ width: `${Math.max(5, [...active.name].length) + 1}em` }}
                  onChange={(e) => renameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 min-w-0 rounded-full border bg-background px-3 text-sm font-medium outline-none"
                />
              ) : (
                <span className="px-1 text-sm font-medium">{tabName(active)}</span>
              )}
              {/* 是誰、什麼時候加的 */}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-amber-900 dark:text-amber-100">
                {(() => {
                  const m = creatorOf(active);
                  return m ? (
                    <MemberChip member={m} />
                  ) : (
                    <span className="text-muted-foreground">（已離開）</span>
                  );
                })()}
                <span className="tabular-nums">
                  {formatTaipeiDateTime(active.created_at)} 加的
                </span>
              </span>
              {canDeleteDraft ? (
                <Button
                  size="sm"
                  variant={confirmDeleteDraft ? "destructive" : "ghost"}
                  className="h-8"
                  onClick={() => void deleteDraft()}
                  onBlur={() => setConfirmDeleteDraft(false)}
                >
                  {confirmDeleteDraft ? "確定刪除" : "刪除分頁"}
                </Button>
              ) : null}
            </div>
          ) : null}

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
            {editable ? (
              <textarea
                value={plan.note}
                maxLength={2000}
                rows={4}
                placeholder="例：降抗順序、注意事項"
                ref={noteRef}
                onChange={(e) => changeNote(e.target.value)}
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
                    ["gym", keyReq.length > 0 ? "必要/道館拍組" : "道館拍組"],
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
              .map(({ m, key, rest }) => {
                const on = editCell.members.includes(m.id);
                const n = stageCount.get(m.id) ?? 0;
                // 有必要拍組 = 上下兩排, 排頭各一個小標; 沒有 = 一排, 不掛標 (跟以前一樣)
                const lines = [
                  ...(key.length > 0 ? [{ label: "必要", items: key }] : []),
                  ...(rest.length > 0 || key.length === 0 ? [{ label: "道館", items: rest }] : []),
                ];
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
                      {lines.map(({ label, items }) =>
                        items.length ? (
                          <span key={label} className="mt-1.5 flex items-center">
                            {/* 小標放在頭像底下那一欄 (pl-10 的寬度), 不另佔一行 */}
                            <span className="w-10 shrink-0 text-[10px] text-muted-foreground max-sm:text-xs">
                              {key.length > 0 ? label : null}
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {items.map(({ p, grade, need }) => (
                                <span
                                  key={p.pairId}
                                  title={`${pairName(p)} ${grade > 0 ? GRADE_LABELS[grade] : "未持有"}${
                                    need && grade > 0 && grade < need ? `／需${GRADE_LABELS[need]}` : ""
                                  }`}
                                  className="flex w-14 flex-col items-center"
                                >
                                  {/* 寶0 只會出現在必要那一排 (全部列出來): 整卡反灰, 與卡牆的未持有同一個長相 */}
                                  <SyncPairCard
                                    pair={p}
                                    size="sm"
                                    showName={false}
                                    minimal
                                    potential={Math.min(5, grade)}
                                    superAwakening={grade > 5 ? grade - 5 : 0}
                                    awakenable={p.hasAwakening}
                                    owned={grade > 0}
                                    className="[&>svg]:h-14 [&>svg]:w-14"
                                  />
                                  <span
                                    className={cn(
                                      "text-[10px] leading-tight text-muted-foreground max-sm:text-xs",
                                      // 有, 但不到必要拍組要求的寶數 = 黃 (看板上的黃燈同一個意思)
                                      need && grade > 0 && grade < need && "font-semibold text-amber-600 dark:text-amber-400",
                                    )}
                                  >
                                    {grade > 0 ? GRADE_LABELS[grade] : "未持有"}
                                  </span>
                                </span>
                              ))}
                            </span>
                          </span>
                        ) : editStage ? (
                          <span key={label} className="mt-1 block pl-10 text-xs text-muted-foreground">
                            {pairScope === "gym" ? "無此屬性的道館拍組" : "無此屬性的拍組"}
                          </span>
                        ) : null,
                      )}
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
