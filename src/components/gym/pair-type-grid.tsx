"use client";

// 按 18 屬性分組的拍組卡片牆 — /gyms/[id]/pairs 與 /inventory 共用。
// 卡片本身 (SyncPairCard) 已呈現拍組圖、左下寶數 hex、底部超覺醒星、星級與屬性;
// 這裡只負責分組、標題列與卡片下方的附註 (標籤/持有人數…)。

import { memo, startTransition, useCallback, useEffect, useMemo, useState } from "react";

import { SyncPairCard } from "@/components/sync-pair-card";
import { TypeBadge } from "@/components/sync-pair-badges";
import { PairWallSkeleton } from "@/components/skeletons";
import { ALL_TYPES } from "@/data/sync-pairs";
import { pairComparator, pairName, type PairSortKey } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

export type GridItem = {
  /** 唯一 key (gym_pairs.id 或 pairId) */
  key: string;
  type: SyncPairType;
  /** 圖鑑資料; 沒有 (catalog 未收錄) 時以純文字卡片呈現 */
  pair: ClientPairRecord | null;
  /** 對不到圖鑑時的顯示名 */
  fallbackLabel?: string;
  owned: boolean;
  promotion?: number;
  potential?: number | null;
  superAwakening?: number;
  ex?: boolean;
  /** 卡片下方附註 (預設不顯示任何文字; 只有需要時才給) */
  footer?: React.ReactNode;
  /** 卡片右上角小標 (★ 道館指定拍組之類的狀態標記) */
  corner?: React.ReactNode;
  onClick?: () => void;
  /** 左下角計數點擊 (寶數 +1 → 超覺醒 → 循環) */
  onCountClick?: () => void;
};

/**
 * SSR HTML 就帶 href 的張數 (跨屬性連續數)。
 * 這是「張數」不是「列數」, 而每列幾張隨螢幕寬變: 桌機約 13 張/列, 手機只有 3 張/列。
 * 給 60 的話桌機是 4-5 列 (剛好一屏), 手機卻是 20 列 ≈ 4 個螢幕高 — 等於在最該省流量的
 * 裝置上先下載 120 張圖。給 24: 桌機 SSR 就填滿前兩列, 手機約一屏; 其餘由 hydration 後的
 * IntersectionObserver + 800px 預載邊界接手, 使用者捲到時圖已經在了。
 *
 * `ssrEagerOnly` 時這個數字同時決定「SSR 要畫幾張卡」— 兩者刻意綁在一起:
 * SSR 出來的卡都是有圖的卡, 不會出現「有卡框但空著等 hydration 補圖」的中間態。
 */
const DEFAULT_EAGER_COUNT = 24;

// 單格抽成 memo 元件的重點不只是少重繪 — 點擊閉包要在「格子裡」建立, 整面牆才能共用
// 同一顆 grid 級 onSelect/onCount (每格各給一顆 inline 閉包的話, memo 永遠擋不住)。
const GridCell = memo(function GridCell({
  item,
  size,
  showExRole,
  eager,
  scrollRoot,
  onSelect,
  onCount,
  first = false,
}: {
  item: GridItem;
  size: "sm" | "md";
  showExRole: boolean;
  eager: boolean;
  scrollRoot?: Element | null;
  onSelect?: (key: string) => void;
  onCount?: (key: string) => void;
  /** 整面牆的第一張 — 使用教學要框的目標 (只標一張, 645 張都標沒有意義) */
  first?: boolean;
}) {
  const key = item.key;
  const select = useCallback(() => onSelect?.(key), [onSelect, key]);
  const count = useCallback(() => onCount?.(key), [onCount, key]);
  // grid 級 handler 優先; 沒給才退回 GridItem 自己的 (兩種都留著, 呼叫端擇一)
  const handleClick = onSelect ? select : item.onClick;
  const handleCount = onCount ? count : item.onCountClick;

  return (
    <div className="relative w-24" data-tour={first ? "pair-card" : undefined}>
      {item.corner ? (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 leading-none drop-shadow">
          {item.corner}
        </span>
      ) : null}
      {item.pair ? (
        <SyncPairCard
          pair={item.pair}
          size={size}
          showName={false}
          minimal
          owned={item.owned}
          promotion={item.promotion}
          potential={item.potential ?? undefined}
          superAwakening={item.superAwakening}
          awakenable={item.pair.hasAwakening}
          ex={item.ex}
          showExRole={showExRole}
          onClick={handleClick}
          onCountClick={handleCount}
          eager={eager}
          scrollRoot={scrollRoot}
          className="w-24"
        />
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed p-1 text-center text-[10px] leading-tight text-muted-foreground hover:bg-accent/40"
          title="圖鑑未收錄此拍組"
        >
          {item.fallbackLabel ?? "未知拍組"}
        </button>
      )}
      {/* 名稱一律「人名 & 寶可夢名」— 兩行, 單行會被截斷。
          固定兩行高 (leading-tight × 2 = 2.5em): 名字一行/兩行的卡混在一起時,
          下面的持有率長條才會對齊在同一條水平線上。 */}
      <div
        className="mt-0.5 line-clamp-2 h-[2.5em] w-24 text-center text-[10px] leading-tight text-muted-foreground"
        title={item.pair ? pairName(item.pair) : item.fallbackLabel}
      >
        {item.pair ? pairName(item.pair) : (item.fallbackLabel ?? "")}
      </div>
      {item.footer ? (
        <div className="w-24 text-center text-[10px] leading-tight">{item.footer}</div>
      ) : null}
    </div>
  );
});

