import { PageShell } from "@/components/page-shell";
import {
  FilterBarSkeleton,
  PageHeadingSkeleton,
  PairWallSkeleton,
  Sk,
} from "@/components/skeletons";

/**
 * /pairs 的載入骨架 — 版面對照 pairs-hub.tsx:
 *   標題 (匯出 CSV / 分享) → 子分頁 + 「顯示全部 / 只看我持有的」開關 → 篩選列 → 卡片牆。
 * 這頁的 page.tsx 自己包了 main + PageShell (道館子頁才是 layout 包), fallback 要跟著包同一層,
 * 否則載入中與載入後的內容寬度會差一大截。
 */
export default function Loading() {
  return (
    <main className="flex-1">
      <PageShell>
        <span className="sr-only" role="status">
          載入中
        </span>
        <div className="space-y-4">
          <PageHeadingSkeleton width="w-20" actions={2} />

          {/* 子分頁 (看哪一批) 與持有開關 (看多少) — 與 pairs-hub.tsx 同構:
              手機各自佔滿一列的 44px 控制項, 桌機才是「底線分頁 + 靠右藥丸」同一列 */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:border-b">
            <nav className="flex gap-1 border-b sm:border-b-0">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="flex flex-1 items-center justify-center px-4 py-2 sm:flex-none pointer-coarse:min-h-11"
                >
                  <Sk className="h-5 w-24" delay={i * 100} />
                </div>
              ))}
            </nav>
            <Sk className="h-11 w-full rounded-full sm:mb-1 sm:ml-auto sm:h-7 sm:w-44" delay={200} />
          </div>

          <FilterBarSkeleton />
          <PairWallSkeleton />
        </div>
      </PageShell>
    </main>
  );
}
