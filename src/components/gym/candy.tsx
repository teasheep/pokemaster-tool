"use client";

/* eslint-disable @next/next/no-img-element */

// 糖果圖標與庫存列 — 遊戲真實制度:
//   招式糖 (升寶數) 按「拍組角色」分五種: 攻擊/技巧/輔助/衝刺/場地
//   + 通用糖 (5★ Move Candy, 群內俗稱黃糖) — 任何拍組都能吃
//   + 棒棒糖 (超覺醒糖果) — 升超覺醒; 通用糖可兌換棒棒糖
// 圖片 = 遊戲內 item 圖 (serebii / bulbapedia), 放 public/reference/ui/candy/。
// 副檔名一律 .webp — scripts/convert-card-images.mjs 把 256px 的 PNG 原檔縮到 128px
// (全站最大顯示 60px × DPR2) 再轉檔; PNG 留 repo 但不進部署 (public/.assetsignore)。
// 之後要放大顯示尺寸的話, 先去那支腳本把 CANDY_PX 調上去, 不然會糊。

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { SyncPairRole } from "@/lib/supabase/types";

export type CandyType =
  // 糖果 (0015)
  | "universal"
  | "strike"
  | "tech"
  | "support"
  | "sprint"
  | "field"
  | "superawakening"
  // 體系蛋糕捲與成長潛力券 (0064)
  | "cake_strike"
  | "cake_tech"
  | "cake_support"
  | "cake_sprint"
  | "cake_field"
  | "power_up";

/**
 * 背包的分組 —— 照 pomasters 背包分頁的分類 (2026-09-09 使用者指定抄那個版面)。
 *
 * 分組只影響**畫面**: 資料層仍然是同一張 member_candies (candy_type 的值域見 0064 的 check),
 * 所以總數、活動紀錄、compact 版都照舊吃 CANDY_TYPES 這一份攤平的清單。
 * 組內順序與角色糖一致 (攻擊/技術/輔助/速戰/場地), 五種蛋糕捲的顏色就是那五個角色。
 */
export const CANDY_GROUPS: { key: string; label: string; types: CandyType[] }[] = [
  {
    key: "candy",
    label: "糖果",
    types: ["universal", "strike", "tech", "support", "sprint", "field", "superawakening"],
  },
  {
    key: "role",
    label: "體系與潛力",
    types: ["cake_strike", "cake_tech", "cake_support", "cake_sprint", "cake_field", "power_up"],
  },
];

/** 攤平的全集 (總數、compact 版、活動紀錄的對照都吃這一份) */
export const CANDY_TYPES: CandyType[] = CANDY_GROUPS.flatMap((g) => g.types);

export const CANDY_LABELS: Record<CandyType, string> = {
  universal: "通用糖 (黃糖)",
  strike: "攻擊糖",
  tech: "技術糖",
  support: "輔助糖",
  sprint: "速戰糖",
  field: "場地糖",
  superawakening: "棒棒糖 (超覺醒)",
  // 名稱由使用者提供 (2026-09-09): 蛋糕捲依顏色區分, 顏色 → 角色的對應是從官方圖取樣的,
  // 與既有角色糖的配色完全一致 (紅 #ff2b4f 攻擊 / 綠 #05b294 技術 / 藍 #0096ea 輔助 /
  // 橙 #ef7a12 速戰 / 紫 #a72bee 場地)。
  cake_strike: "體系蛋糕捲 (紅)",
  cake_tech: "體系蛋糕捲 (綠)",
  cake_support: "體系蛋糕捲 (藍)",
  cake_sprint: "體系蛋糕捲 (橙)",
  cake_field: "體系蛋糕捲 (紫)",
  power_up: "5★ 成長潛力券",
};

/**
 * ⏸ **還欠一組**: 0036 那 5 種 (potential_cookie / potential_scroll / champion_spirit /
 * legendary_spirit / skill_feather) 的 check 約束 2026-08 就加了, 但到今天為止
 * **從來沒有出現在畫面上** —— 因為 public/reference/ui/candy/ 底下還沒有它們的圖。
 * 要上線就是: 找圖 → 放進 CANDY_GROUPS 的某一組 → 補 CANDY_LABELS。
 * 資料層不用再動 (0064 的 check 已經含這 5 種)。
 */

export function candyLabel(t: CandyType): string {
  return CANDY_LABELS[t];
}

