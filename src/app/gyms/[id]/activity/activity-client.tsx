"use client";

// 道館紀錄 — 資料由 DB trigger 寫入 gym_activity; RLS 決定看得到誰的
// (管理員全館 / 一般成員只有自己; 道館層級的列 member_id 是 null, 只有管理員看得到)。
// 這裡只做篩選、分組與人話呈現。
//
// **兩層**: 上面一列是「誰 改了 誰 的 什麼 · 幾件」, 點開才看得到每一張卡
// (2026-09-10 使用者:「看不出來是誰改誰的, 那個 UI 再優化一下, 或者要兩層也可以,
//  不需要一定把所有資訊攤平」)。攤平的時候整面牆都是卡, 而「這是誰改的」這個問題
// 反而完全看不出來 —— 操作者本來就記在 actor_id (0026), 只是以前沒撈也沒畫。
//
// 篩選 (人 / 類型 / 日期, 含自訂區間) **全部同步進網址** (AGENTS「決定畫面長什麼樣的
// client 狀態一律同步進網址」) —— 初始值由 page.tsx 從 searchParams 讀了傳下來,
// 這裡只負責寫。日期預設「近 30 天」而不是全部: 20 個人天天在改, 撈全部等於第一頁
// 就是這個月的洗版, 而且要往下按好幾次「載入更多」才看得到上個月。

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS as KIND_LABELS,
  ACTIVITY_LOGGED_KINDS,
  ACTIVITY_RANGES,
  ACTIVITY_RANGE_LABELS as RANGE_LABELS,
} from "./activity-filters";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

