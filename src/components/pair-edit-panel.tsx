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
import { levelOptions } from "@/lib/collection-entry";
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
  gradeOnly = false,
  editable = true,
}: {
  pair: ClientPairRecord;
  entry: CollectionEntry;
  onChange: (next: CollectionEntry) => void;
  /** 左下角快速循環 (與卡片牆一致的互動) */
  onCountClick?: () => void;
  /** 道館拍組狀態與切換 (管理員才可切) */
  gymPair?: { isGymPair: boolean; canEdit: boolean; onToggle: () => void };
  /**
   * 只顯示「寶數 / 超覺醒」那一條軸, 收起星數與等級。
   *
   * 給**道館代改別人的拍組**用: 那條路徑的資料在 `member_pairs`, 而那張表只有
   * grade 與 super_awakening —— 星數與等級是個人收藏 (`user_collection`) 的欄位,
   * 別人的讀不到。硬畫兩個下拉出來只會顯示預設值, 那是對使用者說謊
   * (他會以為那是這個人真的的星數, 改了還會以為存進去了)。
   */
  gradeOnly?: boolean;
  /** false = 唯讀 (例如一般成員看別人的練度) —— 版面一樣, 只是動不了 */
  editable?: boolean;
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
          onCountClick={editable ? onCountClick : undefined}
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

      {/* gradeOnly 時只剩一個下拉 —— 讓它自己佔滿一列, 不要留半格空白 */}
      <div className={cn("grid gap-3", gradeOnly ? "grid-cols-1" : "grid-cols-2")}>
        {/* 寶數 + 超覺醒 = 同一個下拉 */}
        <div className="space-y-1">
          <Label className="text-xs">寶數 / 超覺醒</Label>
          <Select
            value={String(gradeValue)}
            disabled={!editable}
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

        {/* 星數與等級是**個人收藏**的欄位 —— 道館代改那條路徑 (member_pairs) 沒有它們,
            所以整格不渲染。畫出來就是拿 defaultEntry 的預設值冒充別人的練度。 */}
        {gradeOnly ? null : (
          <>
            {/* 星數: 原始星級 → 6★EX */}
            <div className="space-y-1">
              <Label className="text-xs">星數</Label>
              <Select
                value={String(Math.max(baseStar, Math.min(6, entry.promotion)))}
                disabled={!editable}
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
                disabled={!editable}
                onValueChange={(v) => set({ level: Number(v) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* 標準選項只有 140/150/180/200; 現值不在裡面時 levelOptions 會把它補進來,
                      不然那一列的下拉會是空白的 (線上真的有 Lv1 / Lv100 / Lv130 的資料) */}
                  {levelOptions(entry.level).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Lv {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      {/* 道館拍組 — 一顆 ★ 開關。文案是 AGENTS 定死的「設為道館拍組 / 已設為道館拍組
          (點擊取消)」, 與「全館拍組」那個側板逐字相同 —— 同一件事不要有兩種說法。 */}
      {gymPair?.canEdit ? (
        <button
          onClick={gymPair.onToggle}
          data-tour="gym-pair-toggle"
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all active:scale-[0.99] pointer-coarse:min-h-11",
            gymPair.isGymPair
              ? "border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25"
              : "hover:bg-accent"
          )}
        >
          <span className="text-base text-amber-600 dark:text-amber-400">
            {gymPair.isGymPair ? "★" : "☆"}
          </span>
          <span className="font-medium">
            {gymPair.isGymPair ? "已設為道館拍組" : "設為道館拍組"}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {gymPair.isGymPair ? "點擊取消" : "全館持有統計與道館戰看板會納入"}
          </span>
        </button>
      ) : gymPair?.isGymPair ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="text-base text-amber-600 dark:text-amber-400">★</span>
          <span className="font-medium">道館拍組</span>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {!editable
          ? "唯讀 — 只有本人與管理員能改這位成員的練度。"
          : gradeOnly
            ? "改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」。星數與等級是個人資料，只有本人在「拍組」頁看得到。"
            : "改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」"}
      </p>
    </div>
  );
}
