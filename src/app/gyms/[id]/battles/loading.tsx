import { BattleListSkeleton, PageHeadingSkeleton } from "@/components/skeletons";

/**
 * 道館戰一覽的載入骨架 — 版面對照 battles-index-client.tsx:
 *   標題 (建立賽事) → 賽事卡清單, 第一張展開 (真頁面也是進行中那場預設展開)。
 * 只回傳內容 — main / PageShell / 道館 tabs 都在 gyms/[id]/layout.tsx。
 */
export default function Loading() {
  return (
    <>
      <span className="sr-only" role="status">
        載入中
      </span>
      <PageHeadingSkeleton width="w-24" actions={1} />
      <BattleListSkeleton />
    </>
  );
}
