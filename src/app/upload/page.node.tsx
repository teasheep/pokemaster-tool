import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { loadPairsForClient } from "@/lib/pairs/loader";
import { ScreenshotUploadClient } from "./screenshot-upload-client";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  // 截圖辨識僅本機開發啟用 (重 ML 依賴不適合雲端部署, 線上版整組隱藏)
  if (process.env.NEXT_PUBLIC_ENABLE_RECOGNITION !== "1") notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/upload");

  const pairs = await loadPairsForClient().catch(() => []);

  return (
    <>      <main className="flex-1">
        <div className="container mx-auto max-w-6xl px-4 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">上傳截圖</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              丟一張遊戲內「拍檔組合」整頁截圖 → 自動辨識 20 個拍組 → 確認後加入收藏。
            </p>
          </div>

          {pairs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-sm text-muted-foreground">
                還沒有參考資料。請執行:
              </p>
              <pre className="mt-3 inline-block rounded bg-muted px-3 py-2 text-xs">
                node scripts/scrape-brybry.mjs
              </pre>
            </div>
          ) : (
            <ScreenshotUploadClient pairs={pairs} />
          )}
        </div>
      </main>    </>
  );
}
