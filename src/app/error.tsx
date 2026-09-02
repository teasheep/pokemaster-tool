"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

// Next.js 16 錯誤邊界: 重試 prop 為 unstable_retry (取代舊版的 reset)
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // 把錯誤記到 console (未來可接錯誤回報服務)
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">發生錯誤</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        頁面在載入時出了點問題, 請稍後再試一次。
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70">
          錯誤代碼: {error.digest}
        </p>
      ) : null}
      <Button onClick={() => unstable_retry()}>
        <RotateCcw aria-hidden="true" />
        重試
      </Button>
    </div>
  );
}
