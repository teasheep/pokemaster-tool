import { PageHeadingSkeleton, Sk } from "@/components/skeletons";

/**
 * 道館紀錄的載入骨架 — 版面對照 activity-client.tsx:
 *   標題 → 篩選列 (成員下拉 + 類型 chips + 日期 chips) → 一面卡牆 (每張 w-24 + 三行小字)。
 * 只回傳內容 — main / PageShell / 道館 tabs 都在 gyms/[id]/layout.tsx。
 *
 * `force-dynamic` 的路由**沒有 loading.tsx 就不會被 prefetch** (AGENTS 有這一條),
 * 少了它從分頁按過去就是整頁乾等、畫面零反應。
 */
export default function Loading() {
  return (
    <>
      <span className="sr-only" role="status">
        載入中
      </span>
      <PageHeadingSkeleton width="w-24" />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sk className="h-9 w-[170px] rounded-md" />
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Sk key={i} className="h-7 w-16 rounded-full" delay={i * 60} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {Array.from({ length: 26 }, (_, i) => (
            <div key={i} className="w-24">
              <Sk className="h-24 w-24 rounded-xl" delay={(i % 13) * 60} />
              <Sk className="mx-auto mt-1 h-3 w-16" delay={(i % 13) * 60} />
              <Sk className="mx-auto mt-1 h-2.5 w-20" delay={(i % 13) * 60} />
              <Sk className="mx-auto mt-1 h-2.5 w-14" delay={(i % 13) * 60} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
