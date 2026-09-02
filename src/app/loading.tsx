import { PageShell } from "@/components/page-shell";
import { PageHeadingSkeleton, Sk } from "@/components/skeletons";

/**
 * 根層路由 fallback (Server Component)。
 *
 * 兩個要求互相拉扯, 都要顧到:
 *  1. 寬度要對 — 一定要包 main + PageShell。少了容器就是一條窄的置中區塊, 真實內容是
 *     1400px 寬版, 換頁時左右整片重排 (之前的轉圈圈版就是這樣)。
 *  2. 越低調越好 — / /gyms /welcome 這些頁是「await 完才 redirect」, 而
 *     redirect() + loading.tsx = 會先串流出這個殼再跳走; 花俏的 fallback 只會讓那一閃更明顯。
 * 所以這裡只擺標題 + 幾條文字, 不擺任何一頁專屬的版面 (那些各自有自己的 loading.tsx)。
 */
export default function Loading() {
  return (
    <main className="flex-1">
      <PageShell>
        <span className="sr-only" role="status">
          載入中
        </span>
        <PageHeadingSkeleton width="w-32" />
        <div className="space-y-3">
          <Sk className="h-4 w-full max-w-md" />
          <Sk className="h-4 w-full max-w-lg" delay={100} />
          <Sk className="h-4 w-5/6 max-w-sm" delay={200} />
        </div>
      </PageShell>
    </main>
  );
}
