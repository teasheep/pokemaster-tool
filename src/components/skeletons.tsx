// 載入骨架零件 — 等待時的畫面要跟真實版面「同構」(位置/高度對得上),
// 換頁時內容長出來才不會整片重排。轉圈圈做不到這件事, 所以全站不再用它。
//
// 沒有 "use client": 純 JSX 不帶互動 → server (loading.tsx) 與 client 兩邊都能 import。
//
// ── 尺寸來源 (每個數字都對著實際檔案量過; 那邊改版面, 這裡要跟著改) ──
//   卡片 96×96、卡格 w-24 ........ components/sync-pair-card.tsx `dim = { sm: 96 }`
//   卡名 h-[2.5em] @10px、卡間 gap-2.5、屬性段 space-y-7
//                                .. components/gym/pair-type-grid.tsx
//   持有率長條 h-1 + 數字列 ...... app/gyms/[id]/pairs/pairs-client.tsx CoverageBar
//   PageHeading mb-5 / h1 text-xl sm:text-2xl (28→32px)
//                                .. components/page-shell.tsx
//   成員頭像 md = 44px (h-11) .... components/gym/member-card.tsx SIZES
//   子分頁一列 px-4 py-2 text-sm . app/pairs/pairs-hub.tsx、gyms/[id]/pairs/pairs-client.tsx
//   搜尋 w-56 / 排序 w-[118px] / 高度 h-8
//                                .. components/pair-filter-bar.tsx + ui/input.tsx, ui/select.tsx
//   Button 預設 h-8、sm = h-7 .... components/ui/button.tsx
//   道館 tabs px-3 py-2 text-sm .. app/gyms/[id]/gym-tabs.tsx
//   賽事卡 px-4 py-3 + 關卡格 .... app/gyms/[id]/battles-index-client.tsx
//   看板 lg:grid-cols-2、關卡卡 .. app/gyms/[id]/battles/[battleId]/stage-board.tsx
//   隊伍格 minmax(19rem,1fr) ..... components/gym/team-sheet.tsx
//   糖果圖標 56px + 兩側 ± 鈕 h-7  components/gym/candy.tsx
//
// 骨架卡一律是 rounded-xl 灰塊 — **不要**去仿 SyncPairCard 的 SVG:
// 那等於多出第二份卡片規格, 之後必然走鐘 (卡片外觀是照遊戲重現的, 一像素都不能歪)。
// 數量也一律封頂 (3 段 × 13 張), 不為了填滿真實高度鋪一整牆。

import { ShellRow } from "@/components/page-shell";
import { cn } from "@/lib/utils";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** 波浪延遲 — 一整牆同時明滅比不動還吵, 錯開 100ms 才會像水波掃過 */
const wave = (i: number) => (i % 12) * 100;

/**
 * 骨架灰塊 (最小單位)。底色與掃光動畫在 globals.css 的 `skeleton` utility,
 * 這裡只給尺寸; delay 用來錯開一整牆的節奏。
 */
