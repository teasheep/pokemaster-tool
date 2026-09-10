"use client";

import { useEffect } from "react";

import { CANDY_GROUPS, CANDY_TYPES, CandyBar, useMyCandies } from "@/components/gym/candy";
import {
  TYPE_FOCUS_KINDS,
  TypeFocusBlock,
  useMyTypeFocus,
} from "@/components/gym/type-focus";
import { CandyBarSkeleton } from "@/components/skeletons";

/**
 * 我的背包 — 三塊:
 *   1. 道具 (糖果 / 體系蛋糕捲 / 成長潛力券, 各有幾個) —— 頁面本身就叫「我的背包」,
 *      所以這一塊的標題不再叫背包 (同一個字出現兩次讀起來像重複)
 *   2. 想投入資源的屬性 (複選)
 *   3. 已投入較多資源的屬性 (複選)
 * 2/3 是屬性的集合不是數量, 所以不會長進 CandyBar 裡 (見 0056)。
 */
export function ResourcesClient({
  gymId,
  memberId,
}: {
  gymId: string;
  memberId: string;
}) {
  const res = useMyCandies(gymId, memberId);
  const focus = useMyTypeFocus(gymId, memberId);
  // 抓取一律在 effect: 寫在 render 階段的話第一次 render 必定沒資料。
  useEffect(() => {
    void res.load();
    void focus.load();
    // deps 只認 memberId — 兩個 hook 的 load 每次 render 都是新函式, 放進 deps 會無限重抓。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const counts = res.counts;
  const total = counts ? CANDY_TYPES.reduce((n, t) => n + (counts[t] ?? 0), 0) : 0;

  return (
    // 手機: 卡片內距收到 12px, 讓 CandyBar 的每一列真的用滿整個螢幕寬
    // (舊版 p-4 + 每顆糖各自一張小卡 = 七張只佔左邊 1/3 的卡直排, 整頁 1000px 只為七個數字)
    <div className="space-y-3 sm:space-y-4">
      <section className="rounded-xl border bg-card p-3 sm:p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2 sm:mb-3">
          {/* 背包 icon (遊戲內的道具袋按鈕) — 2026-09-09 使用者指定放在標題旁邊。
              用 <img> 不用 next/image: 這是 22px 的固定小圖, 走 /reference/ui 那條
              30 天快取的路徑, next/image 的最佳化在這個尺寸上只是多一層轉導。 */}
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/reference/ui/bag.webp"
              alt=""
              width={22}
              height={22}
              draggable={false}
              className="select-none"
            />
            道具</h2>
          {counts ? (
            <span className="tabular-nums text-xs text-muted-foreground">共 {total} 個</span>
          ) : null}
        </div>
        {/* 資料未到就畫骨架 (尺寸對齊可編輯版): 先畫唯讀的七顆 0 再整排換成可編輯版
            = 寬度與間距整個重排, 看起來像畫面壞掉 */}
        {/* 分組顯示 (糖果 / 體系與潛力) —— 13 種擠成一排看不出哪些是同一類。
            組名是小字不是第二層標題: 這一塊在頁面上仍然只有「背包」一個職責。 */}
        {counts ? (
          <div className="space-y-3">
            {CANDY_GROUPS.map((g) => (
              <div key={g.key} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{g.label}</div>
                <CandyBar counts={counts} onChange={res.change} editable types={g.types} />
              </div>
            ))}
          </div>
        ) : (
          <CandyBarSkeleton />
        )}
      </section>

      {TYPE_FOCUS_KINDS.map((kind) => (
        <section key={kind} className="rounded-xl border bg-card p-3 sm:p-4">
          <TypeFocusBlock
            kind={kind}
            selected={focus.focus?.[kind] ?? null}
            onToggle={focus.toggle}
          />
        </section>
      ))}
    </div>
  );
}
