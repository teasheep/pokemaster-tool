import { Suspense } from "react";

import { PageShell } from "@/components/page-shell";
import { ActiveGymSync } from "@/components/gym/active-gym-sync";
import { GymNavSkeleton } from "@/components/skeletons";
import { GymNav } from "./gym-nav";

/**
 * /gyms/[id]/** 共用外框: SiteHeader + 道館切換器 + 子導覽 tabs + SiteFooter
 * (子頁不再各自帶 header/footer)。進入時把此館記成「目前道館」(一人可多館)。
 *
 * 這裡**不准再 await 任何資料** — layout 一 await, 導覽就整個 block 住,
 * loading 的 fallback 不會顯示 (Next 16 layout 文件「Interaction with loading.js」)。
 * 取資料的部分全在 <GymNav/> 裡, 用 Suspense 串流進來。
 */
export default async function GymLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <ActiveGymSync gymId={id} />
      {/* 骨架與真實導覽列同一層 sticky/同高度, 否則資料到位時底下的內容會彈一下 */}
      <Suspense fallback={<GymNavSkeleton />}>
        <GymNav gymId={id} />
      </Suspense>
      {/* 內容容器統一在這裡 — 子頁不要再自己包 main/container, 否則切分頁寬度會跳動 */}
      <main className="flex-1">
        <PageShell>{children}</PageShell>
      </main>
    </>
  );
}