/** 拍組角色 → 可吃的角色糖 (通用糖另計; 複合角色 multi 沒有專屬糖只吃通用) */
export function candyForRole(role: SyncPairRole | null): CandyType | null {
  if (role === null || role === "multi") return null;
  return role; // 其餘五種角色與角色糖同名 (strike/tech/support/sprint/field)
}

export function CandyIcon({
  type,
  size = 22,
  className,
}: {
  type: CandyType;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={`/reference/ui/candy/${type}.webp`}
      alt={CANDY_LABELS[type]}
      width={size}
      height={size}
      draggable={false}
      className={cn("inline-block select-none object-contain", className)}
    />
  );
}

/**
 * 遊戲內道具袋的金色圓盤底座 (`item_bg_gold`) —— 糖果圖疊在它上面就是背包裡那一格的長相。
 * 2026-09-09 使用者指定抄 pomasters 的背包分頁版面。
 *
 * 底座**只是裝飾**, 所以 aria-hidden 且不進無障礙樹; 真正的名稱在 CandyIcon 的 alt。
 * 數量 0 時整格淡化 (與對方的 `.noItem` 同一個做法) —— 一眼看得出哪些還沒有。
 */
export function CandyPlate({
  type,
  size = 56,
  dim = false,
  className,
}: {
  type: CandyType;
  size?: number;
  dim?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", dim && "opacity-40", className)}
      style={{ width: size, height: size }}
    >
      <img
        src="/reference/ui/item_plate.webp"
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        className="absolute inset-0 select-none object-contain"
      />
      <CandyIcon type={type} size={Math.round(size * 0.82)} className="relative" />
    </span>
  );
}

export type CandyCounts = Partial<Record<CandyType, number>>;

/**
 * 糖果庫存列。
 * 增減: hover 每顆糖時左右浮出 −/＋ 鈕 (桌機); 觸控裝置 (pointer-coarse)
 * 沒有 hover, −/＋ 常駐顯示。editable=false 時純顯示 (看別人的庫存)。
 */
