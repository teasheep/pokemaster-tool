"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      // 觸控裝置直接長到 44px: Button 的隱形命中區已經夠大, 但這顆是 ghost,
      // 按下去的底色要跟得上手指落點才不會像沒反應 (桌機仍是 32px)
      className={cn("pointer-coarse:min-h-11 pointer-coarse:min-w-11", className)}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "切換至淺色主題" : "切換至深色主題"}
      aria-pressed={isDark}
      title={isDark ? "切換至淺色主題" : "切換至深色主題"}
    >
      <Sun className="h-5 w-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute h-5 w-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
