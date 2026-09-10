"use client";

// 拍組篩選列 — 全站唯一實作, 層級式:
//   常駐: 搜尋 + 排序 + 「篩選」開關 + 清除
//   展開: 屬性 / 角色 / 系列 / 地區 / 原始星級 / 超覺醒 — 分組標籤 + chips 多選
// 這裡只篩「拍組本身的性質」; 我有沒有、是不是道館指定是分頁在決定的, 不要放進來。
// 全部用 chips 點選 (同面向多選=或, 面向之間=且), 不用下拉勾選。

import { useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TypeIcon } from "@/components/sync-pair-badges";
import {
  ALL_TYPES,
  REGION_LABELS,
  ROLE_LABELS,
  sortRegions,
  TYPE_COLORS,
  TYPE_LABELS,
} from "@/data/sync-pairs";
import {
  GENDER_LABELS,
  GENDER_TAGS,
  TAG_GROUPS,
  TAG_LABELS,
  THEME_ORDER,
  THEME_LABELS,
} from "@/data/pair-facets";
import {
  EMPTY_PAIR_FILTERS,
  hasActiveFilters,
  type PairFilters,
} from "@/lib/pairs/filter";
import {
  PAIR_SORT_LABELS,
  PAIR_SORT_ORDER,
  SERIES_LABELS,
  SERIES_ORDER,
  type PairSortKey,
} from "@/lib/pairs/name";
import type { SyncPairRole } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

/** 多選 chip — 全站篩選的基本元件 (頁面自訂面向也用這顆, 樣式才一致) */
export function Chip({
  active,
  onClick,
  children,
  activeClass,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** 選中時的加色 (屬性 chips 用 TYPE_COLORS) */
  activeClass?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        // 手機加大到好按 (屬性 icon 只有 16px 時根本點不到);
        // pointer-coarse 再補一道 44px 下限 — 平板/觸控筆電是桌機寬度但一樣用手指點
        "inline-flex items-center gap-1 rounded-full border text-xs transition-all duration-150 active:scale-95",
        "px-2.5 py-1 max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm pointer-coarse:min-h-11",
        active
          ? cn("border-primary font-medium shadow-sm", activeClass ?? "bg-accent")
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** 篩選面板中的一組: 左側分組名 + chips (手機改上下堆疊, chips 才有寬度) */
export function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 max-sm:block">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground max-sm:mb-1 max-sm:block">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** 主題預設露幾顆 (兩排左右; 其餘按「還有 N 種」才展開) */
const THEME_SHOWN = 16;

/**
 * 「還有 N 種 / 收合」——**不是篩選值, 所以不能長得像 chip**
 * (2026-09-10 使用者:「全部 XX 種 跟 收合 應該要有不太一樣的 UI 不然不會發現」)。
 * 差別做在三個地方: 虛線框、沒有實心底、前面掛一個會轉的箭頭 —— 一眼就看得出這顆是開關。
 */
function MoreChip({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 bg-transparent",
        "px-2.5 py-1 text-xs font-medium text-primary transition-all duration-150 active:scale-95",
        "hover:border-primary hover:bg-primary/10",
        "max-sm:min-h-11 max-sm:px-3 max-sm:py-2 max-sm:text-sm pointer-coarse:min-h-11"
      )}
    >
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      {label}
    </button>
  );
}

