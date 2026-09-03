"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * 訪客的「登入」鈕 —— **首頁與登入頁不渲染** (2026-09-03)。
 *
 * 這兩頁的畫面裡本來就有一顆真的 Google 按鈕 (按下去直接去 Google), 右上角再放一顆等於
 * 同一個動作的第二個入口, 而且兩顆長得不一樣 (shadcn 主色鈕 vs 官方 Google 鈕) ——
 * 看的人得先決定要按哪一顆。全站慣例是「一件事一條路徑」, 這裡照辦。
 * (登入頁那顆更沒有意義: 它連到的就是你正在看的這一頁。)
 *
 * **其他頁一定要留著**: 訪客看得到的還有 /pairs 與 /share/[token], 那些頁沒有 CTA,
 * 這顆就是唯一的保底入口。One Tap 不算入口 —— FedCM 之後我們偵測不到它有沒有跳出來
 * (AGENTS.md「登入只有 Google 一條路, 但有兩個觸發」)。
 *
 * usePathname 在 client 元件的 SSR 階段就拿得到值, 所以首頁不會先閃一顆再消失。
 */
/** CTA 已經在畫面上的頁 —— 這裡不再放第二顆 */
const HAS_OWN_CTA = new Set(["/", "/login"]);

export function HeaderSignIn() {
  if (HAS_OWN_CTA.has(usePathname())) return null;

  return (
    <Button asChild size="sm">
      <Link href="/login">登入</Link>
    </Button>
  );
}
