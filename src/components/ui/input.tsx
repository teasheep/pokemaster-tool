import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 觸控裝置 (pointer-coarse) 上輸入框一律 ≥44px 高。
        // 這裡不能像 Button 那樣用隱形 ::before 擴大命中區 —— <input> 是替換元素,
        // 不會渲染 ::before/::after, 只能把本體長高。用 min-h 而不是 h 是為了
        // (a) 不與 base 的 h-8 打架 (min-height 一定勝過較小的 height, 不看 CSS 順序),
        // (b) 呼叫端自己傳 h-9/h-10 時仍然吃得到 44px 下限。
        // iOS Safari 的自動放大: 只在 focus 時字級 < 16px 才觸發 —— base 已經是
        // text-base (16px), md:text-sm 要 ≥768px 才生效, 手機不會踩到, 故字級不動。
        "h-8 pointer-coarse:min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