export const PairTypeGrid = memo(function PairTypeGrid({
  items,
  size = "sm",
  emptyText = "沒有符合的拍組。",
  sortBy = "release-desc",
  showExRole = false,
  onSelect,
  onCount,
  eagerCount = DEFAULT_EAGER_COUNT,
  ssrEagerOnly = false,
  scrollRoot,
}: {
  items: GridItem[];
  size?: "sm" | "md";
  emptyText?: string;
  /** 組內排序 (預設最新上架優先) */
  sortBy?: PairSortKey;
  /** 顯示 EX role 第二徽章 (由頁面的全域開關控制) */
  showExRole?: boolean;
  /** 點卡片 (grid 級穩定 handler, 收 GridItem.key); 沒給就用 GridItem.onClick */
  onSelect?: (key: string) => void;
  /** 點左下角計數 (同上, 沒給就用 GridItem.onCountClick) */
  onCount?: (key: string) => void;
  /** 前幾張跳過延遲判定直接載圖 (跨屬性連續數); 給太少會讓首屏下半在 hydration 前是空的 */
  eagerCount?: number;
  /**
   * SSR 只畫 eagerCount 張, 其餘等 hydration 後在瀏覽器補 (預設關 = 整牆照舊 SSR)。
   *
   * 給 /pairs 用: 那頁一次 645 張卡 × 每張約 17 個 SVG 元素 ≈ 11,000 個元素,
   * 產出的 HTML 光卡片就 1.1MB — Cloudflare Workers 的 CPU 幾乎全花在
   * 「把這串 HTML 編成 UTF-8 bytes」(react-dom 的 writeChunk/TextEncoder), 免費方案因此
   * 隨機噴 Error 1102。卡片本身的外觀/互動完全不動, 只是換個地方畫。
   *
   * 代價寫清楚: 沒有 JS 的話卡牆只剩這 24 張 (下面補一行 noscript 說明)。
   * 這頁的篩選/子分頁/持有開關本來就全部靠 JS, 所以不是新的相依。
   */
  ssrEagerOnly?: boolean;
  /** 卡片在自己捲的框裡時, 把那個框傳進來當延遲載圖的 root */
  scrollRoot?: Element | null;
}) {
  /**
   * hydration 之前 (SSR + client 第一輪) 只輸出 eagerCount 張。兩條規矩少一條就會比不做還慘:
   *   1. **client 的第一輪也要畫一模一樣的那幾張** → 用 state 判斷, 不是 typeof window。
   *      兩邊輸出不一致 = 整牆 hydration mismatch, React 會把 SSR 的 HTML 全丟掉重畫。
   *   2. 補完整牆的那次 render 放進 startTransition — 645 張卡不會卡住輸入, 使用者在補牆
   *      途中打搜尋字, React 會直接丟掉這次改畫新的 (hydration 本來就要畫這 645 張,
   *      所以這裡不是多出來的工作, 只是挪到可被打斷的優先權)。
   */
  const [filled, setFilled] = useState(!ssrEagerOnly);
  useEffect(() => {
    if (!filled) startTransition(() => setFilled(true));
  }, [filled]);
  const limit = filled ? null : eagerCount;

  // 分組 + 18 個陣列各排一次不便宜, 一定要 memo — 之前寫在元件 body, 任何一次重繪
  // (勾一個篩選、開一次側板) 都要整份重算。
  const wall = useMemo(() => {
    const byType = new Map<SyncPairType, GridItem[]>();
    for (const it of items) {
      const list = byType.get(it.type);
      if (list) list.push(it);
      else byType.set(it.type, [it]);
    }
    // 組內排序依 sortBy (預設最新上架排越前); 圖鑑外 (無 pair) 一律排最尾。
    // 星級排序用「卡片上顯示的星」(promotion, 我的拍組傳個人升星) 而非原始星級,
    // 否則升到 6★EX 的 3★ 拍組會排在畫面上星星比它少的卡後面。
    const cmp = pairComparator(sortBy);
    const byStar = sortBy === "star-desc"; // 拉到比較函式外 (每比一次判斷一次字串太浪費)
    const sortSection = (list: GridItem[]) =>
      list.sort((a, b) => {
        if (!a.pair || !b.pair) return a.pair ? -1 : b.pair ? 1 : 0;
        if (byStar) {
          const sa = a.promotion ?? a.pair.basePotential ?? 0;
          const sb = b.promotion ?? b.pair.basePotential ?? 0;
          if (sa !== sb) return sb - sa;
        }
        // pairComparator 各鍵都以 pairId 收尾 → 同值時次序穩定, 卡片不會跳位
        return cmp(a.pair, b.pair);
      });

    // eager 的流水號要**跨 section 連續**: 每個 section 各數一次的話, 18 個屬性都會各給 60 張
    // (limit 時同一個流水號兼作「畫到第幾張為止」, 所以畫出來的一定都是 eager 的卡)
    let offset = 0;
    let left = limit ?? Infinity;
    let hidden = 0;
    const sections: { type: SyncPairType; list: GridItem[]; offset: number }[] = [];
    for (const t of ALL_TYPES) {
      const all = byType.get(t);
      if (!all) continue;
      if (left <= 0) {
        hidden += all.length;
        continue;
      }
      // **排序也要放在迴圈裡**: limit 時只有排得到的那一兩段需要排,
      // 其餘 16-17 段的 sort 在 Worker 上是白花的 CPU (整牆 645 筆約 0.7ms/次)。
      sortSection(all);
      const shown = all.length <= left ? all : all.slice(0, left);
      sections.push({ type: t, list: shown, offset });
      offset += shown.length;
      left -= shown.length;
      hidden += all.length - shown.length;
    }
    return { sections, hidden };
  }, [items, sortBy, limit]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-7">
      {wall.sections.map(({ type, list, offset }) => (
        <section key={type} className="scroll-mt-16" id={`type-${type}`}>
          <div className="mb-2.5 flex items-center gap-2 border-b border-border/60 pb-1.5">
            <TypeBadge type={type} />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {list.map((it, i) => (
              <GridCell
                key={it.key}
                item={it}
                size={size}
                showExRole={showExRole}
                eager={offset + i < eagerCount}
                scrollRoot={scrollRoot}
                onSelect={onSelect}
                onCount={onCount}
                first={offset + i === 0}
              />
            ))}
          </div>
        </section>
      ))}
      {/* 還沒畫的部分先擺骨架 — 與真實卡牆同構 (96px 卡 + 兩行卡名 + 屬性徽章列),
          hydration 補上真卡時位置對得起來, 不會整頁往下彈。
          數量只是「下面還有東西」的提示, 不鋪滿 621 張 (那等於把省下的 HTML 又長回來)。 */}
      {wall.hidden > 0 ? (
        <>
          <PairWallSkeleton
            sections={wall.hidden > 13 ? 2 : 1}
            cards={Math.min(13, wall.hidden)}
          />
          <noscript>
            <p className="text-sm text-muted-foreground">
              其餘 {wall.hidden} 張拍組卡與篩選功能需要 JavaScript 才能顯示。
            </p>
          </noscript>
        </>
      ) : null}
    </div>
  );
});
