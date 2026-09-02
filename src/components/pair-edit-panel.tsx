"use client";

// 拍組練度編輯面板 — 我的拍組/圖鑑共用。
// 即改即存: 每個欄位變更立刻回呼 onChange (上層負責樂觀更新 + upsert),
// 沒有儲存/取消按鈕 (非模態側板 + 點其他卡切換的工作流不適合暫存草稿)。
//
// 這裡只放遊戲裡真的存在的欄位: 寶數/超覺醒 (同一條軸)、星數 (原始星級→6★EX)、等級。
// 「招式 1-5」「同步 1-5」是早期亂加的, 遊戲裡沒有這種東西, 已移除。

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SyncPairCard } from "@/components/sync-pair-card";
import { isNewPair, seriesLabel } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { CollectionEntry } from "@/lib/collection";
import { cn } from "@/lib/utils";

/**
 * 寶數與超覺醒是同一條成長軸 (寶5 之後才會有超覺醒 1-5), 所以只用一個下拉:
 *   未持有 / 寶1..寶5 / 超覺醒1..超覺醒5
 * value 編碼: 0=未持有, 1-5=寶數, 6-10=超覺醒 (值-5)
 */
function encodeGrade(potential: number, superAwakening: number): number {
  if (superAwakening > 0) return 5 + superAwakening;
  return Math.max(0, Math.min(5, potential));
}

function decodeGrade(v: number): { potential: number; superAwakening: number } {
  if (v > 5) return { potential: 5, superAwakening: v - 5 };
  return { potential: v, superAwakening: 0 };
}

function gradeLabel(v: number): string {
  if (v === 0) return "未持有";
  if (v <= 5) return `寶 ${v}`;
  return `超覺醒 ${v - 5}`;
}

export function PairEditPanel({
  pair,
  entry,
  onChange,
  onCountClick,
  gymPair,
}: {
  pair: ClientPairRecord;
  entry: CollectionEntry;
  onChange: (next: CollectionEntry) => void;
  /** 左下角快速循環 (與卡片牆一致的互動) */
  onCountClick?: () => void;
  /** 道館拍組狀態與切換 (管理員才可切) */
  gymPair?: { isGymPair: boolean; canEdit: boolean; onToggle: () => void };
}) {
  const set = (patch: Partial<CollectionEntry>) => onChange({ ...entry, ...patch });

  // 星數只能從「原始星級」升到 6★EX — 5★ 拍組不會有 3★/4★ 這種選項
  const baseStar = Math.max(1, Math.min(5, pair.basePotential ?? 5));
  const starOptions: number[] = [];
  for (let s = baseStar; s <= (pair.hasSixEx ? 6 : 5); s++) starOptions.push(s);

  const gradeValue = encodeGrade(entry.potential, entry.superAwakening);
  const maxGrade = pair.hasAwakening ? 10 : 5;

  return (
    <div className="space-y-4">
      {/* 卡片預覽 — 左下角一樣可點 */}
      <div className="flex justify-center">
        <SyncPairCard
          pair={pair}
          size="lg"
          showName={false}
          minimal
          eager /* 側板一開就在畫面正中央, 沒有延遲的餘地 */
          promotion={entry.promotion}
          potential={entry.potential}
          superAwakening={entry.superAwakening}
          awakenable={pair.hasAwakening}
          onCountClick={onCountClick}
        />
      </div>

      {/* 圖鑑資料 (唯讀) */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
          {seriesLabel(pair.series)}
        </span>
        <span>原始 {baseStar}★</span>
        {pair.hasAwakening ? <span>可超覺醒</span> : null}
        {pair.releaseDate ? (
          <span>
            上架 {pair.releaseDate}
            {isNewPair(pair) ? (
              <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                NEW
              </span>
            ) : null}
          </span>
        ) : (
          <span>上架日期未知</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 寶數 + 超覺醒 = 同一個下拉 */}
        <div className="space-y-1">
          <Label className="text-xs">寶數 / 超覺醒</Label>
          <Select
            value={String(gradeValue)}
            onValueChange={(v) => set(decodeGrade(Number(v)))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: maxGrade + 1 }, (_, i) => i).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {gradeLabel(n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 星數: 原始星級 → 6★EX */}
        <div className="space-y-1">
          <Label className="text-xs">星數</Label>
          <Select
            value={String(Math.max(baseStar, Math.min(6, entry.promotion)))}
            onValueChange={(v) => {
              const n = Number(v);
              // 6★EX 就是星數 6 — 不再另外用一個 checkbox 表示同一件事。
              // exStyleWorn 不動 (換裝立繪 UI 先拔掉, 但已存的資料不要被順手清掉)
              set({ promotion: n, exUnlocked: n >= 6 });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {starOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 6 ? "6★ EX" : `${n}★`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">等級</Label>
          <Select
            value={String(entry.level)}
            onValueChange={(v) => set({ level: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[100, 110, 120, 125, 130, 140, 150, 175, 200].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Lv {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 道館拍組 — 一顆按鈕就好 */}
      {gymPair?.canEdit ? (
        <button
          onClick={gymPair.onToggle}
          className={cn(
            "w-full rounded-md border px-3 py-2 text-sm transition-all active:scale-[0.99]",
            gymPair.isGymPair
              ? "border-amber-500/60 bg-amber-500/15"
              : "hover:bg-accent"
          )}
        >
          {gymPair.isGymPair ? "★ 取消道館拍組" : "☆ 設為道館拍組"}
        </button>
      ) : gymPair?.isGymPair ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">★ 道館拍組</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」
      </p>
    </div>
  );
}
