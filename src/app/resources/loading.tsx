import { PageShell } from "@/components/page-shell";
import { CandyBarSkeleton, PageHeadingSkeleton, Sk, TypeFocusGridSkeleton } from "@/components/skeletons";

/**
 * /resources 的載入骨架 — 版面對照 page.tsx + resources-client.tsx:
 *   標題 → 糖果 → 想投入資源的屬性 → 已投入較多資源的屬性 (三張卡, 每張 rounded-xl border)。
 * 這頁的 page.tsx 自己包了 main + PageShell (道館子頁才是 layout 包), fallback 要跟著包同一層。
 *
 * **為什麼一定要有這個檔** (2026-09-07): `force-dynamic` 的路由**沒有 loading.tsx 就不會被
 * prefetch** (Next 文件「Dynamic Route: prefetching is skipped, or partially prefetched if
 * loading.tsx is present」)。少了它, 從導覽列或使用教學按過來就是整頁乾等伺服器回應,
 * 畫面上完全沒有反應。加上之後 = 骨架立刻出現 + 這條路由可以被預抓。
 *
 * 這頁不在「不要加 loading.tsx」那份名單裡 —— 那條講的是 `await` 完才 redirect 的頁
 * (/、/gyms、/gyms/[id]、/welcome)。/resources 對已登入的成員不轉導, 訪客則早在
 * middleware 就被擋掉, 根本走不到這裡。
 */
export default function Loading() {
  return (
    <main className="flex-1">
      <PageShell width="prose">
        <span className="sr-only" role="status">
          載入中
        </span>
        <PageHeadingSkeleton width="w-24" />
        <div className="space-y-3 sm:space-y-4">
          <section className="rounded-xl border bg-card p-3 sm:p-4">
            {/* 標題列: h2 (text-base) + 右側「共 N 顆」 */}
            <div className="mb-2 flex items-baseline justify-between gap-2 sm:mb-3">
              <Sk className="h-5 w-12" />
              <Sk className="h-4 w-14" delay={100} />
            </div>
            <CandyBarSkeleton />
          </section>

          {/* 兩塊屬性 — 標題 (含灰色小字的括號) + 18 格 */}
          {[0, 1].map((i) => (
            <section key={i} className="rounded-xl border bg-card p-3 sm:p-4">
              <div className="mb-2.5 flex items-baseline justify-between gap-2 sm:mb-3">
                <Sk className="h-5 w-64 max-w-full" delay={i * 100} />
              </div>
              <TypeFocusGridSkeleton />
            </section>
          ))}
        </div>
      </PageShell>
    </main>
  );
}
