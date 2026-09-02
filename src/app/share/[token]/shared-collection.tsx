"use client";

// 分享頁的收藏呈現 — 與站內同一套卡片牆 (屬性分組 + 原始互動視覺), 但唯讀。
// 訪客也能篩選/排序, 才找得到想看的拍組。

import { useMemo, useState } from "react";

import { PairTypeGrid, type GridItem } from "@/components/gym/pair-type-grid";
import { PairFilterBar } from "@/components/pair-filter-bar";
import { MemberAvatar } from "@/components/gym/member-card";
import { EMPTY_PAIR_FILTERS, matchesPairFilters, type PairFilters } from "@/lib/pairs/filter";
import type { PairSortKey } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

export type SharedEntry = {
  pair: ClientPairRecord;
  promotion: number;
  potential: number;
  superAwakening: number;
  exUnlocked: boolean;
  level: number;
};

export function SharedCollection({
  ownerName,
  ownerAvatar,
  entries,
  catalogTotal,
}: {
  ownerName: string;
  ownerAvatar: string | null;
  entries: SharedEntry[];
  catalogTotal: number;
}) {
  const [filters, setFilters] = useState<PairFilters>(EMPTY_PAIR_FILTERS);
  const [sortBy, setSortBy] = useState<PairSortKey>("release-desc");

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.pair.region) set.add(e.pair.region);
    return [...set];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!matchesPairFilters(e.pair, filters, q)) return false;
      return true;
    });
  }, [entries, filters]);

  // 統計: 幾隻 6★EX / 幾隻超覺醒 — 一眼看出這份收藏的份量
  const stats = useMemo(() => {
    let ex = 0;
    let awaken = 0;
    let maxed = 0;
    for (const e of entries) {
      if (e.exUnlocked) ex++;
      if (e.superAwakening > 0) awaken++;
      if (e.potential >= 5) maxed++;
    }
    return { ex, awaken, maxed };
  }, [entries]);

  // memo 一定要有: 寫在 render body 的話, 任何一次重繪 (例如開合篩選列)
  // 都會產生新陣列 → PairTypeGrid 與整牆卡片的 memo 全失效, 白重畫一次。
  const items = useMemo<GridItem[]>(
    () =>
      filtered.map((e) => ({
        key: e.pair.pairId,
        type: e.pair.type as SyncPairType,
        pair: e.pair,
        owned: true,
        promotion: e.promotion,
        potential: e.potential,
        superAwakening: e.superAwakening,
        ex: e.exUnlocked,
        // 唯讀: 不給 onClick / onCountClick (卡片會自動渲染成非互動)
      })),
    [filtered]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MemberAvatar
          member={{ id: "owner", displayName: ownerName, avatarUrl: ownerAvatar }}
          size="lg"
          className="h-14 w-14 text-xl"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ownerName} 的拍組收藏</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            持有 {entries.length} / {catalogTotal} 組 ・ 6★EX {stats.ex} ・ 超覺醒{" "}
            {stats.awaken} ・ 滿寶 {stats.maxed}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center text-sm text-muted-foreground">
          這份收藏目前還是空的
        </div>
      ) : (
        <>
          <PairFilterBar
            filters={filters}
            onChange={setFilters}
            regions={regions}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
          <div className="text-xs text-muted-foreground">顯示 {filtered.length} 組</div>
          <PairTypeGrid items={items} sortBy={sortBy} emptyText="沒有符合的拍組" />
        </>
      )}
    </div>
  );
}
