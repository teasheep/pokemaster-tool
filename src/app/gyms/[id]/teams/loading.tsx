import { PageHeadingSkeleton, TeamGridSkeleton } from "@/components/skeletons";

/**
 * 隊伍庫的載入骨架 — 版面對照 team-sheet.tsx 的 TeamLibrary:
 *   標題 → 屬性 chips → 四個分類 (降抗/物攻/特攻/收尾), 每類一排等寬隊伍卡。
 * 只回傳內容 — main / PageShell / 道館 tabs 都在 gyms/[id]/layout.tsx。
 */
export default function Loading() {
  return (
    <>
      <span className="sr-only" role="status">
        載入中
      </span>
      <PageHeadingSkeleton width="w-24" />
      <TeamGridSkeleton />
    </>
  );
}
