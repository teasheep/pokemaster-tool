"use client";

// 變化紀錄清單 — 資料由 DB trigger 寫入 gym_activity; RLS 決定看得到誰的
// (管理員全館 / 一般成員只有自己)。這裡只做篩選與人話呈現。

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MemberAvatar,
  MemberOption,
  memberLabel,
  type MemberCardData,
} from "@/components/gym/member-card";
import { SyncPairCard } from "@/components/sync-pair-card";
import { createClient } from "@/lib/supabase/client";
import { CANDY_LABELS, CandyIcon, type CandyType } from "@/components/gym/candy";
import { GRADE_LABELS } from "@/lib/gym/types";
import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { cn } from "@/lib/utils";

type ActivityRow = {
  id: string;
  member_id: string | null;
  kind: string;
  target: string | null;
  target_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

type MemberLite = MemberCardData;

// 只記錄「成員身上發生的事」— 道館拍組名單/隊伍那類管理員設定動作已於 0030 停止記錄
const KIND_ORDER = ["pair", "candy", "ticket", "battle_log"] as const;

const KIND_LABELS: Record<string, string> = {
  pair: "拍組練度",
  candy: "糖果",
  ticket: "挑戰券",
  battle_log: "對戰紀錄",
};

const KIND_STYLES: Record<string, string> = {
  pair: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  candy: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ticket: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  battle_log: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

/** 寶數紀錄的值是 "grade" 或 "grade+覺N" → 卡片要用的數值 */
function parseGrade(v: string | null): { potential: number; awaken: number } | null {
  if (!v) return null;
  const [g, awakenPart] = v.split("+");
  const grade = Number(g);
  if (!Number.isFinite(grade)) return null;
  const awaken = awakenPart ? Number(awakenPart.replace(/\D/g, "")) || 0 : grade >= 6 ? 5 : 0;
  return { potential: grade >= 6 ? 5 : grade, awaken };
}

/** 寶數紀錄的值是 "grade" 或 "grade+覺N" — 轉人話 */
function gradeText(v: string | null): string {
  if (!v) return "";
  const [g, awaken] = v.split("+");
  const n = Number(g);
  const base = Number.isFinite(n) ? (GRADE_LABELS[n] ?? `寶${n}`) : v;
  return awaken ? `${base}(${awaken})` : base;
}

/**
 * 一列紀錄 → 卡片下方那句話。
 * 每種 kind 各自造句 — 以前共用一個「!new_value 就印紅字『移除』」的分支,
 * 結果「不再持有」「取消出戰」「糖果歸零」長得一模一樣, 看不懂在講什麼。
 */
function describe(a: ActivityRow): { target: string; from: string; to: string; gone: boolean } {
  switch (a.kind) {
    case "pair": {
      const gone = !a.new_value || a.new_value === "0";
      return {
        target: a.target ?? "",
        from: gradeText(a.old_value),
        to: gone ? "未持有" : gradeText(a.new_value),
        gone,
      };
    }
    case "candy":
      return {
        target: CANDY_LABELS[a.target as CandyType] ?? a.target ?? "",
        from: a.old_value ? `${a.old_value} 顆` : "",
        to: a.new_value ? `${a.new_value} 顆` : "0 顆",
        gone: false,
      };
    case "ticket":
      return {
        target: "挑戰券剩餘",
        from: a.old_value ? `${a.old_value} 張` : "",
        to: a.new_value ? `${a.new_value} 張` : "0 張",
        gone: false,
      };
    case "battle_log":
      return {
        target: a.target ?? "",
        from: "",
        to: a.new_value ? `使用 ${a.new_value} 張` : "紀錄已刪除",
        gone: !a.new_value,
      };
    default:
      return { target: a.target ?? "", from: a.old_value ?? "", to: a.new_value ?? "", gone: false };
  }
}

/**
 * 同一個人、同一個東西在短時間內連點多次 (寶0 一路點到超覺5 = 11 筆) 只留一列:
 * 起點取最舊的 old_value, 終點取最新的 new_value。
 */
const MERGE_WINDOW_MS = 30 * 60 * 1000;

function mergeRuns(rows: ActivityRow[]): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const r of rows) {
    // rows 是新到舊 — 找最後一筆同人同物, 時間夠近就併進去 (它比較新, 保留它的 new_value)
    const prev = out[out.length - 1];
    const sameThing =
      prev &&
      prev.member_id === r.member_id &&
      prev.kind === r.kind &&
      prev.target === r.target &&
      new Date(prev.created_at).getTime() - new Date(r.created_at).getTime() < MERGE_WINDOW_MS;
    if (sameThing) {
      out[out.length - 1] = { ...prev, old_value: r.old_value };
      continue;
    }
    out.push(r);
  }
  return out;
}

