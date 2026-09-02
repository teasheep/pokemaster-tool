import { cn } from "@/lib/utils"

// 底色與動畫一律吃 globals.css 的 `skeleton` utility (掃光, 不是 animate-pulse) —
// 全站骨架只能有一套寫法, 這顆與 components/skeletons.tsx 的 Sk 長得一樣才不會走鐘。
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
