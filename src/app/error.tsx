"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

// Next.js 錯誤邊界。
// ⚠ 重試的 prop 名稱換過兩次: 16.2 是 `unstable_retry`, **16.3 起穩定為 `retry`**
// (node_modules/next/dist/docs/.../error.md 的 Version History)。
// 前科 (2026-09-08): 這裡停在 `unstable_retry`, 於是拿到的是 undefined ——
// 使用者在錯誤頁按「重試」完全沒反應, console 噴 TypeError。
// 錯誤頁是出事時唯一的出口, 它自己壞掉最傷。兩個名字都收, 升級 Next 時不會再默默失效。
export default function Error({
  error,
  retry,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  unstable_retry?: () => void;
}) {
  const doRetry = retry ?? unstable_retry;
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
      {/* 兩個名字都拿不到時 (又換名了) 退回重新載入 —— 這顆按鈕不能沒有作用 */}
      <Button onClick={() => (doRetry ? doRetry() : window.location.reload())}>
        <RotateCcw aria-hidden="true" />
        重試
      </Button>
    </div>
  );
}