/** 第二層面向目前選了幾個 (「更多面向」的數字 + 併進「篩選」按鈕的總數) */
function moreCountOf(f: PairFilters): number {
  return f.weaks.length + f.moves.length + f.themes.length + f.tags.length;
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function PairFilterBar({
  filters,
  onChange,
  regions,
  sortBy,
  onSortChange,
  children,
  trailing,
  facets,
  facetCount = 0,
}: {
  filters: PairFilters;
  onChange: (next: PairFilters) => void;
  /** 圖鑑中出現過的地區清單 (英文原值; 顯示一律繁中) */
  regions: string[];
  sortBy: PairSortKey;
  onSortChange: (s: PairSortKey) => void;
  /** 與搜尋同列的頁面專屬控制項 */
  children?: React.ReactNode;
  /** 靠右的頁面專屬控制項 (匯出/分享等) */
  trailing?: React.ReactNode;
  /** 頁面專屬的篩選面向 (放進同一個篩選面板, 不要在工具列另外長一顆下拉) */
  facets?: React.ReactNode;
  /** 上面那些面向目前選了幾個 (併進「篩選」按鈕的數字) */
  facetCount?: number;
}) {
  const set = (patch: Partial<PairFilters>) => onChange({ ...filters, ...patch });
  // 進階面向有選東西時自動展開 (清除後仍維持使用者的開合選擇)
  const advCount =
    filters.types.length +
    filters.roles.length +
    filters.series.length +
    filters.regions.length +
    filters.stars.length +
    (filters.awakenOnly ? 1 : 0) +
    moreCountOf(filters) +
    facetCount;
  const [advOpen, setAdvOpen] = useState(advCount > 0);
  // 第二層面向 (上游抄過來的四個) 預設收著 —— 一次攤開 120 顆 chip 沒有人找得到東西
  const [moreOpen, setMoreOpen] = useState(moreCountOf(filters) > 0);
  const [allThemes, setAllThemes] = useState(false);

  return (
    <div className="space-y-2.5">
      {/* 搜尋 + 排序 + 篩選開關 + 頁面控制項 (手機: 搜尋獨佔一行) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56 max-sm:w-full">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="搜尋訓練家 / 寶可夢..."
            className="pl-9"
          />
        </div>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as PairSortKey)}>
          <SelectTrigger className="w-[118px]">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            {PAIR_SORT_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {PAIR_SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={advOpen || advCount > 0 ? "secondary" : "outline"}
          onClick={() => setAdvOpen((v) => !v)}
          // 觸控裝置上與同列的搜尋框/排序下拉一樣高 (44px), 這一列才不會長短不齊
          className="pointer-coarse:min-h-11"
        >
          <SlidersHorizontal className="mr-1 h-4 w-4" />
          篩選
          {advCount > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 text-[11px] font-bold leading-4 text-primary-foreground max-sm:text-xs">
              {advCount}
            </span>
          )}
        </Button>

        {hasActiveFilters(filters) && (
          <Button
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_PAIR_FILTERS })}
            className="pointer-coarse:min-h-11"
          >
            <X className="mr-1 h-4 w-4" />
            清除
          </Button>
        )}

        {children}
        {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
      </div>

      {/* 手機: 屬性 chips 常駐 (AGENTS 的層級式篩選 = 搜尋 + 屬性常駐, 其餘收進「篩選」)。
          19 個屬性在 390px 寬要排三、四排才放得下 → 改成單列橫捲, 右緣壓一道漸層
          當「還有東西」的提示 (道館分頁列被切掉又看不出可捲, 使用者當場抱怨過)。
          這整塊在 sm 以上是 display:none, 桌機仍然只有展開面板裡那一組屬性 chips。 */}
      <div className="relative -mx-1 sm:hidden">
        <div className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&>button]:shrink-0 [&::-webkit-scrollbar]:hidden">
          <Chip active={filters.types.length === 0} onClick={() => set({ types: [] })}>
            全部屬性
          </Chip>
          {ALL_TYPES.map((t) => (
            <Chip
              key={t}
              active={filters.types.includes(t)}
              onClick={() => set({ types: toggleIn(filters.types, t) })}
              activeClass={TYPE_COLORS[t]}
              title={TYPE_LABELS[t]}
            >
              <TypeIcon type={t} className="h-6 w-6" />
              <span className="whitespace-nowrap">{TYPE_LABELS[t]}</span>
            </Chip>
          ))}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
        />
      </div>

      {/* 篩選面板 (分組 chips) */}
      {advOpen && (
        <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5">
          {/* 屬性在手機已經常駐在上面那條橫捲列了, 這裡只留給桌機 (面向沒有增減, 只是位置不同) */}
          <div className="max-sm:hidden">
            <FacetGroup label="屬性">
              <Chip active={filters.types.length === 0} onClick={() => set({ types: [] })}>
                全部
              </Chip>
              {ALL_TYPES.map((t) => (
                <Chip
                  key={t}
                  active={filters.types.includes(t)}
                  onClick={() => set({ types: toggleIn(filters.types, t) })}
                  activeClass={TYPE_COLORS[t]}
                  title={TYPE_LABELS[t]}
                >
                  <TypeIcon type={t} className="h-4 w-4" />
                  <span className="whitespace-nowrap">{TYPE_LABELS[t]}</span>
                </Chip>
              ))}
            </FacetGroup>
          </div>
          <FacetGroup label="角色">
            {(Object.keys(ROLE_LABELS) as SyncPairRole[]).map((r) => (
              <Chip
                key={r}
                active={filters.roles.includes(r)}
                onClick={() => set({ roles: toggleIn(filters.roles, r) })}
              >
                {ROLE_LABELS[r]}
              </Chip>
            ))}
          </FacetGroup>
          <FacetGroup label="系列">
            {SERIES_ORDER.map((s) => (
              <Chip
                key={s}
                active={filters.series.includes(s)}
                onClick={() => set({ series: toggleIn(filters.series, s) })}
              >
                {SERIES_LABELS[s]}
              </Chip>
            ))}
          </FacetGroup>
          <FacetGroup label="地區">
            {sortRegions(regions).map((r) => (
              <Chip
                key={r}
                active={filters.regions.includes(r)}
                onClick={() => set({ regions: toggleIn(filters.regions, r) })}
              >
                {REGION_LABELS[r] ?? r}
              </Chip>
            ))}
          </FacetGroup>
          {/* 星級 = 原始星級 (3/4/5), 只放星級 */}
          <FacetGroup label="原始星級">
            {[3, 4, 5].map((n) => (
              <Chip
                key={n}
                active={filters.stars.includes(n)}
                onClick={() =>
                  set({
                    stars: filters.stars.includes(n)
                      ? filters.stars.filter((x) => x !== n)
                      : [...filters.stars, n],
                  })
                }
              >
                {n}★
              </Chip>
            ))}
          </FacetGroup>
          {/* 可否超覺醒是拍組本身的另一個性質, 不是星級 — 獨立一個面向 */}
          <FacetGroup label="超覺醒">
            <Chip
              active={filters.awakenOnly}
              onClick={() => set({ awakenOnly: !filters.awakenOnly })}
              title="只顯示可超覺醒的拍組"
            >
              可超覺醒
            </Chip>
          </FacetGroup>
          {facets}

          {/* ── 第二層: 上游 (pomasters) 那份資料才有的四個面向 ──
              弱點 / 招式屬性 / 主題 / 標籤。**預設收著**: 攤開有一百多顆 chip,
              常用的六個面向會被推到看不見的地方。開過就記在這一次的開合狀態裡。 */}
          <div className="border-t pt-2">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
              更多面向：弱點 · 招式 · 主題 · 標籤
              {moreCountOf(filters) > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-4 text-primary-foreground">
                  {moreCountOf(filters)}
                </span>
              )}
            </button>
          </div>

          {moreOpen && (
            <div className="space-y-2">
              {/* 弱點 = 這隻寶可夢怕什麼屬性 (道館戰在挑的就是這個) */}
              <FacetGroup label="弱點">
                {ALL_TYPES.map((t) => (
                  <Chip
                    key={t}
                    active={filters.weaks.includes(t)}
                    onClick={() => set({ weaks: toggleIn(filters.weaks, t) })}
                    activeClass={TYPE_COLORS[t]}
                    title={`弱點 ${TYPE_LABELS[t]}`}
                  >
                    <TypeIcon type={t} className="h-4 w-4" />
                    <span className="whitespace-nowrap">{TYPE_LABELS[t]}</span>
                  </Chip>
                ))}
              </FacetGroup>

              {/* 招式屬性 = 這組拍組打得出哪些屬性的招 (不等於它自己的屬性) */}
              <FacetGroup label="招式屬性">
                {ALL_TYPES.map((t) => (
                  <Chip
                    key={t}
                    active={filters.moves.includes(t)}
                    onClick={() => set({ moves: toggleIn(filters.moves, t) })}
                    activeClass={TYPE_COLORS[t]}
                    title={`會 ${TYPE_LABELS[t]}屬性的招式`}
                  >
                    <TypeIcon type={t} className="h-4 w-4" />
                    <span className="whitespace-nowrap">{TYPE_LABELS[t]}</span>
                  </Chip>
                ))}
              </FacetGroup>

              <FacetGroup label="訓練家">
                {GENDER_TAGS.map((g) => (
                  <Chip
                    key={g}
                    active={filters.tags.includes(g)}
                    onClick={() => set({ tags: toggleIn(filters.tags, g) })}
                  >
                    {GENDER_LABELS[g]}
                  </Chip>
                ))}
              </FacetGroup>

              {/* 主題有 60 幾種 —— 預設只露前兩排, 其餘按「全部」才展開 */}
              <FacetGroup label="主題">
                {(allThemes ? THEME_ORDER : THEME_ORDER.slice(0, THEME_SHOWN)).map((t) => (
                  <Chip
                    key={t}
                    active={filters.themes.includes(t)}
                    onClick={() => set({ themes: toggleIn(filters.themes, t) })}
                  >
                    {THEME_LABELS[t]}
                  </Chip>
                ))}
                <MoreChip
                  open={allThemes}
                  onClick={() => setAllThemes((v) => !v)}
                  label={allThemes ? "收合" : `還有 ${THEME_ORDER.length - THEME_SHOWN} 種`}
                />
              </FacetGroup>

              {TAG_GROUPS.map((g) => (
                <FacetGroup key={g.label} label={g.label}>
                  {g.tags.map((t) => (
                    <Chip
                      key={t}
                      active={filters.tags.includes(t)}
                      onClick={() => set({ tags: toggleIn(filters.tags, t) })}
                    >
                      {TAG_LABELS[t]}
                    </Chip>
                  ))}
                </FacetGroup>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
