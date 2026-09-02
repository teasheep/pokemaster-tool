"use client";

// 挑戰隊伍庫 — 隊伍屬於「道館」而不是某一關:
//   TeamLibrary  = 完整管理介面 (屬性 chips 切換 + 四分類分區 + 新增/編輯/刪除)
//                  /gyms/[id]/teams 頁直接用; 關卡的 TeamSheet 也是同一份
//   TeamSheet    = TeamLibrary 包在右側 slideover, 給關卡「選隊伍」用
//                  (defaultType = 該關弱點屬性排最前, 但可切到任何屬性選隊 —
//                   超能關選電系隊也是合法需求)

import { useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemberAvatar, memberLabel, type MemberCardData } from "@/components/gym/member-card";
import {
  PairPicker,
  useCatalogWithFullFallback,
  type PickedPair,
} from "@/components/gym/pair-picker";
import { pairName } from "@/lib/pairs/name";
import { SyncPairCard } from "@/components/sync-pair-card";
import { TypeIcon } from "@/components/sync-pair-badges";
import { ALL_TYPES, TYPE_LABELS } from "@/data/sync-pairs";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { TEAM_TAG_LABELS } from "@/lib/gym/types";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { Database, SyncPairType, TeamTag } from "@/lib/supabase/types";

// 只投影畫面真的會讀的欄位 — 呼叫端的 select 一律明列同一組 (select('*') 會白送
// gym_id 與兩個時間戳; gym_team_pairs 六十幾列就多 9KB)。加欄位時兩邊一起改。
export type TeamRow = Pick<
  Database["public"]["Tables"]["gym_teams"]["Row"],
  "id" | "type" | "name" | "tag" | "note" | "sort_order"
>;
export type TeamPairRow = Pick<
  Database["public"]["Tables"]["gym_team_pairs"]["Row"],
  "id" | "team_id" | "slot" | "pair_id" | "min_grade"
>;

/** 四個分類的順序與配色 (分區標題與徽章共用) */
export const TEAM_TAGS: TeamTag[] = ["debuff", "physical", "special", "closer"];

export const TAG_STYLES: Record<TeamTag, { chip: string; bar: string; ring: string }> = {
  debuff: {
    chip: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500",
    ring: "border-sky-500/60",
  },
  physical: {
    chip: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
    bar: "bg-orange-500",
    ring: "border-orange-500/60",
  },
  special: {
    chip: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
    bar: "bg-violet-500",
    ring: "border-violet-500/60",
  },
  closer: {
    chip: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
    ring: "border-emerald-500/60",
  },
};

export function TeamTagBadge({ tag, className }: { tag: TeamTag; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(TAG_STYLES[tag].chip, className)}>
      {TEAM_TAG_LABELS[tag]}
    </Badge>
  );
}

/** 隊伍的拍組卡 (唯讀展示; 卡片保持原比例不壓縮) */
export function TeamPairs({
  pairs,
  catalog,
  size = "sm",
}: {
  pairs: TeamPairRow[];
  catalog: ClientPairRecord[];
  size?: "sm" | "md";
}) {
  const byId = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  /** 名稱欄寬 = 卡片寬 (sm=96px / md=128px), 兩行才會剛好包住卡片 */
  const colWidth = size === "sm" ? "w-24" : "w-32";
  return (
    // 窄螢幕 (360px) 放不下 3 張卡 → 橫向捲動, 不裁掉第三隻
    <div className="flex gap-2 overflow-x-auto">
      {[...pairs]
        .sort((a, b) => a.slot - b.slot)
        .map((tp) => {
          const rec = byId.get(tp.pair_id);
          const awaken = tp.min_grade >= 6; // 6-10 = 超覺醒1-5
          if (!rec) {
            return (
              <div key={tp.id} className={cn("truncate text-[10px] text-muted-foreground max-sm:text-xs", colWidth)}>
                {tp.pair_id}
              </div>
            );
          }
          return (
            <div key={tp.id} className={cn("flex shrink-0 flex-col items-center gap-0.5", colWidth)}>
              {/* 道館端顯示一律原始星級 (只管持有/寶數, 不套個人 EX 練度) */}
              <SyncPairCard
                pair={rec}
                size={size}
                showName={false}
                minimal
                eager /* 隊伍庫整頁通常 <40 張; 延遲只會讓 SSR 的 HTML 不帶圖, 要等 hydration */
                potential={awaken ? 5 : tp.min_grade}
                superAwakening={awaken ? Math.min(5, tp.min_grade - 5) : 0}
                awakenable={rec.hasAwakening}
              />
              <span
                // 手機字級下限 12px (卡寬 96px = 每行 8 字, 兩行放得下最長的拍組名);
                // 桌機維持 10px 的密集標籤
                className={cn("line-clamp-2 h-[2.5em] text-center text-[10px] leading-tight text-muted-foreground max-sm:text-xs", colWidth)}
                title={pairName(rec)}
              >
                {pairName(rec)}
              </span>
            </div>
          );
        })}
    </div>
  );
}