type ActivityRow = {
  id: string;
  member_id: string | null;
  actor_id: string | null;
  kind: string;
  target: string | null;
  target_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

/** 成員卡的資料 + auth 使用者 id (actor_id 記的是 auth.uid, 要靠它回查是誰) */
type MemberLite = MemberCardData & { userId?: string | null };

const KIND_STYLES: Record<string, string> = {
  pair: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  candy: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ticket: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  battle_log: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  gym_pair: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

/** 台北當地日期 (YYYY-MM-DD) 的起訖 → ISO; 查詢用 */
function dayStartIso(d: string): string {
  return `${d}T00:00:00+08:00`;
}
function dayEndIso(d: string): string {
  return `${d}T23:59:59.999+08:00`;
}

/** 幾天前的那一刻 (ISO) —— 給 PostgREST 的 gte 用 */
function sinceIso(days: string): string | null {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

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
 * (0030 停掉 gym_pair 的記錄, 理由就是它會畫成「在名單 → 移除」這種讀不懂的卡;
 *  0068 加回來時一起在這裡補了它自己的句子。)
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
        from: a.old_value ? `${a.old_value} 個` : "",
        to: a.new_value ? `${a.new_value} 個` : "0 個",
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
    case "gym_pair":
      return {
        target: a.target ?? "",
        from: "",
        to: a.new_value ? "設為道館拍組" : "取消道館拍組",
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

/**
 * 併完之後**起點與終點一樣** = 誤點了又馬上改回來, 預設不顯示
 * (2026-09-10 使用者:「有時候誤點然後馬上改回來… 好像就不需要顯示,
 *  或者要更詳細的資料再顯示就可以」)。
 * 資料**不會刪**, 只是收起來 —— 想查「他到底點了什麼」時按一下就攤開。
 */
function isNoop(r: ActivityRow): boolean {
  return (r.old_value ?? "") === (r.new_value ?? "");
}

type Group = {
  key: string;
  actorId: string | null;
  memberId: string | null;
  kind: string;
  at: string;
  items: ActivityRow[];
};

/**
 * 第一層: 把連續的「同一個人 · 改同一個人 · 同一類 · 30 分鐘內」收成一組。
 * 只看**相鄰**的列 (資料本來就是時間排序), 所以同一個人隔天再改會是另一組 —— 那是想要的。
 */
function groupRuns(rows: ActivityRow[]): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    const g = out[out.length - 1];
    const same =
      g &&
      g.actorId === r.actor_id &&
      g.memberId === r.member_id &&
      g.kind === r.kind &&
      new Date(g.at).getTime() - new Date(r.created_at).getTime() < MERGE_WINDOW_MS;
    if (same) {
      g.items.push(r);
      continue;
    }
    out.push({
      key: r.id,
      actorId: r.actor_id,
      memberId: r.member_id,
      kind: r.kind,
      at: r.created_at,
      items: [r],
    });
  }
  return out;
}

export function ActivityClient({
  gymId,
  isAdmin,
  myMemberId,
  members,
  catalog,
  initialMember = "all",
  initialKind = "pair",
  initialDays = "30",
  initialFrom = "",
  initialTo = "",
}: {
  gymId: string;
  isAdmin: boolean;
  myMemberId: string | null;
  members: MemberLite[];
  catalog: ClientPairRecord[];
  initialMember?: string;
  initialKind?: (typeof ACTIVITY_KINDS)[number];
  initialDays?: (typeof ACTIVITY_RANGES)[number];
  initialFrom?: string;
  initialTo?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const pairById = useMemo(() => new Map(catalog.map((p) => [p.pairId, p])), [catalog]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberFilter, setMemberFilter] = useState<string>(initialMember);
  // 預設只看練度 — 出戰/券數會隨每次回報洗版, 想看再切
  const [kindFilter, setKindFilter] = useState<string>(initialKind);
  const [days, setDays] = useState<string>(initialDays);
  const [from, setFrom] = useState<string>(initialFrom);
  const [to, setTo] = useState<string>(initialTo);
  const [limit, setLimit] = useState(100);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** 改了又改回來的那些要不要一起列出來 (預設不列, 見 isNoop) */
  const [showNoop, setShowNoop] = useState(false);

  // 預設值不寫進網址 (免得長出一串沒有意義的參數)
  useUrlState({
    member: memberFilter === "all" ? null : memberFilter,
    kind: kindFilter === "pair" ? null : kindFilter,
    days: days === "30" ? null : days,
    from: days === "custom" ? from || null : null,
    to: days === "custom" ? to || null : null,
  });

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  /** actor_id 是 auth.uid → 回查成員卡 (匯入的舊資料 actor 是 null) */
  const memberByUser = useMemo(
    () => new Map(members.filter((m) => m.userId).map((m) => [m.userId as string, m])),
    [members]
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      let q = supabase
        .from("gym_activity")
        .select(
          "id, member_id, actor_id, kind, target, target_id, old_value, new_value, created_at"
        )
        .eq("gym_id", gymId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      if (kindFilter !== "all") q = q.eq("kind", kindFilter);
      else q = q.in("kind", [...ACTIVITY_LOGGED_KINDS]);
      if (days === "custom") {
        // 自訂區間: 兩端都留白就等於不限, 只填一端就是單邊開放
        if (from) q = q.gte("created_at", dayStartIso(from));
        if (to) q = q.lte("created_at", dayEndIso(to));
      } else {
        const since = sinceIso(days);
        if (since) q = q.gte("created_at", since);
      }
      const { data, error } = await q;
      if (!alive) return;
      if (error) toast.error("讀取紀錄失敗", { description: error.message });
      setRows(mergeRuns(data ?? []));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, gymId, memberFilter, kindFilter, days, from, to, limit]);

  const noopCount = useMemo(() => rows.filter(isNoop).length, [rows]);
  const groups = useMemo(
    () => groupRuns(showNoop ? rows : rows.filter((r) => !isNoop(r))),
    [rows, showNoop]
  );

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 text-sm transition-colors max-sm:min-h-11 sm:py-1",
      active
        ? "border-primary font-medium shadow-sm"
        : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

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
        {/* 類型用 chips (只有幾種, 下拉多一次點擊) */}
        {/* 兩組各有一顆「全部」 → 給群組名, 不然讀螢幕的人只聽得到兩個「全部」 */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="紀錄類型">
          {ACTIVITY_KINDS.map((k) => (
            <button key={k} onClick={() => setKindFilter(k)} className={chip(kindFilter === k)}>
              {k === "all" ? "全部" : KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {/* 日期範圍 (2026-09-10 使用者要求)。做成 chips 與類型同一套長相 ——
            一整排比下拉少一次點擊, 而且看得出現在在看哪一段。
            「自訂」再往下長出兩個日期框 (只在選中時出現, 不然這一列會太長)。 */}
        <div className="flex flex-wrap gap-1.5 sm:ml-auto" role="group" aria-label="日期範圍">
          {ACTIVITY_RANGES.map((d) => (
            <button key={d} onClick={() => setDays(d)} className={chip(days === d)}>
              {RANGE_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {days === "custom" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">從</span>
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[9.5rem]"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">到</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="w-[9.5rem]"
            />
          </label>
          {from || to ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              清除日期
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">兩端留白 = 不限</span>
          )}
        </div>
      ) : null}

      {!loading && noopCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowNoop((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline pointer-coarse:min-h-11"
        >
          {showNoop
            ? `收起改了又改回來的 ${noopCount} 筆`
            : `另有 ${noopCount} 筆改了又改回來 — 顯示`}
        </button>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
          {days === "all"
            ? "尚無紀錄 — 之後的拍組練度、糖果、挑戰券、道館拍組異動都會出現在這裡"
            : `這段時間內沒有紀錄 — 換一段時間或按「全部」看看`}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const actor = g.actorId ? memberByUser.get(g.actorId) : null;
            const target = g.memberId ? memberById.get(g.memberId) : null;
            const self = Boolean(actor && target && actor.id === target.id);
            const open = openKey === g.key;
            return (
              <div key={g.key} className="overflow-hidden rounded-xl border bg-card">
                {/* 第一層: 誰 改了 誰 的 什麼 · 幾件 */}
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : g.key)}
                  aria-expanded={open}
                  // 給 QA 腳本抓的穩定 hook (aria-expanded 全站到處都有, 抓得到別的東西)
                  data-activity-group=""
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 max-sm:min-h-11"
                >
                  {actor ? (
                    <MemberAvatar member={actor} size="sm" className="h-6 w-6 text-[10px]" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border text-[10px] text-muted-foreground">
                      ?
                    </span>
                  )}
                  <span className="font-medium">{actor ? memberLabel(actor) : "匯入資料"}</span>
                  {/* 「誰改誰的」是這一頁最容易看不出來的事, 所以主詞受詞都寫清楚:
                      改自己的就寫「自己的」, 道館層級的就寫「道館的」。 */}
                  {g.memberId === null ? (
                    <span className="text-muted-foreground">更新了道館的</span>
                  ) : self ? (
                    <span className="text-muted-foreground">改了自己的</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">改了</span>
                      {target ? (
                        <MemberAvatar member={target} size="sm" className="h-6 w-6 text-[10px]" />
                      ) : null}
                      <span className="font-medium">
                        {target ? memberLabel(target) : "已退出的成員"}
                      </span>
                      <span className="text-muted-foreground">的</span>
                    </>
                  )}
                  <span
                    className={cn("rounded px-1.5 py-0.5 text-xs", KIND_STYLES[g.kind])}
                  >
                    {KIND_LABELS[g.kind] ?? g.kind}
                  </span>
                  <span className="text-xs text-muted-foreground">· {g.items.length} 件</span>
                  <span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    {fmt(g.at)}
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                    />
                  </span>
                </button>

                {/* 第二層: 這一組真的改了哪幾張 (拍組用站內原本的卡片, 其餘用對應圖示) */}
                {open ? (
                  <div className="flex flex-wrap justify-center gap-1 border-t bg-muted/20 px-3 py-2.5 sm:justify-start sm:gap-2.5">
                    {g.items.map((a) => {
                      const d = describe(a);
                      const pair = a.target_id ? pairById.get(a.target_id) : undefined;
                      // 拍組: 卡片顯示變更後的狀態 (寶數/超覺醒直接呈現在卡片左下角)
                      const after = a.kind === "pair" ? parseGrade(a.new_value) : null;
                      const before = a.kind === "pair" ? parseGrade(a.old_value) : null;
                      return (
                        <div key={a.id} className="w-[24%] max-w-24 sm:w-24">
                          {pair ? (
                            <SyncPairCard
                              pair={pair}
                              size="sm"
                              showName={false}
                              minimal
                              // 灰卡 = 變更後不持有 (與全站卡片語意一致);
                              // 道館拍組那種沒有寶數的紀錄一律亮卡
                              owned={
                                a.kind !== "pair" ||
                                (after?.potential ?? 0) > 0 ||
                                (after?.awaken ?? 0) > 0
                              }
                              awakenable={pair.hasAwakening}
                              potential={
                                a.kind === "pair"
                                  ? (after?.potential ?? before?.potential ?? 0)
                                  : undefined
                              }
                              superAwakening={after?.awaken ?? 0}
                              className="h-auto w-full"
                            />
                          ) : (
                            <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border bg-card">
                              {a.kind === "candy" && a.target ? (
                                <CandyIcon type={a.target as CandyType} size={44} />
                              ) : (
                                <span
                                  className={cn("rounded px-2 py-1 text-xs", KIND_STYLES[a.kind])}
                                >
                                  {KIND_LABELS[a.kind] ?? a.kind}
                                </span>
                              )}
                              <span className="line-clamp-2 px-1 text-center text-[10px] leading-tight text-muted-foreground">
                                {d.target}
                              </span>
                            </div>
                          )}
                          {/* 變化: 寶幾 → 寶幾 (不再持有時只講「未持有」, 不用沒有主詞的「移除」) */}
                          <div className="mt-0.5 text-center text-[11px] font-medium leading-tight tabular-nums">
                            {d.from ? <span className="text-muted-foreground">{d.from}</span> : null}
                            {d.from && d.to ? <span className="mx-0.5">→</span> : null}
                            {d.to ? (
                              <span className={d.gone ? "text-muted-foreground" : undefined}>
                                {d.to}
                              </span>
                            ) : null}
                          </div>
                          {pair ? (
                            <div className="line-clamp-2 text-center text-[10px] leading-tight text-muted-foreground">
                              {pairName(pair)}
                            </div>
                          ) : null}
                          <div className="mt-0.5 text-center text-[10px] tabular-nums text-muted-foreground">
                            {fmt(a.created_at)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
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
