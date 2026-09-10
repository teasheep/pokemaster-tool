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
import {
  LEVEL_OPTIONS,
  SYNC_GRID_CAPS,
  clampSyncGrid,
  maxSyncGrid,
  normalizeLevel,
} from "@/lib/collection-entry";
import { ROLE_LABELS, roleAssetToRole } from "@/data/sync-pairs";
import { isNewPair, isUpcomingPair, seriesLabel } from "@/lib/pairs/name";
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
  editable = true,
}: {
  pair: ClientPairRecord;
  entry: CollectionEntry;
  onChange: (next: CollectionEntry) => void;
  /** 左下角快速循環 (與卡片牆一致的互動) */
  onCountClick?: () => void;
  /** 道館拍組狀態與切換 (管理員才可切) */
  gymPair?: { isGymPair: boolean; canEdit: boolean; onToggle: () => void };
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
  /**
   * 未持有 (寶0) 時**只有寶數那一格能動** (2026-09-10 使用者:「未持有是不是就不該讓他
   * 設定星數那些, 不然存著也怪怪的」)。沒有這隻拍組卻記著「6★EX Lv200 滿盤」是
   * 遊戲裡不存在的狀態, 而且畫面照樣渲染得出來, 沒有人會發現。
   *
   * ⚠ **只是不給編, 不清掉已經存的值**: 那些值刻意留著, 之後抽到同一張卡再點回寶1,
   * 星數與等級就回來了。清掉的話就是 2026-09-08 那個前科的翻版
   * (「未持有再改回寶3, 真正的 Lv200 / 6★EX 被預設值洗掉, 資料真的沒了」)。
   */
  const ownsIt = entry.potential > 0 || entry.superAwakening > 0;
  const canEditRest = editable && ownsIt;

  // 超覺醒時寶數視為 5 (與 RPC 的 v_pot 同一條規則)
  const potForCap = entry.superAwakening > 0 ? 5 : entry.potential;
  const gridMax = maxSyncGrid(potForCap);

  // 一鍵升滿用的上限 (與各自的下拉共用同一組來源, 不要再算第二遍)
  const topStar = starOptions[starOptions.length - 1] ?? baseStar;
  const topLevel = LEVEL_OPTIONS[LEVEL_OPTIONS.length - 1];
  // 一鍵升滿之後寶數會是滿的, 所以拍檔石盤的上限一律用「滿寶」算 (= 索引 5)
  const topGrid = maxSyncGrid(5);
  // 解鎖後會變成哪一系 —— exRole 是 ROLE_* 資產名, 繁中名走與篩選同一組對照表
  const exRoleKey = roleAssetToRole(pair.exRole);
  const exRoleLabel = exRoleKey ? ROLE_LABELS[exRoleKey] : null;
  const maxed =
    gradeValue >= maxGrade &&
    Math.max(baseStar, Math.min(6, entry.promotion)) >= topStar &&
    normalizeLevel(entry.level) >= topLevel &&
    entry.syncGrid >= topGrid &&
    (!pair.hasExRole || entry.exRoleUnlocked);
  const maxSummary = [
    gradeLabel(maxGrade),
    topStar === 6 ? "6★EX" : `${topStar}★`,
    `Lv${topLevel}`,
    `石盤${SYNC_GRID_CAPS[topGrid]}`,
    ...(pair.hasExRole ? ["EX體系"] : []),
  ].join(" ・ ");

  return (
    <div className="space-y-4">
      {/* 道館拍組的 ★ 開關**擺在卡片上面** (2026-09-10 使用者:「不應該放在側板練度最下面,
          很容易不理解」)。它講的是「這張卡是不是全館的重點」, 與下面那一整片「這個人練到哪」
          不是同一件事 —— 夾在練度欄位的最後一格會被讀成「練度的一部分」。
          文案是 AGENTS 定死的「設為道館拍組 / 已設為道館拍組 (點擊取消)」, 與「全館拍組」
          那個側板逐字相同 —— 同一件事不要有兩種說法。 */}
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
          exRoleUnlocked={entry.exRoleUnlocked}
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
        {/* 用詞一律「初上線」(2026-09-09 使用者指定): 這個日期的語意是**拍組第一次在遊戲裡登場**,
            復刻與二次開放不算。舊文案「上架」會讓人以為是最近一次可以抽到的時間。 */}
        {pair.releaseDate ? (
          <span>
            初上線 {pair.releaseDate}
            {isUpcomingPair(pair) ? (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                尚未上線
              </span>
            ) : isNewPair(pair) ? (
              <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                NEW
              </span>
            ) : null}
          </span>
        ) : (
          <span>初上線日期未知</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 寶數 + 超覺醒 = 同一個下拉 */}
        <div className="space-y-1">
          <Label className="text-xs">寶數 / 超覺醒</Label>
          <Select
            value={String(gradeValue)}
            disabled={!editable}
            onValueChange={(v) => {
              const next = decodeGrade(Number(v));
              // 拍檔石盤的上限跟著寶數走 —— 寶數往下調時要把它夾回來, 否則會留下
              // 遊戲裡不可能的組合 (寶1 卻滿盤)。RPC 端也會夾, 這裡是為了畫面立刻一致。
              const potForCap = next.superAwakening > 0 ? 5 : next.potential;
              set({ ...next, syncGrid: clampSyncGrid(entry.syncGrid, potForCap) });
            }}
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

        {/* 星數: 原始星級 → 6★EX。
            2026-09-07 曾經只顯示在內頁 (「不影響拍組的圖鑑畫面」), 理由是當時自己合成的
            6★EX 卡常常跑掉或歪掉。**2026-09-10 那條限制拿掉了** —— 卡面換成官方成品卡之後
            星星是官方畫好的, 不會歪。現在「一面牆代表一個人」的卡牆 (/pairs 我的拍組、
            分享頁、道館的成員明細) 都照實畫個人星數; 混多人的牆 (全館拍組) 才不畫,
            而那邊本來也沒有「誰」可以拿。 */}
        <div className="space-y-1">
          <Label className="text-xs">星數</Label>
          <Select
            value={String(Math.max(baseStar, Math.min(6, entry.promotion)))}
            disabled={!canEditRest}
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
            // 一律先 normalize —— 不在 LEVEL_OPTIONS 裡的值 (舊資料) 當成 Lv1,
            // 否則 Radix 找不到對應的 SelectItem, trigger 會渲染成一片空白
            value={String(normalizeLevel(entry.level))}
            disabled={!canEditRest}
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

        {/* 拍檔石盤 (0063)。選項數量**跟著寶數變** —— 上限 = 索引 = 寶數 是遊戲規則,
            所以寶1 的卡只會有 60 / 62 / 64 三個選項, 而不是列出六格讓人選了才發現存不進去。
            索引 0 (= 60) 是每張卡的起點, 所以標「未升級」。 */}
        <div className="space-y-1">
          <Label className="text-xs">拍檔石盤</Label>
          <Select
            value={String(clampSyncGrid(entry.syncGrid, potForCap))}
            disabled={!canEditRest}
            onValueChange={(v) => set({ syncGrid: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYNC_GRID_CAPS.slice(0, gridMax + 1).map((cap, i) => (
                <SelectItem key={i} value={String(i)}>
                  {i === 0 ? `${cap}（未升級）` : String(cap)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* EX 體系 (0065) —— 只有這隻拍組真的能解鎖時才顯示 (catalog 的 hasExRole)。
            對不能解鎖的拍組畫一個永遠關著的開關, 只會讓人到處找解鎖方法。
            ⚠ 這與 6★EX (`exUnlocked`, 星數 6) 是**兩件事**, 不要合併成一個開關。
            2026-09-10 使用者指定「不要那麼多廢話, EX 體系(什麼系) 然後一個開關, 佔 1/2 就好」:
            所以它就是這片兩欄格線裡的一格, 標題直接寫出解鎖後會變成哪一系,
            內容只有官方體系圖示 + 已解鎖/未解鎖 —— 不要再加「用體系蛋糕捲解鎖」那種說明。 */}
        {pair.hasExRole ? (
          <div className="space-y-1">
            <Label className="text-xs">
              EX 體系{exRoleLabel ? `（${exRoleLabel}）` : ""}
            </Label>
            <button
              type="button"
              disabled={!canEditRest}
              aria-pressed={entry.exRoleUnlocked}
              onClick={() => set({ exRoleUnlocked: !entry.exRoleUnlocked })}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm transition-all",
                "active:scale-[0.99] pointer-coarse:min-h-11 motion-reduce:transition-none",
                !canEditRest && "cursor-default opacity-60",
                entry.exRoleUnlocked
                  ? "border-sky-500/60 bg-sky-500/15 hover:bg-sky-500/25"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {pair.exRole ? (
                // eslint-disable-next-line @next/next/no-img-element -- 站內小圖一律原生 img
                <img
                  src={`/reference/ui/${pair.exRole}.webp`}
                  alt=""
                  className={cn("h-4 w-auto shrink-0", !entry.exRoleUnlocked && "grayscale opacity-50")}
                />
              ) : null}
              <span>{entry.exRoleUnlocked ? "已解鎖" : "未解鎖"}</span>
            </button>
          </div>
        ) : null}
      </div>

      {editable && !ownsIt ? (
        <p className="text-xs text-muted-foreground">
          未持有時只能改寶數。星數、等級、拍檔石盤、EX 體系都留著, 之後抽到再點回寶1 就會回來。
        </p>
      ) : null}

      {/* 一鍵升滿 (2026-09-10 使用者指定)。「所有目前有的選項都升滿」= 這張卡在遊戲裡
          真的存在的上限, 不是寫死的數字:
            寶數/超覺醒 → 可超覺醒的到覺5 (10), 否則寶5
            星數       → 可 6★EX 的到 6, 否則原始星級到 5
            等級       → LEVEL_OPTIONS 的最後一格
          三條軸的上限都從同一組來源算 (maxGrade / starOptions / LEVEL_OPTIONS), 沒有第二份定義。
          `exUnlocked` 跟著星數走 —— 與星數下拉逐字相同, 不要讓兩者各自為政。
          已經滿了就 disabled, 免得按下去什麼都沒發生還以為壞了。 */}
      {editable ? (
        <button
          type="button"
          onClick={() => {
            set({
              ...decodeGrade(maxGrade),
              promotion: topStar,
              exUnlocked: topStar >= 6,
              level: topLevel,
              syncGrid: topGrid,
              // 不能解鎖 EX 體系的拍組不要硬塞 true (資料會與 catalog 打架)
              ...(pair.hasExRole ? { exRoleUnlocked: true } : {}),
            });
          }}
          disabled={maxed}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-sm transition-all",
            "active:scale-[0.99] pointer-coarse:min-h-11 motion-reduce:transition-none",
            maxed
              ? "cursor-default opacity-50"
              : "border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20"
          )}
        >
          <span className="flex items-center gap-2">
            <span className="text-base">⏫</span>
            <span className="font-medium">{maxed ? "已經全滿" : "一鍵升滿"}</span>
          </span>
          {/* 會升到什麼**放第二行** (2026-09-10 使用者指定) —— 擠在同一行右邊時,
              六個欄位串起來會把按鈕撐得很長, 而且與左邊的標題黏成一坨讀不出斷句。 */}
          <span className="text-left text-xs leading-tight text-muted-foreground">
            {maxed ? "沒有可以再升的欄位" : maxSummary}
          </span>
        </button>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {editable
          ? "改動會即時儲存 — 點其他拍組卡可直接切換 ・ 不持有請選「未持有」"
          : "唯讀 — 只有本人與管理員能改這位成員的練度。"}
      </p>
    </div>
  );
}