export function CandyBar({
  counts,
  onChange,
  editable = true,
  compact = false,
  types = CANDY_TYPES,
}: {
  counts: CandyCounts;
  onChange?: (type: CandyType, next: number) => void;
  editable?: boolean;
  compact?: boolean;
  /** 只畫這幾種 (背包分組用)。不給就是全部 —— 看別人的庫存與 compact 版都吃全集。 */
  types?: CandyType[];
}) {
  const shown = compact ? types.filter((t) => (counts[t] ?? 0) > 0) : types;
  if (compact && shown.length === 0) return null;

  if (compact || !editable) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5",
          // 唯讀的完整庫存 (看別人的糖) 在手機也改成整寬一列, 才放得下名稱
          !compact && "max-sm:flex-col max-sm:items-stretch max-sm:gap-2"
        )}
      >
        {shown.map((t) => {
          const n = counts[t] ?? 0;
          return (
            <span
              key={t}
              title={`${CANDY_LABELS[t]}: ${n} 顆`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1",
                !compact && "max-sm:w-full max-sm:gap-2 max-sm:rounded-xl max-sm:px-2.5 max-sm:py-1.5",
                n === 0 && "opacity-45"
              )}
            >
              <CandyIcon type={t} size={compact ? 22 : 34} />
              {/* 手機沒有 hover, title 看不到 → 名稱直接寫出來 (桌機維持只有圖 + 數字) */}
              {!compact ? (
                <span className="min-w-0 flex-1 text-sm font-medium sm:hidden">
                  {CANDY_LABELS[t]}
                </span>
              ) : null}
              <span
                className={cn(
                  "tabular-nums font-semibold",
                  compact ? "text-xs" : "text-sm",
                  n === 0 && "text-muted-foreground"
                )}
              >
                {n}
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  const clamp = (n: number, delta: number) => Math.max(0, Math.min(999, n + delta));

  // 外層包一顆單純的 div: 呼叫端有人把 CandyBar 放在 space-y-* 容器裡,
  // 直接回傳 Fragment (兩個子節點) 會多長出一段間距。
  return (
    <div>
      {/* 手機: 每種糖各佔滿整列 (圖 + 繁中名稱 + −/數值/＋)。
          舊版是桌機那排小卡直接掉到手機 → 七張卡只用畫面左邊三分之一, 而且沒有名稱,
          只能靠圖案猜是哪一種糖 (桌機至少還有 hover title, 手機沒有 hover)。 */}
      <div className="flex flex-col gap-2 sm:hidden">
        {shown.map((t) => {
          const n = counts[t] ?? 0;
          const bump = (delta: number) => onChange?.(t, clamp(n, delta));
          return (
            <div
              key={t}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border bg-background py-1.5 pl-2.5 pr-1.5 transition-all",
                n > 0 ? "shadow-sm" : "opacity-60"
              )}
            >
              <CandyPlate type={t} size={48} dim={n === 0} className="shrink-0" />
              <span className="min-w-0 flex-1 text-sm font-medium leading-tight">
                {CANDY_LABELS[t]}
              </span>
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={n <= 0}
                aria-label={`${CANDY_LABELS[t]} -1`}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl font-bold leading-none text-muted-foreground transition-all",
                  "active:scale-90 disabled:opacity-30 motion-reduce:transition-none"
                )}
              >
                −
              </button>
              <span
                className={cn(
                  "w-10 shrink-0 text-center text-lg font-bold tabular-nums",
                  n === 0 && "text-muted-foreground"
                )}
              >
                {n}
              </span>
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={n >= 999}
                aria-label={`${CANDY_LABELS[t]} +1`}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl font-bold leading-none text-muted-foreground transition-all",
                  "active:scale-90 disabled:opacity-30 motion-reduce:transition-none"
                )}
              >
                ＋
              </button>
            </div>
          );
        })}
      </div>

      {/* 桌機: 維持原本的橫排小卡 (hover 才浮出 −/＋) */}
      <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
        {shown.map((t) => {
          const n = counts[t] ?? 0;
          const bump = (delta: number) => onChange?.(t, clamp(n, delta));
          return (
            <div
              key={t}
              title={`${CANDY_LABELS[t]}: ${n} 顆`}
              className={cn(
                "group/candy inline-flex items-center gap-1 rounded-xl border bg-background px-1.5 py-1.5 transition-all",
                n > 0 ? "shadow-sm" : "opacity-55 hover:opacity-100"
              )}
            >
              {/* − 鈕: 桌機 hover 才浮現, 觸控裝置常駐 */}
              <button
                type="button"
                onClick={() => bump(-1)}
                disabled={n <= 0}
                aria-label={`${CANDY_LABELS[t]} -1`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border pointer-coarse:h-11 pointer-coarse:w-11 text-base font-bold leading-none text-muted-foreground transition-all",
                  "hover:bg-destructive/10 hover:text-destructive active:scale-90 disabled:opacity-30",
                  "opacity-0 group-hover/candy:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
                )}
              >
                −
              </button>
              <span className="flex flex-col items-center px-0.5">
                <CandyPlate type={t} size={60} dim={n === 0} />
                <span
                  className={cn(
                    "tabular-nums text-lg font-bold leading-tight",
                    n === 0 && "text-muted-foreground"
                  )}
                >
                  {n}
                </span>
              </span>
              {/* ＋ 鈕 */}
              <button
                type="button"
                onClick={() => bump(1)}
                disabled={n >= 999}
                aria-label={`${CANDY_LABELS[t]} +1`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border pointer-coarse:h-11 pointer-coarse:w-11 text-base font-bold leading-none text-muted-foreground transition-all",
                  "hover:bg-emerald-500/10 hover:text-emerald-600 active:scale-90 disabled:opacity-30",
                  "opacity-0 group-hover/candy:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
                )}
              >
                ＋
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 自己的糖果庫存 (載入 + 樂觀更新), 給我的拍組頁用 */
export function useMyCandies(gymId: string | null, memberId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [counts, setCounts] = useState<CandyCounts | null>(null);

  const load = async () => {
    if (!memberId) return;
    const { data } = await supabase
      .from("member_candies")
      .select("candy_type, count")
      .eq("member_id", memberId);
    const m: CandyCounts = {};
    for (const r of data ?? []) m[r.candy_type as CandyType] = r.count;
    setCounts(m);
  };

  const change = (type: CandyType, next: number) => {
    if (!gymId || !memberId) return;
    setCounts((prev) => ({ ...(prev ?? {}), [type]: next }));
    void (async () => {
      const { error } = await supabase.from("member_candies").upsert(
        { gym_id: gymId, member_id: memberId, candy_type: type, count: next },
        { onConflict: "member_id,candy_type" }
      );
      if (error) toast.error("更新失敗", { description: error.message });
    })();
  };

  return { counts, load, change };
}