/** 隊伍符合度三列: 綠=符合 黃=有拍組寶數不足 (candy=可吃糖補的顆數) 紅=缺拍組 */
export type TeamFitGroups = {
  green: { m: MemberCardData; candy?: number }[];
  yellow: { m: MemberCardData; candy?: number }[];
  red: { m: MemberCardData }[];
};

/**
 * 三列成員顯示 — 看板與選隊側板共用同一個長相 (純檢視, 不觸發派遣)。
 * 人數列常駐; 滑過 (桌機) 或點一下 (手機) 往下長出完整名單 — 版面不跳、有高度動畫。
 */
export function TeamFitRows({
  groups,
  tooltipOf,
}: {
  groups: TeamFitGroups;
  /** 逐拍組寶數明細 (hover) */
  tooltipOf?: (memberId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const rows = [
    { key: "green", dot: "bg-emerald-500", label: "符合", hint: "符合需求", list: groups.green },
    { key: "yellow", dot: "bg-amber-400", label: "寶數不足", hint: "有拍組, 寶數不足 (🍬 = 吃幾顆糖可補)", list: groups.yellow },
    { key: "red", dot: "bg-red-400", label: "缺拍組", hint: "缺拍組", list: groups.red },
  ] as const;
  const shown = rows.filter((r) => r.list.length > 0);
  if (shown.length === 0) return null;

  return (
    <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {/* 人數列不消失 — 展開只是往下長出名單 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="符合 / 寶數不足 / 缺拍組 — 展開看名單"
        className="flex items-center gap-3 rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:px-3"
      >
        {shown.map((r) => (
          <span key={r.key} title={r.hint} className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", r.dot)} />
            {r.list.length}
          </span>
        ))}
      </button>
      {/* 高度動畫: grid 0fr→1fr, auto 高度也能滑順展開 */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-1.5 pt-1.5">
            {shown.map((r) => (
              <div key={r.key} className="flex items-start gap-1.5">
                <span className="inline-flex w-16 shrink-0 items-center gap-1 pt-1.5 text-[11px] text-muted-foreground max-sm:text-xs">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", r.dot)} />
                  {r.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {r.list.map((entry) => {
                    const { m } = entry;
                    const candy = "candy" in entry ? entry.candy : undefined;
                    return (
                      <span
                        key={m.id}
                        title={`${memberLabel(m)} — ${r.hint}${
                          candy !== undefined ? `｜吃 ${candy} 顆糖可符合` : ""
                        }${tooltipOf ? `｜${tooltipOf(m.id)}` : ""}`}
                        className={cn(
                          "relative rounded-full",
                          r.key === "red" && "opacity-40 grayscale"
                        )}
                      >
                        <MemberAvatar member={m} size="sm" className="h-7 w-7" />
                        {candy !== undefined ? (
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 px-0.5 text-[8px] font-bold leading-tight text-amber-950 max-sm:text-[10px]">
                            🍬{candy}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export type TeamLibraryProps = {
  gymId: string;
  /** 預設聚焦的屬性 (該屬性排最前); 不給則從「全部」開始 */
  defaultType?: SyncPairType;
  isAdmin: boolean;
  teams: TeamRow[];
  teamPairs: TeamPairRow[];
  /**
   * 拍組圖鑑 — 頁面只送子集 (道館名單 ∪ 已在隊伍裡), 不是整本 645 筆。
   * 名單外的拍組靠 fullCatalogUrl 現抓。
   */
  catalog: ClientPairRecord[];
  /** 「全圖鑑」按需載入的網址 (`/api/catalog?v=<指紋>`); 不給則只能用 catalog 內的 */
  fullCatalogUrl?: string;
  /** 道館拍組名單 — 隊伍編輯的候選池 */
  gymPairs?: { pairId: string; type: SyncPairType }[];
  onChanged: () => Promise<void>;
  /** 綁定/取消綁定隊伍到關卡 (只有從關卡開啟時才有) */
  onToggle?: (team: TeamRow, next: boolean) => void | Promise<void>;
  /** 此關已綁的隊伍 */
  appliedTeamIds?: string[];
  /** teamId → 三列符合度 (從關卡開啟時才有) */
  teamFit?: Map<string, TeamFitGroups>;
};

export function TeamLibrary({
  gymId,
  defaultType,
  isAdmin,
  teams,
  teamPairs,
  catalog,
  fullCatalogUrl,
  gymPairs,
  onChanged,
  onToggle,
  appliedTeamIds = [],
  teamFit,
}: TeamLibraryProps) {
  const supabase = useMemo(() => createClient(), []);
  /**
   * 子集 + PairPicker 勾「全圖鑑」抓回來的整本 — 隊伍卡要用這份才畫得出名單外的拍組。
   * 少了這一步: 從全圖鑑選了一隻不在道館名單的拍組, 存檔後重抓 teamPairs,
   * 子集裡查不到 → 卡片掉成灰字 pair_id (使用者眼中就是「圖鑑未收錄」)。
   */
  // needed: 別人在這個分頁開著的時候從全圖鑑加了名單外的拍組 → 自動補抓一次整本
  const neededPairIds = useMemo(() => teamPairs.map((p) => p.pair_id), [teamPairs]);
  const mergedCatalog = useCatalogWithFullFallback(catalog, {
    ids: neededPairIds,
    fullCatalogUrl,
  });
  const [scope, setScope] = useState<SyncPairType | "all">(defaultType ?? "all");
  /** 正在原地編輯拍組的隊伍 — 卡片寬度不變, 內部長出搜尋區 (compact PairPicker) */
  const [openPairs, setOpenPairs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 儲存佇列 — 連點寶數會連發儲存, 不排隊會互相踩到 (unique 撞列) */
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const pairsOf = (teamId: string) =>
    teamPairs.filter((p) => p.team_id === teamId).sort((a, b) => a.slot - b.slot);
  const applied = new Set(appliedTeamIds);

  /**
   * 隊伍編輯候選池 = 整份道館拍組名單 (該屬性排最前, 跨屬主力如 96皮 也選得到 —
   * 格鬥關常用電系跨屬), 非全圖鑑; 圖鑑外的用面板「全圖鑑」解鎖
   */
  const allowedForDraft = useMemo(
    () => (gymPairs ? gymPairs.map((g) => g.pairId) : null),
    [gymPairs]
  );

  /** 屬性 chips: 預設屬性排最前, 其餘按固定順序 */
  const typeChips = useMemo(() => {
    const rest = ALL_TYPES.filter((t) => t !== defaultType);
    return defaultType ? [defaultType, ...rest] : rest;
  }, [defaultType]);

  const visibleTeams = scope === "all" ? teams : teams.filter((t) => t.type === scope);

  // ── 就地編輯: 每個欄位各自寫回, 不再有「編輯模式」與儲存鈕 ──

  async function patchTeam(teamId: string, patch: Partial<TeamRow>) {
    const { error } = await supabase.from("gym_teams").update(patch).eq("id", teamId);
    if (error) {
      toast.error("更新失敗", { description: error.message });
      return;
    }
    await onChanged();
  }

  /**
   * 三格拍組 = 依 slot upsert + 刪掉多出來的格子。
   * 用 upsert 而不是「整組刪掉再寫入」: 連點寶數 (寶5→超覺1→超覺2) 會連發兩次儲存,
   * delete/insert 交錯會撞 unique(team_id, slot) — upsert 天生冪等, 外加佇列保險。
   */
  function saveTeamPairs(teamId: string, picked: PickedPair[]) {
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        if (picked.length > 0) {
          const { error } = await supabase.from("gym_team_pairs").upsert(
            picked.map((p, i) => ({
              team_id: teamId,
              gym_id: gymId,
              slot: i + 1,
              pair_id: p.pairId,
              min_grade: p.minGrade,
            })),
            { onConflict: "team_id,slot" }
          );
          if (error) throw error;
        }
        const { error: delErr } = await supabase
          .from("gym_team_pairs")
          .delete()
          .eq("team_id", teamId)
          .gt("slot", picked.length);
        if (delErr) throw delErr;
        await onChanged();
      } catch (e) {
        toast.error("儲存拍組失敗", { description: e instanceof Error ? e.message : undefined });
      }
    });
    return saveQueue.current;
  }

  /** 新增 = 直接建一張空隊伍卡並展開拍組選擇 (不跳到另一個表單) */
  async function createTeam(tag: TeamTag) {
    const type = scope === "all" ? (defaultType ?? "normal") : scope;
    setBusy(true);
    const { data, error } = await supabase
      .from("gym_teams")
      .insert({
        gym_id: gymId,
        type,
        tag,
        name: `${TYPE_LABELS[type]}${TEAM_TAG_LABELS[tag]}隊`,
        sort_order: teams.filter((t) => t.type === type).length,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("新增失敗", { description: error?.message });
      return;
    }
    await onChanged();
    setOpenPairs(data.id);
  }

  async function remove(t: TeamRow) {
    const { error } = await supabase.from("gym_teams").delete().eq("id", t.id);
    if (error) toast.error("刪除失敗", { description: error.message });
    else {
      toast.success("已刪除隊伍");
      await onChanged();
    }
  }

  return (
    <div className="space-y-3">
      {/* 屬性切換 chips — 本關屬性排最前, 也能切到其他屬性或全部。
          手機: 7 欄方格 (每格 ≥44px 的正方形), 20 個屬性 3 排全部看得到, 不用橫捲也不用縮成 26px 的小點;
          桌機: 維持一列一列自動換行的 icon + 屬性名 */}
      <div className="grid grid-cols-7 gap-1.5 sm:flex sm:flex-wrap sm:gap-1">
        <button
          onClick={() => setScope("all")}
          className={cn(
            "inline-flex min-h-11 items-center justify-center rounded-full border px-1 text-xs transition-all active:scale-95",
            "sm:min-h-0 sm:px-2.5 sm:py-1",
            scope === "all"
              ? "border-primary bg-accent font-medium shadow-sm"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          全部
        </button>
        {typeChips.map((t) => (
          <button
            key={t}
            onClick={() => setScope(t)}
            title={TYPE_LABELS[t]}
            aria-label={TYPE_LABELS[t]}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-1 rounded-full border px-1 text-xs transition-all active:scale-95",
              "sm:min-h-0 sm:px-2 sm:py-1",
              scope === t
                ? "border-primary bg-accent font-medium shadow-sm"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <TypeIcon type={t} className="h-6 w-6 sm:h-4 sm:w-4" />
            <span className="max-sm:hidden">{TYPE_LABELS[t]}</span>
          </button>
        ))}
      </div>

      {TEAM_TAGS.map((tag) => {
        const list = visibleTeams
          .filter((t) => t.tag === tag)
          .sort(
            (a, b) =>
              ALL_TYPES.indexOf(a.type) - ALL_TYPES.indexOf(b.type) || a.sort_order - b.sort_order
          );
        if (list.length === 0 && !isAdmin) return null;
        return (
          <section key={tag}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cn("h-4 w-1 rounded-full", TAG_STYLES[tag].bar)} />
              <span className="text-sm font-semibold">{TEAM_TAG_LABELS[tag]}</span>
              {/* 手機一次只看得到一兩張卡 — 標題就先講清楚這一區有幾套 */}
              {list.length > 0 ? (
                <span className="tabular-nums text-xs text-muted-foreground">{list.length} 套</span>
              ) : null}
              {isAdmin ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  onClick={() => void createTeam(tag)}
                  disabled={busy}
                >
                  <Plus className="mr-0.5 h-3.5 w-3.5" />
                  新增
                </Button>
              ) : null}
            </div>

            {list.length === 0 ? (
              <p className="pl-3 text-xs text-muted-foreground/70">還沒有這類隊伍</p>
            ) : (
              // auto-fill 等寬欄: 塞得下幾欄就幾欄、每列等寬對齊 —
              // 側板 (536px) 剛好一欄滿版, 寬頁面自動多欄, 不會有 ragged 右緣
              <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2">
                {list.map((t) => {
                  const isOn = applied.has(t.id);
                  const editingPairs = openPairs === t.id;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-xl border-2 p-2.5 transition-all",
                        isOn ? TAG_STYLES[tag].ring : "border-border"
                      )}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <TypeIcon type={t.type} className="h-4 w-4 shrink-0" />
                        {isAdmin ? (
                          // 名稱就地改 (離開輸入框存檔) — 不用先按編輯鈕
                          <input
                            key={`${t.id}-${t.name}`}
                            defaultValue={t.name}
                            maxLength={30}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== t.name) void patchTeam(t.id, { name: v });
                            }}
                            // 手機一律 16px + 44px 高: 小於 16px 的輸入框在 iOS 聚焦時會整頁放大
                            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium outline-none transition-colors hover:border-border focus:border-primary focus:bg-background max-sm:min-h-11 max-sm:text-base"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                        )}
                        {isOn ? (
                          <Badge variant="outline" className="gap-0.5 text-[10px] max-sm:text-xs">
                            <Check className="h-3 w-3" />
                            本關使用中
                          </Badge>
                        ) : null}
                        {onToggle ? (
                          <Button
                            size="sm"
                            variant={isOn ? "outline" : "default"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => void onToggle(t, !isOn)}
                          >
                            {isOn ? "移除" : "加入本關"}
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => void remove(t)}
                            title="刪除這套隊伍"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>

                      {/* 拍組: 點一下原地變成編輯器 — 卡片寬度不變 (328px), 只往下長出搜尋區 */}
                      {editingPairs ? (
                        <div className="space-y-2">
                          <PairPicker
                            compact
                            slots={3}
                            picked={pairsOf(t.id).map((p) => ({
                              pairId: p.pair_id,
                              minGrade: p.min_grade,
                            }))}
                            catalog={mergedCatalog}
                            fullCatalogUrl={fullCatalogUrl}
                            filterType={t.type}
                            allowedPairIds={allowedForDraft}
                            onChange={(picked) => void saveTeamPairs(t.id, picked)}
                          />
                          <Button
                            size="sm"
                            className="max-sm:w-full"
                            onClick={() => setOpenPairs(null)}
                          >
                            完成
                          </Button>
                        </div>
                      ) : (
                        // 拍組在左、資訊欄 (可打/說明) 填右側 — 窄卡自動換行回到下方
                        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                          <button
                            type="button"
                            onClick={isAdmin ? () => setOpenPairs(t.id) : undefined}
                            className={cn(
                              // 手機: 整條佔滿卡片寬 (三張卡本來就在裡面橫捲), 拇指按哪裡都算
                              "shrink-0 rounded-lg text-left max-sm:w-full",
                              isAdmin && "transition-colors hover:bg-accent/40"
                            )}
                            title={isAdmin ? "點一下換拍組" : undefined}
                          >
                            {pairsOf(t.id).length > 0 ? (
                              <TeamPairs pairs={pairsOf(t.id)} catalog={mergedCatalog} />
                            ) : (
                              <span className="block px-6 py-3 text-center text-xs text-muted-foreground max-sm:min-h-11 max-sm:py-3.5 max-sm:text-sm">
                                {isAdmin ? "點一下選拍組" : "還沒選拍組"}
                              </span>
                            )}
                          </button>

                          <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5 py-0.5">
                            {/* 誰有誰沒有 — 與看板同一個三列元件 (只看符合度, 不看票) */}
                            {teamFit?.has(t.id) ? (
                              <TeamFitRows groups={teamFit.get(t.id)!} />
                            ) : null}

                            {/* 說明: 打法提醒 (卡片上的寶石已經表達要寶幾, 不需要另外標) */}
                            {isAdmin ? (
                              <input
                                key={`${t.id}-note-${t.note ?? ""}`}
                                defaultValue={t.note ?? ""}
                                maxLength={120}
                                placeholder="＋ 說明 (例: 先降抗再開場地)"
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v !== t.note) void patchTeam(t.id, { note: v });
                                }}
                                // 手機 16px (iOS 聚焦不放大) + 44px 高
                                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:border-border focus:border-primary focus:bg-background focus:text-foreground max-sm:min-h-11 max-sm:text-base"
                              />
                            ) : t.note ? (
                              <p className="px-1 text-xs text-muted-foreground">{t.note}</p>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 關卡用的 slideover 外殼 — 內容就是 TeamLibrary */
export function TeamSheet({
  open,
  onOpenChange,
  ...props
}: TeamLibraryProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* 手機把 20px 內距收成 12px — 隊伍卡裡的三張拍組卡 (96px×3) 才不會被擠到要橫捲 */}
      <SheetContent className="max-w-xl max-sm:p-3">
        <SheetHeader>
          <SheetTitle>挑戰隊伍</SheetTitle>
        </SheetHeader>
        <TeamLibrary {...props} />
      </SheetContent>
    </Sheet>
  );
}