export function Sk({ className, delay }: { className?: string; delay?: number }) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-md", className)}
      style={delay ? ({ "--skeleton-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    />
  );
}

/** 頁面標題列 (PageHeading 的骨架): 標題 + 右側動作鈕 */
export function PageHeadingSkeleton({
  width = "w-40",
  actions = 0,
}: {
  /** 標題寬度的 Tailwind class (依真實標題字數挑, 例 "w-32") */
  width?: string;
  /** 右側動作鈕顆數 */
  actions?: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
      <Sk className={cn("h-7 sm:h-8", width)} />
      {actions > 0 ? (
        <div className="flex items-center gap-2">
          {range(actions).map((i) => (
            <Sk key={i} className="h-8 w-24" delay={wave(i)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 頁內子分頁列 (道館拍組 / 所有遊戲拍組 那一排) */
export function SubTabsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex gap-1 border-b">
      {range(count).map((i) => (
        // 觸控裝置上真的分頁是 44px (pointer-coarse:min-h-11), 骨架要跟上
        <div key={i} className="flex items-center px-4 py-2 pointer-coarse:min-h-11">
          <Sk className="h-5 w-20" delay={wave(i)} />
        </div>
      ))}
    </div>
  );
}

/**
 * 共用篩選列 (PairFilterBar 收合狀態): 搜尋 + 排序 + 篩選鈕。
 * 手機多一條常駐的屬性 chips 橫捲列 (pair-filter-bar.tsx 的 sm:hidden 那段),
 * 而且控制項在觸控裝置是 44px 不是 32px — 少畫這兩者, 卡牆會在資料到位時被往下推。
 */
export function FilterBarSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Sk className="h-8 w-56 pointer-coarse:h-11 max-sm:w-full" />
        <Sk className="h-8 w-[118px] pointer-coarse:h-11" delay={100} />
        <Sk className="h-8 w-20 pointer-coarse:h-11" delay={200} />
      </div>
      {/* 手機常駐屬性列 (單列橫捲, 不換行) */}
      <div className="flex gap-1.5 overflow-hidden pb-1 sm:hidden" aria-hidden>
        {range(8).map((i) => (
          <Sk key={i} className="h-11 w-11 shrink-0 rounded-full" delay={wave(i)} />
        ))}
      </div>
    </div>
  );
}

/**
 * 拍組卡牆 (PairTypeGrid 的骨架): 屬性分段 + 卡 + 兩行卡名。
 * footer = 卡下方還有東西 (全館視角的持有率長條)。
 */
export function PairWallSkeleton({
  sections = 3,
  cards = 13,
  footer = false,
}: {
  sections?: number;
  cards?: number;
  footer?: boolean;
}) {
  return (
    <div className="space-y-7">
      {range(sections).map((s) => (
        <section key={s}>
          {/* 屬性徽章那一列 */}
          <div className="mb-2.5 flex items-center gap-2 border-b border-border/60 pb-1.5">
            <Sk className="h-5 w-16 rounded-full" delay={wave(s)} />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {range(cards).map((i) => {
              const d = wave(s * cards + i);
              return (
                <div key={i} className="w-24">
                  <Sk className="h-24 w-24 rounded-xl" delay={d} />
                  {/* 卡名固定兩行高 (h-[2.5em] @10px = 25px), 卡牆高度才對得上 */}
                  <div className="mt-0.5 h-[2.5em] w-24 text-[10px]">
                    <Sk className="mx-auto h-2 w-20" delay={d} />
                    <Sk className="mx-auto mt-1 h-2 w-14" delay={d + 50} />
                  </div>
                  {footer ? (
                    <div className="w-24">
                      <Sk className="h-1 w-24 rounded-full" delay={d} />
                      <Sk className="mt-0.5 h-3 w-8" delay={d} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 成員名冊 (MemberCard 一列 = 44px 頭像 + 兩行文字) */
export function MemberRosterSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-0.5">
      {range(rows).map((i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
          <Sk className="h-11 w-11 shrink-0 rounded-full" delay={wave(i)} />
          <div className="min-w-0 flex-1 space-y-1">
            <Sk className="h-3.5 w-28" delay={wave(i)} />
            <Sk className="h-2.5 w-20" delay={wave(i) + 50} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 賽事一覽 (第一張展開 — 真頁面也是進行中那場預設展開) */
export function BattleListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-3">
      {range(items).map((i) => (
        <div key={i} className="overflow-hidden rounded-xl border bg-card">
          {/* 收合列: 狀態 badge / 賽事名 / 賽期 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <Sk className="h-5 w-14 rounded-full" delay={wave(i)} />
            <Sk className="h-5 w-40" delay={wave(i)} />
            <Sk className="h-4 w-24" delay={wave(i) + 50} />
            <Sk className="ml-auto h-4 w-4 rounded-full" delay={wave(i)} />
          </div>
          {i === 0 ? (
            <div className="space-y-3 border-t px-4 py-3">
              {/* 每關一格 (屬性 icon + 屬性名 + 出刀張數) */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
                {range(8).map((s) => (
                  <div
                    key={s}
                    className="flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2"
                  >
                    <Sk className="h-6 w-6 rounded-full" delay={wave(s)} />
                    <Sk className="h-3.5 w-10" delay={wave(s)} />
                    <Sk className="h-3 w-8" delay={wave(s) + 50} />
                  </div>
                ))}
              </div>
              <Sk className="h-7 w-28" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 單場看板的關卡卡 (標題列 + 挑戰隊伍 + 輪次列) */
export function StageBoardSkeleton({ stages = 4 }: { stages?: number }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {range(stages).map((i) => (
        <div key={i} className="overflow-hidden rounded-xl border">
          {/* 標題列: 弱點屬性 + 本輪進度 */}
          <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2">
            <Sk className="h-5 w-16 rounded-full" delay={wave(i)} />
            <Sk className="h-7 w-[110px]" delay={wave(i)} />
            <Sk className="ml-auto h-5 w-24 rounded-full" delay={wave(i)} />
          </div>
          <div className="space-y-3 p-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sk className="h-3.5 w-16" delay={wave(i)} />
                <Sk className="ml-auto h-5 w-16 rounded-full" delay={wave(i)} />
              </div>
              {/* 隊伍的三張拍組卡 (96px 卡 + 兩行名) */}
              <div className="flex gap-2">
                {range(3).map((p) => (
                  <div key={p} className="shrink-0">
                    <Sk className="h-24 w-24 rounded-xl" delay={wave(i * 3 + p)} />
                    <Sk className="mx-auto mt-0.5 h-2 w-20" delay={wave(i * 3 + p)} />
                  </div>
                ))}
              </div>
            </div>
            {/* 輪次列 R1-R3 */}
            <div className="space-y-1 border-t pt-2">
              {range(3).map((r) => (
                <div key={r} className="flex items-center gap-2 px-1.5 py-1">
                  <Sk className="h-3.5 w-10" delay={wave(r)} />
                  <Sk className="h-6 w-6 rounded-full" delay={wave(r)} />
                  <Sk className="h-6 w-6 rounded-full" delay={wave(r) + 50} />
                  <Sk className="ml-auto h-8 w-8 rounded-full" delay={wave(r)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 隊伍庫 (屬性 chips + 四個分類, 每類一排等寬隊伍卡) */
export function TeamGridSkeleton({ tags = 4 }: { tags?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {range(10).map((i) => (
          <Sk key={i} className="h-6 w-16 rounded-full" delay={wave(i)} />
        ))}
      </div>
      {range(tags).map((t) => (
        <section key={t}>
          <div className="mb-1.5 flex items-center gap-2">
            <Sk className="h-4 w-1 rounded-full" delay={wave(t)} />
            <Sk className="h-4 w-24" delay={wave(t)} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2">
            {range(2).map((c) => (
              <div key={c} className="rounded-xl border-2 border-border p-2.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sk className="h-4 w-4 rounded-full" delay={wave(t * 2 + c)} />
                  <Sk className="h-4 w-28" delay={wave(t * 2 + c)} />
                </div>
                <div className="flex gap-2">
                  {range(3).map((p) => (
                    <div key={p} className="shrink-0">
                      <Sk className="h-24 w-24 rounded-xl" delay={wave(t * 3 + p)} />
                      <Sk className="mx-auto mt-0.5 h-2 w-20" delay={wave(t * 3 + p)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * 糖果列 (七種糖) — candy.tsx 的 CandyBar 手機/桌機是兩套版面, 骨架也要兩套,
 * 否則資料一到手機整排重排:
 *   手機 (sm 以下): 每種糖各佔滿一列 = 44px 圖 + 名稱 + 兩顆 44px 的 −/＋ (py-1.5 → 56px/列)
 *   桌機: 原本的橫排小卡 (± 鈕平常隱形, 只留位置)
 */
export function CandyBarSkeleton() {
  return (
    <div>
      <div className="flex flex-col gap-2 sm:hidden">
        {range(7).map((i) => (
          <div
            key={i}
            className="flex w-full items-center gap-2 rounded-xl border py-1.5 pl-2.5 pr-1.5"
          >
            <Sk className="h-11 w-11 shrink-0 rounded-full" delay={wave(i)} />
            <Sk className="h-5 min-w-0 flex-1" delay={wave(i)} />
            <span className="h-11 w-11 shrink-0" />
            <span className="w-10 shrink-0" />
            <span className="h-11 w-11 shrink-0" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
        {range(7).map((i) => (
          <div
            key={i}
            className="inline-flex items-center gap-1 rounded-xl border px-1.5 py-1.5"
          >
            <span className="h-7 w-7" />
            <span className="flex flex-col items-center gap-1 px-0.5">
              <Sk className="h-14 w-14 rounded-full" delay={wave(i)} />
              <Sk className="h-4 w-6" delay={wave(i)} />
            </span>
            <span className="h-7 w-7" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 道館子導覽那一條 (道館切換器 + 三個分頁)。
 * 位置與 gyms/[id]/layout.tsx 的 sticky 列一致, 換館時上面那條才不會塌掉。
 */
export function GymNavSkeleton() {
  return (
    <div className="sticky top-14 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* 版面必須與 gym-nav.tsx 逐項對齊 (flex-col → sm:flex-row):
          桌機 = 單列 38px, 高度由 tab 決定 (border-b-2 + py-2 + text-sm = 2+8+20+8);
          手機 = 兩列 (切換器整列 + 三格等寬分頁), 觸控裝置各 44px = 共 88px。
          骨架的 tab 佔位要連 border-b-2 與 pointer-coarse:min-h-11 一起帶, 少哪一項
          資料到位時整頁就往下彈 (抽 GymNav 出來就是為了避免這個)。 */}
      <ShellRow className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <div className="flex w-full items-center py-2 pr-1.5 pointer-coarse:min-h-11 sm:w-auto sm:shrink-0">
          <Sk className="h-5 w-32" />
        </div>
        <div className="grid grid-cols-3 sm:flex sm:flex-1 sm:gap-1">
          {range(3).map((i) => (
            <div
              key={i}
              className="flex items-center justify-center border-b-2 border-transparent px-2 py-2 pointer-coarse:min-h-11 sm:shrink-0 sm:px-3"
            >
              <Sk className="h-5 w-16" delay={wave(i)} />
            </div>
          ))}
        </div>
      </ShellRow>
    </div>
  );
}
