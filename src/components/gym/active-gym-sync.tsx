"use client";

// 進入某個道館頁時把它記成「目前道館」— 之後「我的拍組」的道館拍組 ★ 與
// member_pairs 同步都會對到這一館 (一人多館時不會亂跑)。

import { useEffect } from "react";

export function ActiveGymSync({ gymId }: { gymId: string }) {
  useEffect(() => {
    // 一年有效, 同站台共用; SameSite=Lax 讓一般導覽都帶得到
    document.cookie = `pm_active_gym=${gymId}; path=/; max-age=31536000; samesite=lax`;
  }, [gymId]);
  return null;
}
