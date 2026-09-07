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
import { LEVEL_OPTIONS, normalizeLevel } from "@/lib/collection-entry";
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
  gymView = false,
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
   * **道館視角** (看某位成員的這張卡), 與 `/pairs` 的「我的拍組」兩個差別:
   *
   *   - **星數不顯示**: `member_pairs` 沒有 promotion 欄位, 而 `user_collection` 的 RLS
   *     是只能讀自己的 —— 別人的星數全站讀不到。畫出來只會是 `defaultEntry` 的預設值,
   *     那是對使用者說謊。(道館頁的卡牆同樣一律用原始星級, 兩邊一致。)
   *   - **等級唯讀**: 0057 之後 `member_pairs` 有 level 了, 所以看得到 (使用者:「道館看得到,
   *     只是要點進去才看得到, 這樣就可以了」); 但**改不動** —— 代改走的
   *     `set_member_pair` 不收 level, 畫成可點的下拉就是「改了不會存」。
   */
  gymView?: boolean;
  /** false = 唯讀 (例如一般成員看別人的練度) —— 版面一樣, 只是動不了 */
  editable?: boolean;
}) {
  // 寫入一律帶上 normalize 過的等級 —— 不在選項裡的舊值 (畫面上已經顯示成 Lv1) 一併收乾淨,
  // 不然改寶數會把那個看不見的舊值原樣寫回去
  const set = (patch: Partial<CollectionEntry>) =>
    onChange({ ...entry, level: normalizeLevel(entry.level), ...patch });

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

      {/* 道館視角沒有星數那一格, 剩下的兩格照樣排成兩欄 */}
      <div className="grid grid-cols-2 gap-3">
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

        {/* 星數: 原始星級 → 6★EX。道館視角整格不渲染 (別人的星數全站讀不到, 見 gymView) */}
        {gymView ? null : (
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
        )}

        <div className="space-y-1">
          <Label className="text-xs">等級</Label>
          <Select
            // 一律先 normalize —— 不在 LEVEL_OPTIONS 裡的值 (舊資料) 當成 Lv1,
            // 否則 Radix 找不到對應的 SelectItem, trigger 會渲染成一片空白
            value={String(normalizeLevel(entry.level))}
            // 道館視角唯讀: 代改走的 set_member_pair 不收 level, 可點的下拉 = 改了不會存
            disabled={!editable || gymView}
            onValueChange={(v) => set({ level: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 1 ? "Lv 1（未設定）" : `Lv ${n}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          : gymView
            ? "改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」。等級由本人在「拍組」頁自己設定。"
            : "改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」"}
      </p>
    </div>
  );
}
