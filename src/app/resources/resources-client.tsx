"use client";

import { useEffect } from "react";

import { CANDY_TYPES, CandyBar, useMyCandies } from "@/components/gym/candy";
import { CandyBarSkeleton } from "@/components/skeletons";

export function ResourcesClient({
  gymId,
  memberId,
}: {
  gymId: string;
  memberId: string;
}) {
  const res = useMyCandies(gymId, memberId);
  // 抓取一律在 effect: 寫在 render 階段的話第一次 render 必定沒資料。
  // deps 只認 memberId — useMyCandies 的 load 每次 render 都是新函式, 放進 deps 會無限重抓。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void res.load(), [memberId]);

  const counts = res.counts;
  const total = counts ? CANDY_TYPES.reduce((n, t) => n + (counts[t] ?? 0), 0) : 0;

  return (
    // 手機: 卡片內距收到 12px, 讓 CandyBar 的每一列真的用滿整個螢幕寬
    // (舊版 p-4 + 每顆糖各自一張小卡 = 七張只佔左邊 1/3 的卡直排, 整頁 1000px 只為七個數字)
    <section className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 sm:mb-3">
        <h2 className="text-base font-semibold">糖果</h2>
        {counts ? (
          <span className="tabular-nums text-xs text-muted-foreground">共 {total} 顆</span>
        ) : null}
      </div>
      {/* 資料未到就畫骨架 (尺寸對齊可編輯版): 先畫唯讀的七顆 0 再整排換成可編輯版
          = 寬度與間距整個重排, 看起來像畫面壞掉 */}
      {counts ? (
        <CandyBar counts={counts} onChange={res.change} editable />
      ) : (
        <CandyBarSkeleton />
      )}
    </section>
  );
}
