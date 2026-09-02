import { PageShell } from "@/components/page-shell";
import { FilterBarSkeleton, PairWallSkeleton, Sk } from "@/components/skeletons";

/**
 * 分享頁的載入骨架 — 版面對照 shared-collection.tsx:
 *   擁有者頭像 (56px) + 標題 + 統計一行 → 篩選列 → 顯示筆數 → 卡片牆。
 * 這頁的 page.tsx 自己包了 main + PageShell, fallback 要跟著包同一層。
 * 訪客常常是第一次進站 (沒有快取), 這支被看到的機會其實最高。
 */
export default function Loading() {
  return (
    <main className="flex-1">
      <PageShell>
        <span className="sr-only" role="status">
          載入中
        </span>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Sk className="h-14 w-14 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <Sk className="h-7 w-56" delay={100} />
              <Sk className="h-4 w-72 max-w-full" delay={200} />
            </div>
          </div>

          <FilterBarSkeleton />
          <Sk className="h-4 w-20" delay={300} />
          <PairWallSkeleton />
        </div>
      </PageShell>
    </main>
  );
}
