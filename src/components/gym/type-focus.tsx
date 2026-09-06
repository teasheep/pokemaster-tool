"use client";

// 屬性資源方向 — 每位成員自己複選的兩組屬性 (0056):
//   want     想投入資源的屬性 (接下來想練的方向)
//   invested 已投入較多資源的屬性 (裝備 / 等級 / 潛能盤)
// 用途是「之後方便安排」: 排道館戰時看得出誰在練哪一路。
//
// 兩塊**不互斥** — 已經練得深、還想再練是常態, 不要做成單選或互相排除。
// 資料是「屬性的集合」不是數量, 所以沒有跟糖果共用 member_candies (理由見 0056 的註解)。
//
// 這裡的格子不是篩選 chips, 所以沒有共用 pair-filter-bar 的 `Chip`:
//   1. 形狀不同 — 這是固定 18 格的選擇盤 (grid, 每格等寬), 不是會換行的 inline chips;
//   2. 共用等於把整條 pair-filter-bar (Input/Button/lucide/filter 邏輯) 拉進 /resources 的 bundle。

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { TypeFocusGridSkeleton } from "@/components/skeletons";
import { TypeBadge, TypeIcon } from "@/components/sync-pair-badges";
import { ALL_TYPES, TYPE_COLORS, TYPE_LABELS } from "@/data/sync-pairs";
import { createClient } from "@/lib/supabase/client";
import type { SyncPairType } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export type TypeFocusKind = "want" | "invested";

/** 顯示順序 = 使用者指定的順序 (先「想投入」再「已投入較多」) */
export const TYPE_FOCUS_KINDS: TypeFocusKind[] = ["want", "invested"];

export const TYPE_FOCUS_LABELS: Record<TypeFocusKind, string> = {
  want: "想投入資源的屬性",
  invested: "已投入較多資源的屬性",
};

export const TYPE_FOCUS_HINTS: Record<TypeFocusKind, string> = {
  want: "接下來想把糖果這些資源花在哪 — 安排道館戰時看得到",
  invested: "裝備、等級、潛能盤已經練得比較深的屬性",
};

export type TypeFocus = Record<TypeFocusKind, SyncPairType[]>;

/** 每次都給新陣列 — 共用一份常數會被呼叫端不小心改到 */
export function emptyTypeFocus(): TypeFocus {
  return { want: [], invested: [] };
}

/** 一律照 ALL_TYPES (遊戲的 18 屬性順序) 排 — 點選的先後不該影響顯示順序 */
function sortTypes(list: SyncPairType[]): SyncPairType[] {
  return [...list].sort((a, b) => ALL_TYPES.indexOf(a) - ALL_TYPES.indexOf(b));
}

export function toggleType(list: SyncPairType[], t: SyncPairType): SyncPairType[] {
  return list.includes(t) ? list.filter((x) => x !== t) : sortTypes([...list, t]);
}

/**
 * 自己的屬性資源方向 (載入 + 樂觀更新)。
 * 寫入沒有 upsert: 這張表只有「有列 / 沒列」兩種狀態, 而 PostgREST 的 upsert 會走 UPDATE
 * (0056 刻意沒給 update 權限)。連點兩下造成的 23505 當成成功 — 結果與預期一致。
 */
export function useMyTypeFocus(gymId: string | null, memberId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [focus, setFocus] = useState<TypeFocus | null>(null);

  const load = async () => {
    if (!memberId) return;
    const { data } = await supabase
      .from("member_type_focus")
      .select("kind, type")
      .eq("member_id", memberId);
    const next = emptyTypeFocus();
    for (const r of data ?? []) {
      const kind = r.kind as TypeFocusKind;
      if (next[kind]) next[kind].push(r.type as SyncPairType);
    }
    for (const k of TYPE_FOCUS_KINDS) next[k] = sortTypes(next[k]);
    setFocus(next);
  };

  const toggle = (kind: TypeFocusKind, type: SyncPairType) => {
    if (!gymId || !memberId || !focus) return;
    const turningOn = !focus[kind].includes(type);
    const flip = () =>
      setFocus((prev) => (prev ? { ...prev, [kind]: toggleType(prev[kind], type) } : prev));

    flip();
    void (async () => {
      const { error } = turningOn
        ? await supabase
            .from("member_type_focus")
            .insert({ gym_id: gymId, member_id: memberId, kind, type })
        : await supabase
            .from("member_type_focus")
            .delete()
            .eq("member_id", memberId)
            .eq("kind", kind)
            .eq("type", type);
      if (error && error.code !== "23505") {
        toast.error("更新失敗", { description: error.message });
        // 只把這一格轉回去, 不還原整份快照 — 這期間別的格子可能也被按過
        flip();
      }
    })();
  };

  return { focus, load, toggle };
}

/** 18 格的其中一格 (min-h-11 = 觸控目標 44px) */
function TypeToggle({
  type,
  active,
  onClick,
}: {
  type: SyncPairType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border px-1 py-1.5",
        "text-xs transition-all active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
        active
          ? cn("border-primary font-semibold shadow-sm", TYPE_COLORS[type])
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <TypeIcon type={type} className="h-4 w-4" />
      <span className="whitespace-nowrap">{TYPE_LABELS[type]}</span>
    </button>
  );
}

/**
 * 一整塊 (標題 + 說明 + 18 格)。/resources 與道館的成員頁共用同一個元件,
 * 兩邊的文案與版面才不會各走各的。
 * selected = null 代表還在載入 → 畫同尺寸的骨架 (標題照樣在, 它不會變)。
 */
export function TypeFocusBlock({
  kind,
  selected,
  onToggle,
  editable = true,
  level = 2,
}: {
  kind: TypeFocusKind;
  selected: SyncPairType[] | null;
  onToggle?: (kind: TypeFocusKind, type: SyncPairType) => void;
  editable?: boolean;
  /** 標題層級 — /resources 底下是 h2, 道館成員頁在成員的 h2 底下所以是 h3 */
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Heading className="text-base font-semibold">{TYPE_FOCUS_LABELS[kind]}</Heading>
        {selected && selected.length > 0 ? (
          <span className="tabular-nums text-xs text-muted-foreground">
            已選 {selected.length}
          </span>
        ) : null}
      </div>
      <p className="mb-2.5 mt-0.5 text-xs text-muted-foreground sm:mb-3">
        {TYPE_FOCUS_HINTS[kind]}
      </p>
      {selected === null ? (
        <TypeFocusGridSkeleton />
      ) : editable ? (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-9">
          {ALL_TYPES.map((t) => (
            <TypeToggle
              key={t}
              type={t}
              active={selected.includes(t)}
              onClick={() => onToggle?.(kind, t)}
            />
          ))}
        </div>
      ) : selected.length === 0 ? (
        // 唯讀時只列選中的 — 18 格灰卡對「看別人」沒有資訊, 只是噪音
        <p className="text-sm text-muted-foreground">尚未選擇</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((t) => (
            <TypeBadge key={t} type={t} />
          ))}
        </div>
      )}
    </div>
  );
}
