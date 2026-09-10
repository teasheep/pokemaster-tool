"use client";

import { useRouter } from "next/navigation";
import { GraduationCap, LogOut, Moon, Plug, Settings, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { openTour } from "@/components/tour/tour-store";

export function UserMenu({ email }: { email: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { resolvedTheme, setTheme } = useTheme();
  const initial = email ? email[0]!.toUpperCase() : "?";

  const onLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("登出失敗", { description: error.message });
      return;
    }
    toast.success("已登出");
    router.push("/");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 觸控裝置的按鈕本體長到 44px, 頭像圓圈維持 32px (桌機外觀不變) */}
        <Button
          variant="ghost"
          size="icon"
          // 只有一顆頭像圓圈, 沒有文字 → 讀螢幕的人只聽得到「button」。
          // QA 腳本也靠這個名字找它 (2026-09-10: gym-code-test 找不到而靜靜失敗)。
          aria-label="帳號選單"
          className="rounded-full pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">已登入</p>
            <p className="text-xs leading-none text-muted-foreground">
              {email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={() => router.push("/pairs?tab=mine")}>
          <User className="mr-2 h-4 w-4" />
          我的拍組
        </DropdownMenuItem>
        <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={() => router.push("/profile")}>
          <Settings className="mr-2 h-4 w-4" />
          個人設定
        </DropdownMenuItem>
        <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={() => router.push("/connect")}>
          <Plug className="mr-2 h-4 w-4" />
          資料連線
        </DropdownMenuItem>
        {/* 使用教學 —— 第一次登入會自己跳一次, 這裡是「再看一次」的唯一入口。
            選單關閉有動畫, 教學的 overlay 要等它關完才不會搶焦點 → 下一個 tick 再開。 */}
        <DropdownMenuItem
          className="pointer-coarse:min-h-11"
          onClick={() => setTimeout(() => openTour(), 0)}
        >
          <GraduationCap className="mr-2 h-4 w-4" />
          使用教學
        </DropdownMenuItem>
        {/* 主題切換 —— 只在手機 (<sm) 出現, 桌機是 header 上那顆獨立的 ThemeToggle。
            兩者是同一個設定在不同裝置的唯一入口, 不是兩條路。
            resolvedTheme 才會把 system 解析成實際的深/淺 (theme 可能是 "system")。 */}
        <DropdownMenuItem
          className="pointer-coarse:min-h-11 sm:hidden"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
          {resolvedTheme === "dark" ? "切換淺色模式" : "切換深色模式"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={onLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
