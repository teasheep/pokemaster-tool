"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 「升星」手勢 —— 桌機右鍵、手機長按, 一支 hook 兩條路並行。
 *
 * 這是照 pomasters/SyncPairsTracker 的互動抄過來的 (2026-09-09 使用者指定「盡量貼近」),
 * 但**只新增這一個手勢, 不動既有的兩個**: 點卡片還是開編輯側板、點左下角還是寶數循環
 * (AGENTS「卡片互動標準」, 首頁 hero 在演它、教學也在框它)。
 * 對方是「左鍵 = 加寶數」, 那條與我方衝突, 沒有抄。
 *
 * ## 為什麼不做 UA 嗅探
 *
 * `contextmenu` 與自己的計時器**兩條路同時掛著**, 誰先到就誰算, 用一個旗標去重:
 *  - 桌機滑鼠右鍵 → 只有 contextmenu 會來。
 *  - Android Chrome 長按 → 先 contextmenu, 計時器被去重擋掉。
 *  - iOS Safari 長按 → contextmenu 行為與版本有關, 計時器保底。
 * 這樣任何平台都對, 也不會因為哪天 UA 字串變了就壞掉 —— 這台開發機驗不到 iOS,
 * 而「只在某個瀏覽器上壞掉」正是最難發現的那種壞法。
 *
 * ## 三個要壓掉的系統行為
 *
 *  1. **右鍵選單 / 長按選單**: `contextmenu` 一律 `preventDefault()`。
 *  2. **長按文字選取與 iOS 的「拷貝連結」浮層**: 靠回傳的 `className`
 *     (`select-none` + `[-webkit-touch-callout:none]`)。對方的 CSS 也是這樣寫的。
 *  3. **跟捲動搶**: 手指移動超過 `MOVE_TOLERANCE` 就取消計時器 —— 使用者是想捲動不是想升星。
 *     刻意**不設** `touch-action: none`, 那會讓卡片區域整個捲不動。
 *
 * ## 長按之後那一下 click 要吃掉
 *
 * 長按放開時瀏覽器還是會補一個 click, 不擋的話會連帶開啟編輯側板 ——
 * 使用者按一次卻發生兩件事。所以 fire 之後在捕獲階段吃掉下一個 click。
 */

/** 長按判定門檻 (ms) —— 與對方 long-press-event 的預設值同一個量級 */
const LONG_PRESS_MS = 500;
/** 手指移動超過幾 px 就當成在捲動, 取消長按 */
const MOVE_TOLERANCE = 10;

export type PromoteGestureBind = {
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: React.MouseEvent) => void;
  className: string;
};

/**
 * @param onPromote 沒給就整組退化成 no-op (唯讀卡 / 顧問視角), 不掛任何事件。
 */
export function usePromoteGesture(onPromote?: () => void): PromoteGestureBind | undefined {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // 這一輪手勢已經 fire 過了 (contextmenu 與計時器去重)
  const firedRef = useRef(false);
  // 長按之後要吃掉的那一下 click
  const swallowClickRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }, []);

  // 元件卸載時一定要清掉計時器 —— 不清的話卡片已經不在畫面上了還會 fire 一次
  useEffect(() => clear, [clear]);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    swallowClickRef.current = true;
    clear();
    onPromote?.();
  }, [clear, onPromote]);

  if (!onPromote) return undefined;

  return {
    onContextMenu: (e) => {
      // 右鍵選單一律不要跳出來 (桌機的右鍵, 以及 Android 長按都會走這裡)
      e.preventDefault();
      fire();
    },
    onPointerDown: (e) => {
      firedRef.current = false;
      // 滑鼠右鍵交給 contextmenu 處理; 這裡只管觸控與筆
      if (e.pointerType === "mouse") return;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = startRef.current;
      if (!s) return;
      if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE) {
        clear(); // 在捲動, 不是在長按
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture: (e) => {
      if (!swallowClickRef.current) return;
      swallowClickRef.current = false;
      // 捕獲階段就攔下來, 卡片自己的 onClick (開側板) 收不到
      e.preventDefault();
      e.stopPropagation();
    },
    // 長按時不要選字、不要跳 iOS 的「拷貝連結」浮層。
    // 刻意不加 touch-action:none —— 那會讓卡片區域整個捲不動。
    className: "select-none [-webkit-touch-callout:none]",
  };
}
