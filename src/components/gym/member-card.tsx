"use client";

// 成員頭像與卡片 — 道館戰看板「認人」用。
// 頭像 = 個人設定上傳的頭貼 (Supabase Storage); 沒設頭貼退回文字縮寫
// (名字 hash 出固定色相)。舊制「代表拍組頭像」已隨 avatar_pair_id 欄位移除 (0047)。

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TypeIcon } from "@/components/sync-pair-badges";
import type { SyncPairType } from "@/lib/supabase/types";

export type MemberCardData = {
  id: string;
  displayName: string;
  lineName?: string | null;
  availability?: string | null;
  role?: string;
  bound?: boolean;
  /** 上傳頭貼 — Supabase Storage 公開網址 */
  avatarUrl?: string | null;
  /**
   * 頭像圓圈裡的自訂文字 (最多 3 個字)。沒設就從社群名取字。
   * 2026-09-09 成員的意見:「圓圈醒目文字可以替每一位會友選定特別的文字, 看到圈圈
   * 就可以馬上知道是哪一位會友」—— 有頭貼的人不受影響 (圖優先)。
   */
  badgeText?: string | null;
};

// 手機的縮寫字放大到 12px (10-11px 在手機上根本認不出是哪個字)
const SIZES = {
  sm: "h-8 w-8 text-[11px] max-sm:text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
};

/**
 * 全站統一的成員顯示名: **社群名(遊戲名)** — 兩名不同才加括號。
 *
 * 社群名在前是 2026-09-09 成員的意見:「大家比較習慣用 LINE 社群名字稱呼彼此」——
 * 括號裡那個是用來對上遊戲內帳號的, 平常認人靠的是前面那個。
 * 沒填社群名的人維持只顯示遊戲名 (不要變成「(遊戲名)」那種空括號)。
 */
export function memberLabel(m: { displayName: string; lineName?: string | null }): string {
  return m.lineName && m.lineName !== m.displayName
    ? `${m.lineName}(${m.displayName})`
    : m.displayName;
}

/** 認人優先的那個名字 (頭像縮寫、排序、搜尋都用它) */
export function memberCallName(m: { displayName: string; lineName?: string | null }): string {
  return m.lineName?.trim() || m.displayName;
}

/** 沒設頭像時的底色 — 從名字 hash 出固定色相, 每個人顏色不同才好認 */
function nameHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/**
 * 頭像縮寫: 一眼認人優先。
 * 中文名取第一個字 (兩個字在小圓裡會被擠成上下排看不清);
 * 英文名取前兩個字母。
 * **吃的是「大家怎麼叫他」那個名字 (社群名優先)**, 與 memberLabel 同一個判斷。
 */
function avatarInitial(name: string): string {
  const first = [...name][0] ?? "?";
  if (/[a-z0-9]/i.test(first)) return name.slice(0, 2);
  return first;
}

/** 圓圈裡要顯示什麼: 自訂文字 > 社群名/遊戲名的縮寫 */
export function avatarText(m: MemberCardData): string {
  const custom = m.badgeText?.trim();
  if (custom) return custom;
  return avatarInitial(memberCallName(m));
}

export function MemberAvatar({
  member,
  size = "md",
  className,
}: {
  member: MemberCardData;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const hasImage = !!member.avatarUrl;
  const hue = nameHue(member.displayName);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold leading-none",
        hasImage ? "border bg-muted" : "whitespace-nowrap text-white",
        SIZES[size],
        className
      )}
      style={
        hasImage
          ? undefined
          : {
              // 同色系深淺雙色: 底色 + 深一階的環, 沒頭貼也有辨識度
              backgroundColor: `hsl(${hue} 52% 52%)`,
              boxShadow: `inset 0 0 0 2px hsl(${hue} 55% 40%)`,
              textShadow: "0 1px 2px rgb(0 0 0 / 35%)",
            }
      }
      title={memberLabel(member)}
    >
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatarUrl}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        avatarText(member)
      )}
    </span>
  );
}

/**
 * 下拉選單裡的成員選項 — 全站統一: 頭像 + 遊戲名 + 社群名 (與遊戲名相同則省略)。
 * 任何列出成員的 Select 都用這個, 不要只印名字。
 */
export function MemberOption({ member }: { member: MemberCardData }) {
  const showLine = member.lineName && member.lineName !== member.displayName;
  return (
    <span className="flex items-center gap-2">
      {/* 手機放大到 28px (AGENTS: 密集列的下限就是 28px, 20px 只在桌機留著) */}
      <MemberAvatar
        member={member}
        size="sm"
        className="h-5 w-5 text-[9px] max-sm:h-7 max-sm:w-7 max-sm:text-xs"
      />
      <span className="truncate">{memberCallName(member)}</span>
      {showLine ? (
        <span className="truncate text-xs text-muted-foreground">({member.displayName})</span>
      ) : null}
    </span>
  );
}

/** 一行式成員晶片 (派遣名單、持有名單用) */
export function MemberChip({
  member,
  right,
  onClick,
  className,
}: {
  member: MemberCardData;
  right?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={memberLabel(member)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pl-0.5 pr-2 text-xs shadow-sm transition-all",
        // 可點的晶片在觸控裝置補一塊隱形的 44px 命中區 (與 ui/button 同一套做法):
        // 晶片本體只有 32px 高, 直接長高會把整排名單撐開, 所以只擴命中區不動視覺
        onClick &&
          "relative hover:border-primary/50 hover:bg-accent active:scale-95 pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-full pointer-coarse:before:min-h-11 pointer-coarse:before:min-w-11 pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']",
        className
      )}
    >
      <MemberAvatar member={member} size="sm" className="h-7 w-7" />
      <span className="max-w-40 truncate font-medium">{memberLabel(member)}</span>
      {right}
    </Tag>
  );
}

/** 成員卡片 (成員表用): 頭像 + 名稱 + LINE 名 + 時段 + 附加內容 */
export function MemberCard({
  member,
  selected,
  onClick,
  footer,
  strongTypes,
  me,
}: {
  member: MemberCardData;
  selected?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
  /** 這一列是自己 —— 名字後面標「（我）」。**不要把它接進 displayName**:
      那樣括號裡的遊戲名會變成「Eric（我）」, 而那不是他的遊戲名 */
  me?: boolean;
  /** 擅長屬性 (顯示 icon 列, 一眼看出這位成員能挑戰哪些關) */
  strongTypes?: SyncPairType[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent/50",
        selected && "border-primary/60 bg-accent"
      )}
    >
      <MemberAvatar member={member} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1">
          <span className="truncate font-semibold">
            {memberCallName(member)}
            {me ? "（我）" : ""}
          </span>
          {member.lineName && member.lineName !== member.displayName ? (
            <span className="truncate text-sm text-muted-foreground">({member.displayName})</span>
          ) : null}
          {member.role === "admin" ? (
            <Badge variant="outline" className="px-1 text-[10px] max-sm:text-xs">
              管理
            </Badge>
          ) : null}
          {member.bound === false ? (
            <Badge variant="outline" className="px-1 text-[10px] text-muted-foreground max-sm:text-xs">
              未綁定
            </Badge>
          ) : null}
        </span>
        {member.availability ? (
          <span className="block truncate text-[11px] text-muted-foreground max-sm:text-xs">
            🕐 {member.availability}
          </span>
        ) : null}
        {strongTypes && strongTypes.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-0.5">
            {strongTypes.slice(0, 8).map((t) => (
              <TypeIcon key={t} type={t} className="h-4 w-4" />
            ))}
          </span>
        ) : null}
        {footer}
      </span>
    </button>
  );
}
