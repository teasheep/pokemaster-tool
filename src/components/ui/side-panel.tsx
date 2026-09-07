"use client";

// 非模態側板 (inspector) — 與 Sheet 的差別: 沒有遮罩、不鎖住頁面,
// 開著的時候仍可點頁面上其他元素 (例如點別張拍組卡切換側板內容)。
//
// 手機 = bottom sheet (全站新側板一律沿用這顆):
//   - z-50: 底部固定導覽列是 z-40, 側板升起來要蓋過它 (不然把手與標題會被那 56px 吃掉)。
//     桌機的右側欄本來就靠 DOM 順序壓在 z-40 的 header 上, 改成 z-50 外觀不變。
//   - 底部安全區: iPhone 的 home indicator 會壓住最後一列內容 → pb 帶 env(safe-area-inset-bottom)。
//   - 把手可下拉關閉 (拖過 96px 放手就關); 把手是 sm:hidden, 桌機根本點不到,
//     所以拖曳狀態在桌機永遠是 0 = 桌機不會多出任何 inline style。
import { useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** 下拉超過這個距離放手就關閉 */
const DISMISS_PX = 96;

type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function SidePanel({ open, ...rest }: SidePanelProps) {
  // 關閉時整個卸載內層 = 拖曳位移自然歸零, 下次開啟不會從半路升起
  // (用 useEffect 補歸零會踩到 react-hooks/set-state-in-effect)
  if (!open) return null;
  return <SidePanelBody {...rest} />;
}

function SidePanelBody({ onClose, title, children, className }: Omit<SidePanelProps, "open">) {
  // { startY, y } = 這次下拉的起點與目前位移; null = 沒在拖
  const [drag, setDrag] = useState<{ startY: number; y: number } | null>(null);
  const startedRef = useRef(false);

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    startedRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ startY: e.clientY, y: 0 });
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startedRef.current) return;
    setDrag((d) => (d ? { ...d, y: Math.max(0, e.clientY - d.startY) } : d));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startedRef.current) return;
    startedRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const dismissed = (drag?.y ?? 0) > DISMISS_PX;
    setDrag(null);
    if (dismissed) onClose();
  };

  return (
    <aside
      className={cn(
        // 桌機: 右側欄; 手機: 下半 bottom sheet — 上半卡片牆保持可見可點,
        // 「開著側板點其他卡切換」的流程在手機也成立
        "fixed z-50 flex flex-col gap-4 overflow-y-auto bg-popover text-sm text-popover-foreground shadow-2xl",
        "max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[58dvh] max-sm:rounded-t-2xl max-sm:border-t max-sm:p-4",
        // 底部安全區 (iPhone home indicator) — 最後一列按鈕才不會被吃掉
        "max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
        "sm:inset-y-0 sm:right-0 sm:w-full sm:max-w-sm sm:border-l sm:p-5",
        "max-sm:animate-in max-sm:slide-in-from-bottom sm:animate-in sm:slide-in-from-right duration-200 motion-reduce:animate-none",
        // 放手後彈回原位。拖曳中必須**明確**關掉 transition —— base 那個沒有 variant 的
        // duration-200 只設 transition-duration 不設 transition-property, 少了下面這條
        // transition-property 會退回初始值 all, 手指拖動時面板反而用 200ms 追在後面。
        drag ? "max-sm:transition-none" : "max-sm:transition-transform max-sm:duration-200",
        className
      )}
      style={drag && drag.y > 0 ? { transform: `translateY(${drag.y}px)` } : undefined}
      data-tour="side-panel"
    >
      {/* 手機 bottom sheet 的拖曳把手 — 整條 44px 高、跨滿面板寬度都可以拖,
          視覺上仍然只是那條小灰棒 (負 margin 抵掉高度, 位置與舊版幾乎一致) */}
      <div
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // -mb-7 而不是 -mb-9: 再多收 8px 就會與標題列 (h-11 的關閉鈕) 重疊,
        // 而標題列在 DOM 順序較後會贏得命中測試 → 把手實際只剩約 24px 拖得動。
        className="-mx-4 -mt-4 -mb-7 flex h-11 shrink-0 touch-none items-center justify-center sm:hidden"
        aria-hidden
      >
        <span className="h-1 w-10 rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2 pr-1">
        {title ? <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2> : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 sm:h-7 sm:w-7"
          onClick={onClose}
          aria-label="關閉"
        >
          <XIcon className="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
      </div>
      {children}
    </aside>
  );
}
