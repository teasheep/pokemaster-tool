import {
  FilterBarSkeleton,
  MemberRosterSkeleton,
  PageHeadingSkeleton,
  PairWallSkeleton,
  SubTabsSkeleton,
} from "@/components/skeletons";

/**
 * 成員與拍組的載入骨架 — 版面對照 members-client.tsx:
 *   標題 (邀請碼 / 匯出 CSV) → 左 260px 名冊 + 右明細 (子分頁 → 篩選列 → 卡片牆)。
 * 預設選的是名冊第一項「全館拍組」, 卡下面有持有率長條 → footer 要開。
 *
 * 只回傳內容: main / PageShell / 道館 tabs 都在 gyms/[id]/layout.tsx,
 * 這裡再包一層容器就會讓切分頁時寬度跳動 (前科)。
 */
export default function Loading() {
  return (
    <>
      <span className="sr-only" role="status">
        載入中
      </span>
      <PageHeadingSkeleton width="w-32" actions={1} />
      {/* 手機/平板 (< lg): 名冊是一列「目前在看誰」的選擇器, 不是整屏清單 —
          骨架要同構, 否則資料一到整塊塌掉 (members-client.tsx 的那顆 min-h-14 按鈕) */}
      <div className="mb-4 h-14 rounded-xl border lg:hidden" aria-hidden />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-6">
        <div className="hidden h-fit lg:block">
          <MemberRosterSkeleton />
        </div>
        <div className="min-w-0 space-y-5">
          <SubTabsSkeleton />
          <FilterBarSkeleton />
          <PairWallSkeleton footer />
        </div>
      </div>
    </>
  );
}
