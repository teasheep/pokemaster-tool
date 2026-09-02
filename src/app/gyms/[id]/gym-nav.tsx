import { ShellRow } from "@/components/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { getMyMemberships } from "@/lib/gym/active-gym";
import { GymTabs } from "./gym-tabs";
import { GymSwitcher } from "./gym-switcher";

/**
 * 道館導覽列 (sticky 那一條: 道館切換器 + tabs)。
 *
 * 為什麼要從 layout 抽出來: Next 16 的 layout 文件「Interaction with loading.js」明講 —
 * 沒開 Cache Components 時, **layout 還在 render 導覽就 block 住, loading 的 fallback
 * 根本不會顯示**。原本 layout 直接 await auth + 道館名單, 於是切分頁時整站卡住不動,
 * 白等一趟 Supabase 才換頁。改由 layout 用 <Suspense fallback={<GymNavSkeleton/>}> 包住
 * 這個元件, 骨架先出、資料到了再換。
 *
 * 外層的 sticky 容器連同這裡一起搬過來 — GymNavSkeleton 自己也帶同一層 sticky,
 * 留在 layout 會在 fallback 時疊成兩條。
 *
 * 注意: tabs 仍然只從 layout 這條路徑渲染 — 抽成元件不等於搬進子頁,
 * 子頁一律不自帶 header/tabs (AGENTS)。
 */
export async function GymNav({ gymId }: { gymId: string }) {
  let gyms: { gymId: string; gymName: string; role: string }[] = [];
  try {
    // getSessionUser 是 request 級快取 — 這裡跟 header/子頁共用同一次 auth 往返
    const user = await getSessionUser();
    if (user) {
      const { all } = await getMyMemberships(user.id);
      gyms = all.map((m) => ({ gymId: m.gymId, gymName: m.gymName, role: m.role }));
    }
  } catch {
    // 未登入等情況: tabs 仍渲染
  }

  return (
    <div className="sticky top-14 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* 手機 = 兩列 (第一列切換器佔滿寬, 第二列三個分頁等寬填滿), 桌機 = 原本的單列。
          擠成一列時「隊伍庫」永遠在畫面外 (要 266px 只有 194px), 而且沒有可捲提示。 */}
      <ShellRow className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <GymSwitcher currentId={gymId} gyms={gyms} />
        <GymTabs gymId={gymId} />
      </ShellRow>
    </div>
  );
}