export function ActivityClient({
  gymId,
  isAdmin,
  myMemberId,
  members,
  catalog,
}: {
  gymId: string;
  isAdmin: boolean;
  myMemberId: string | null;
  members: MemberLite[];
  catalog: ClientPairRecord[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const pairById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberFilter, setMemberFilter] = useState<string>("all");
  // 預設只看練度 — 出戰/券數會隨每次回報洗版, 想看再切
  const [kindFilter, setKindFilter] = useState<string>("pair");
  const [limit, setLimit] = useState(100);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let q = supabase
        .from("gym_activity")
        .select("id, member_id, kind, target, target_id, old_value, new_value, created_at")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      if (kindFilter !== "all") q = q.eq("kind", kindFilter);
      else q = q.in("kind", [...KIND_ORDER]);
      const { data, error } = await q;
      if (!alive) return;
      if (error) toast.error("讀取紀錄失敗", { description: error.message });
      setRows(mergeRuns(data ?? []));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, gymId, memberFilter, kindFilter, limit]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Select value={memberFilter} onValueChange={setMemberFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="成員" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部成員</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <MemberOption member={m} />
                  {m.id === myMemberId ? (
                    <span className="ml-1 text-xs text-muted-foreground">(我)</span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {/* 類型用 chips (只有 4 種, 下拉多一次點擊) */}
        <div className="flex flex-wrap gap-1.5">
          {(["pair", "candy", "ticket", "battle_log", "all"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={cn(
                "rounded-full border px-3 text-sm transition-colors max-sm:min-h-11 sm:py-1",
                kindFilter === k
                  ? "border-primary font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {k === "all" ? "全部" : KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
          尚無紀錄 — 之後的拍組練度、糖果、挑戰券異動都會出現在這裡
        </div>
      ) : (
        <div className="space-y-3">
          {/* 圖片式紀錄牆 — 拍組用站內原本的卡片 (左下角就是寶數), 其餘類型用對應圖示 */}
          <div className="flex flex-wrap gap-2.5">
            {rows.map((a) => {
              const m = a.member_id ? memberById.get(a.member_id) : null;
              const d = describe(a);
              const pair = a.target_id ? pairById.get(a.target_id) : undefined;
              // 拍組: 卡片顯示變更後的狀態 (寶數/超覺醒直接呈現在卡片左下角)
              const after = a.kind === "pair" ? parseGrade(a.new_value) : null;
              const before = a.kind === "pair" ? parseGrade(a.old_value) : null;
              return (
                <div key={a.id} className="w-24">
                  {pair ? (
                    <SyncPairCard
                      pair={pair}
                      size="sm"
                      showName={false}
                      minimal
                      // 灰卡 = 變更後不持有 (與全站卡片語意一致)
                      owned={(after?.potential ?? 0) > 0 || (after?.awaken ?? 0) > 0}
                      awakenable={pair.hasAwakening}
                      potential={after?.potential ?? before?.potential ?? 0}
                      superAwakening={after?.awaken ?? 0}
                      className="w-24"
                    />
                  ) : (
                    <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border bg-card">
                      {a.kind === "candy" && a.target ? (
                        <CandyIcon type={a.target as CandyType} size={44} />
                      ) : (
                        <span className={cn("rounded px-2 py-1 text-xs", KIND_STYLES[a.kind])}>
                          {KIND_LABELS[a.kind] ?? a.kind}
                        </span>
                      )}
                      <span className="line-clamp-2 px-1 text-center text-[10px] leading-tight text-muted-foreground">
                        {d.target}
                      </span>
                    </div>
                  )}
                  {/* 變化: 寶幾 → 寶幾 (不再持有時只講「未持有」, 不用沒有主詞的「移除」) */}
                  <div className="mt-0.5 text-center text-[11px] font-medium tabular-nums leading-tight">
                    {d.from ? <span className="text-muted-foreground">{d.from}</span> : null}
                    {d.from && d.to ? <span className="mx-0.5">→</span> : null}
                    {d.to ? (
                      <span className={d.gone ? "text-muted-foreground" : undefined}>{d.to}</span>
                    ) : null}
                  </div>
                  {pair ? (
                    <div className="line-clamp-2 text-center text-[10px] leading-tight text-muted-foreground">
                      {pairName(pair)}
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                    {m ? (
                      <>
                        <MemberAvatar member={m} size="sm" className="h-4 w-4 text-[8px]" />
                        <span className="max-w-[5rem] truncate">{memberLabel(m)}</span>
                      </>
                    ) : (
                      <span>道館</span>
                    )}
                    <span className="tabular-nums">{fmt(a.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length >= limit ? (
            <Button variant="outline" onClick={() => setLimit((n) => n + 100)}>
              載入更多
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
