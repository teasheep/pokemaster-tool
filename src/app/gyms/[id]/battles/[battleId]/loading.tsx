import { Sk, StageBoardSkeleton } from "@/components/skeletons";

/**
 * 單場看板的載入骨架 — 版面對照 page.tsx + battle-client.tsx:
 *   「← 道館戰一覽」→ 頂部列 (賽事切換 / 狀態 / 賽期 + 挑戰券 / 對戰紀錄) → 關卡看板 (兩欄)。
 * 這頁要等十來個查詢, 是全站最有機會看到 fallback 的一頁。
 * 只回傳內容 — main / PageShell / 道館 tabs 都在 gyms/[id]/layout.tsx。
 */
export default function Loading() {
  return (
    <>
      <span className="sr-only" role="status">
        載入中
      </span>
      <div className="mb-4">
        <Sk className="h-5 w-28" />
      </div>
      <div className="space-y-3">
        {/* 頂部精簡列 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
          <Sk className="h-8 w-40" />
          <Sk className="h-5 w-14 rounded-full" delay={100} />
          <span className="mx-1 h-4 w-px bg-border" />
          <Sk className="h-7 w-[128px]" delay={150} />
          <Sk className="h-7 w-[128px]" delay={200} />
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Sk className="h-7 w-20" delay={250} />
            <Sk className="h-7 w-24" delay={300} />
          </span>
        </div>
        <StageBoardSkeleton />
      </div>
    </>
  );
}
