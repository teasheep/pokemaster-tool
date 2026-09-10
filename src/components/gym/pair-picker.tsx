"use client";

// 標準拍組選擇器 — 全站選拍組都用這個。
// 設計原則: 不靠說明文字, 操作自明
//   空位 = 大加號虛線框, 一看就知道可以點
//   已選 = 大張拍組卡, 名字在下方; 左下寶數 hex 可點 +1 (全站標準), 卡下 GradeChip 同功能
//   搜尋 = 開一次面板連選到滿 (點卡加入, 再點取消) — 不用選一隻關一次
//   候選池 = 呼叫端可限縮 (隊伍編輯: 該屬性道館拍組 + 通用輔助), 「全圖鑑」可解鎖
//   全圖鑑 = 勾了才去抓 (建置時產生的靜態資產) — 645 筆整包沒必要每次導覽都跟著頁面重送

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GRADE_LABELS } from "@/lib/gym/types";
import { Sk } from "@/components/skeletons";
import { SyncPairCard } from "@/components/sync-pair-card";
import { TypeIcon } from "@/components/sync-pair-badges";
import { CATALOG_ASSET_PATH } from "@/data/catalog-version";
import { ALL_TYPES, TYPE_LABELS } from "@/data/sync-pairs";
import { cn } from "@/lib/utils";
import { pairComparator, pairName } from "@/lib/pairs/name";
import { pairHaystack } from "@/lib/pairs/filter";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

// ── 全圖鑑 (645 筆) 的 module 級快取 ──
// 頁面平常只送子集 (道館名單 ∪ 已在隊伍裡), 整本等使用者勾「全圖鑑」才抓,
// 同一個分頁裡不管開幾次面板、幾張隊伍卡都只抓一次。
// 網址帶 catalog 指紋, 所以 force-cache 命中的一定是當前這份資料。
//
// 抓回來的東西放成一個小 store 而不是一路往上傳 callback: 「畫得出拍組卡」的
// 地方 (隊伍卡、看板關卡卡) 隔了 TeamSheet/StageCard 好幾層 props, 而它們
// 都必須看得到 —— 從全圖鑑選了名單外的拍組, 沒同步過去那張卡就會掉成灰字 pair_id。
//
// **抓哪裡**: 先抓靜態資產 CATALOG_ASSET_PATH (`/catalog/<指紋>.json`, 建置時由
// scripts/emit-client-catalog.mjs 產)。線上它由 Cloudflare Workers Assets 直接供應,
// 我們的 Worker 完全不執行 = 0 CPU (舊的 /api/catalog 路由每次要 45-65ms, 免費方案上限 10ms)。
// 抓不到才退到呼叫端給的 fullCatalogUrl (`/api/catalog?v=…`) —— dev 沒跑過 prebuild、
// 資產漏部署、指紋與檔案不同步時, 面板都不能變成空的 (點名過的前科)。

let fullCatalogCache: Promise<ClientPairRecord[]> | null = null;
/** 已抓回來的整本 (null = 還沒抓); getSnapshot 要回穩定參考, 所以存在 module 變數 */
let fullCatalogRecords: ClientPairRecord[] | null = null;
const fullCatalogListeners = new Set<() => void>();

async function fetchCatalog(url: string): Promise<ClientPairRecord[]> {
  const res = await fetch(url, { cache: "force-cache" });
  // 先看狀態 (資產漏部署 = 404, 要能講出是 404 而不是猜成登入問題)
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // session 過期時 middleware 會 307 導去 /login, 而 fetch 預設 follow →
  // 拿到的是登入頁的 HTML 且狀態 200, res.ok 擋不住, 直接 json() 會丟出瀏覽器的英文
  // SyntaxError 給使用者看。先擋掉重導與非 JSON 回應。
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("登入已過期, 請重新整理頁面");
  }
  const json = (await res.json()) as { records?: ClientPairRecord[] };
  if (!Array.isArray(json.records)) throw new Error("回應格式不對");
  return json.records;
}

/** 整本圖鑑: 靜態資產優先, 失敗才退到路由版 (fallbackUrl 沒給就只有靜態這條) */
function loadFullCatalog(fallbackUrl?: string): Promise<ClientPairRecord[]> {
  if (!fullCatalogCache) {
    fullCatalogCache = fetchCatalog(CATALOG_ASSET_PATH)
      .catch((e: unknown) => {
        if (!fallbackUrl) throw e;
        return fetchCatalog(fallbackUrl);
      })
      .then((records) => {
        fullCatalogRecords = records;
        for (const notify of fullCatalogListeners) notify();
        return records;
      })
      .catch((e: unknown) => {
        // 失敗不留下壞掉的 promise, 下次勾選可以重試
        fullCatalogCache = null;
        throw e;
      });
  }
  return fullCatalogCache;
}

function subscribeFullCatalog(onChange: () => void) {
  fullCatalogListeners.add(onChange);
  return () => {
    fullCatalogListeners.delete(onChange);
  };
}

/** 已抓回來的整本; 還沒抓 = null (SSR 一律 null) */
export function useLoadedFullCatalog(): ClientPairRecord[] | null {
  return useSyncExternalStore(
    subscribeFullCatalog,
    () => fullCatalogRecords,
    () => null
  );
}

/**
 * 子集 + 已抓回來的整本 (後者只補前者沒有的) — 拍組卡與媒合表的查表一律用這份,
 * 才不會出現「隊伍裡的卡變成圖鑑未收錄的灰字卡」。
 */
/**
 * 子集 + (抓過的話) 整本。
 *
 * `needed` 給了就多一件事: 子集裡查不到的 pairId 會**自動去抓整本一次**。
 * 為什麼需要 — 頁面送的子集是 SSR 當下的「道館名單 ∪ 已在隊伍裡」, 但別人可能在那之後
 * 從「全圖鑑」把名單外的拍組加進某隊, client 端 refetch 拿到新的 gym_team_pairs 之後,
 * 這個瀏覽器的子集查不到它 → 隊伍卡掉成灰字 pair_id。抓一次整本就補齊 (module 快取,
 * 同分頁只會抓一次; 抓失敗就維持原本的退路, 不會壞頁)。
 */
export function useCatalogWithFullFallback(
  catalog: ClientPairRecord[],
  needed?: { ids: Iterable<string>; fullCatalogUrl?: string }
): ClientPairRecord[] {
  const loaded = useLoadedFullCatalog();
  const merged = useMemo(() => {
    if (!loaded) return catalog;
    const have = new Set(catalog.map((p) => p.pairId));
    return [...catalog, ...loaded.filter((p) => !have.has(p.pairId))];
  }, [catalog, loaded]);

  // 整本的位置是建置時的常數 (CATALOG_ASSET_PATH), 所以這裡只把呼叫端的
  // fullCatalogUrl 當「靜態資產抓不到時的退路」, 不再拿它當「能不能抓」的開關。
  const url = needed?.fullCatalogUrl;
  // 有缺才抓 — 依賴用「缺不缺」的布林而不是 ids 本身, 免得每次 render 都重跑 effect
  const hasMissing = useMemo(() => {
    if (!needed) return false;
    const have = new Set(merged.map((p) => p.pairId));
    for (const id of needed.ids) if (id && !have.has(id)) return true;
    return false;
  }, [merged, needed]);

  useEffect(() => {
    if (!hasMissing) return;
    void loadFullCatalog(url).catch(() => {
      // 抓不到就維持現況 (隊伍卡顯示 pair_id) — 這裡沒有使用者主動操作, 不彈 toast
    });
  }, [hasMissing, url]);

  return merged;
}

export type PickedPair = {
  pairId: string;
  /** 要求練度 1-5=寶1-5, 6-10=超覺醒1-5 (與 member_pairs.grade 同一條軸) */
  minGrade: number;
};

/** 練度循環: 寶1→寶5 →(可超覺醒) 超覺醒1→超覺醒5 → 回寶1 */
export function cycleGrade(current: number, awakenable: boolean): number {
  if (current >= 10) return 1;
  if (current >= 5 && current < 6) return awakenable ? 6 : 1;
  return current + 1;
}

/**
 * 要求練度的下拉 —— **直接選, 不要只能循環**。
 * (2026-09-10 使用者:「隊伍庫的設定隊伍拍組的寶數很難按, 有時候要點很多下, 操作不直觀」)
 * 循環只有「+1」一個方向, 從超覺醒5 退回寶3 要點八下, 而唯一的把手是卡片左下角那顆
 * 30px 的六角 —— 站上其他地方會這樣點是因為**旁邊就有側板下拉**當第二條路, 隊伍這裡沒有。
 * 卡片左下角的循環照舊留著 (與全站手勢一致), 這個下拉是給「我就是要寶3」的人用的。
 */
export function GradeSelect({
  grade,
  awakenable,
  onChange,
  className,
}: {
  grade: number;
  awakenable: boolean;
  onChange: (next: number) => void;
  className?: string;
}) {
  // 需求一定是「至少寶1」—— 0 (無持有) 當需求沒有意義, 所以選單從 1 開始
  const options = GRADE_LABELS.map((label, i) => ({ value: i, label })).filter(
    (o) => o.value >= 1 && (awakenable || o.value <= 5)
  );
  return (
    <Select value={String(grade)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger
        className={cn("h-7 w-full px-2 text-xs pointer-coarse:min-h-11", className)}
        aria-label="要求練度"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 要求寶數徽章 — 唯讀顯示用 (看板/隊伍卡); 可編輯的地方一律用 GradeSelect */
export function GradeChip({
  grade,
  onClick,
  className,
}: {
  grade: number;
  onClick?: () => void;
  className?: string;
}) {
  const isAwaken = grade >= 6;
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={onClick ? "點一下提高要求 (寶1→5→超覺醒1→5)" : undefined}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-all",
        isAwaken
          ? "bg-sky-500/20 text-sky-700 dark:text-sky-300"
          : grade >= 5
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "bg-muted text-foreground/80",
        onClick && "hover:brightness-110 active:scale-95",
        className
      )}
    >
      {isAwaken ? `超覺醒${Math.min(5, grade - 5)}` : `寶${grade}`}
    </Tag>
  );
}

export function PairPicker({
  slots,
  picked,
  catalog,
  filterType,
  onChange,
  readOnly,
  allowedPairIds,
  compact,
  fullCatalogUrl,
}: {
  slots: number;
  picked: PickedPair[];
  /** 候選池與槽位卡的資料來源; 呼叫端只給子集時要一併給 fullCatalogUrl */
  catalog: ClientPairRecord[];
  /** 搜尋預設只列此屬性 (無 allowedPairIds 限縮時) */
  filterType?: SyncPairType;
  onChange: (next: PickedPair[]) => void;
  readOnly?: boolean;
  /** 候選池限縮 (隊伍編輯 = 整份道館拍組名單, 該屬性排最前); null/undefined = 全圖鑑 */
  allowedPairIds?: string[] | null;
  /** 窄版 (328px 隊伍卡內原地編輯): 槽位/結果都用 sm 卡三欄, 寬度不變只長高 */
  compact?: boolean;
  /**
   * 「這個呼叫端只給了子集, 勾全圖鑑時要去抓整本」的旗標 + 退路網址 (`/api/catalog?v=<指紋>`)。
   * 整本的實際來源是建置時的靜態資產 (CATALOG_ASSET_PATH), 這個網址只在它抓不到時才用。
   * 不給 = catalog 本來就是全量 (呼叫端自己有整份), 行為完全照舊 (不會多抓一次)。
   */
  fullCatalogUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** compact 的懸浮面板: 貼齊卡片下緣, 超出視窗右緣時往左推 (不讓頁面橫向捲動) */
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);
  useLayoutEffect(() => {
    if (!compact || !open) return;
    const el = panelRef.current;
    if (!el) return;
    const clamp = () => {
      el.style.transform = "translateX(0px)";
      const r = el.getBoundingClientRect();
      const overRight = r.right - (window.innerWidth - 8);
      const overLeft = 8 - r.left;
      setShiftX(overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0);
    };
    clamp();
    // 展開時把整個面板捲進可視範圍 (卡片在畫面下緣時面板會被切掉)
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [compact, open]);
  // 點面板外 = 收起 (懸浮面板的標準行為)
  useLayoutEffect(() => {
    if (!compact || !open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [compact, open]);
  // 有限縮池時預設「全部」(池子本身已窄, 且要看得到跨屬性的通用輔助)
  const [typeFilter, setTypeFilter] = useState<SyncPairType | "all">(
    allowedPairIds ? "all" : (filterType ?? "all")
  );
  const [showAll, setShowAll] = useState(false);
  /** 抓回來的整本 (勾「全圖鑑」才會有); null = 還沒抓 */
  const fullCatalog = useLoadedFullCatalog();
  const [loadingFull, setLoadingFull] = useState(false);
  // 結果區是自己捲的框 (max-h-96) — 卡片的延遲載圖要以它為 root。不給的話 rootMargin 擴張的
  // 是 viewport 而不是這個框, 框裡看不見的卡完全沒有預載邊界, 捲一格才補一格 (pop-in)。
  // 用 state 不用 ref: ref 在第一次渲染時還是 null, 卡片拿不到 root 就會退回 viewport。
  const [resultsEl, setResultsEl] = useState<HTMLDivElement | null>(null);

  /** 骨架只在「勾著全圖鑑而且還在抓」時出現 (抓一半改回候選池就不該再擋著) */
  const loadingCatalog = loadingFull && showAll;

  /**
   * 勾「全圖鑑」才去抓整本 (靜態資產優先, 抓不到退到 fullCatalogUrl; module 快取, 同分頁只有一次)。
   * 失敗 = 退回候選池 + toast: 面板絕不可以變成空白 —
   * 「入口還在但功能斷掉」是點名過的前科。
   */
  function toggleShowAll(next: boolean) {
    setShowAll(next);
    if (!next || !fullCatalogUrl || fullCatalog) return;
    setLoadingFull(true);
    loadFullCatalog(fullCatalogUrl)
      .catch((e: unknown) => {
        setShowAll(false);
        // 使用者看得到的字一律繁中 — 只有我們自己丟的訊息才往外顯示,
        // 瀏覽器/執行期產生的英文例外 (SyntaxError、TypeError: Failed to fetch…) 一律換掉
        const msg = e instanceof Error ? e.message : "";
        toast.error("全圖鑑載入失敗", {
          description: /[\u4e00-\u9fff]/.test(msg) ? msg : "網路或連線問題, 請再勾一次",
        });
      })
      .finally(() => setLoadingFull(false));
  }

  /** 已選槽位查得到卡 = 子集 + 抓回來的整本 (只給子集時, 名單外的拍組要靠後者) */
  const pairById = useMemo(() => {
    const map = new Map(catalog.map((p) => [p.pairId, p]));
    for (const p of fullCatalog ?? []) if (!map.has(p.pairId)) map.set(p.pairId, p);
    return map;
  }, [catalog, fullCatalog]);
  const allowedSet = useMemo(
    () => (allowedPairIds ? new Set(allowedPairIds) : null),
    [allowedPairIds]
  );
  const chosen = useMemo(() => new Set(picked.map((p) => p.pairId)), [picked]);

  // 不砍數量 (「全部」就真的是全部, 面板內自己捲) — 隊伍屬性的拍組排最前, 其餘最新在前
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmp = pairComparator("release-desc");
    // 解鎖全圖鑑時來源換成整本 (沒給 fullCatalogUrl 的呼叫端, catalog 本身就是全量)
    const source = showAll && fullCatalog ? fullCatalog : catalog;
    return source
      .filter((c) => (allowedSet && !showAll ? allowedSet.has(c.pairId) : true))
      .filter((c) => typeFilter === "all" || c.type === typeFilter)
      .filter((c) => (q ? pairHaystack(c).includes(q) : true))
      .sort((a, b) => {
        if (filterType) {
          const pa = a.type === filterType ? 0 : 1;
          const pb = b.type === filterType ? 0 : 1;
          if (pa !== pb) return pa - pb;
        }
        return cmp(a, b);
      });
  }, [catalog, fullCatalog, query, typeFilter, allowedSet, showAll, filterType]);

  /** 點結果卡: 已選 → 移除; 未選且有空位 → 加入 (面板保持開啟, 連選到滿) */
  function toggle(pairId: string) {
    if (chosen.has(pairId)) {
      onChange(picked.filter((p) => p.pairId !== pairId));
    } else if (picked.length < slots) {
      onChange([...picked, { pairId, minGrade: 5 }]);
    }
  }

  function clearSlot(index: number) {
    onChange(picked.filter((_, i) => i !== index));
  }

  /** 直接指定要求練度 (下拉) */
  function setGrade(index: number, next: number) {
    const cur = picked[index];
    const list = [...picked];
    list[index] = { ...cur, minGrade: Math.max(1, Math.min(10, next)) };
    onChange(list);
  }

  function bumpGrade(index: number) {
    const cur = picked[index];
    const rec = pairById.get(cur.pairId);
    const next = [...picked];
    next[index] = { ...cur, minGrade: cycleGrade(cur.minGrade, rec?.hasAwakening === true) };
    onChange(next);
  }

  return (
    <div ref={rootRef} className={cn("space-y-3", compact && "relative")}>
      {/* 已選的位置 — 卡片夠大, 圖不壓縮 */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: slots }).map((_, i) => {
          const p = picked[i];
          const rec = p ? pairById.get(p.pairId) : undefined;

          if (p && rec) {
            const awaken = p.minGrade >= 6;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="relative">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setOpen(true)}
                    title="點擊開面板換拍組"
                    className="block rounded-xl transition-transform hover:-translate-y-0.5 active:scale-95 disabled:pointer-events-none"
                  >
                    {/* 道館端顯示一律原始星級 (只管持有/寶數); 左下寶數可點 +1 */}
                    <SyncPairCard
                      pair={rec}
                      size={compact ? "sm" : "md"}
                      showName={false}
                      minimal
                      eager /* 已選的槽位一定在畫面上, 不必等觀察 */
                      potential={awaken ? 5 : p.minGrade}
                      superAwakening={awaken ? Math.min(5, p.minGrade - 5) : 0}
                      awakenable={rec.hasAwakening}
                      onCountClick={readOnly ? undefined : () => bumpGrade(i)}
                    />
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => clearSlot(i)}
                      className="absolute -right-2 -top-2 z-10 rounded-full border bg-background p-1.5 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                      title="移除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {/* 固定兩行高 (leading-tight × 2 = 2.5em) —— 名字一行/兩行的卡並排時,
                    下面的下拉才會對齊在同一條水平線上 (2026-09-10 使用者抓到);
                    與卡牆的卡名同一條規矩 (AGENTS「卡名固定兩行高」)。 */}
                <span className="line-clamp-2 h-[2.5em] w-full text-center text-[11px] leading-tight">
                  {pairName(rec)}
                </span>
                {readOnly ? (
                  <GradeChip grade={p.minGrade} />
                ) : (
                  <GradeSelect
                    grade={p.minGrade}
                    awakenable={rec.hasAwakening === true}
                    onChange={(next) => setGrade(i, next)}
                  />
                )}
              </div>
            );
          }

          return (
            <button
              key={i}
              type="button"
              disabled={readOnly}
              onClick={() => setOpen(true)}
              // 空位就是**一張卡的大小**, 不要撐滿整欄 —— 拍組卡是正方形的,
              // 一個比卡片還大的虛線長方形擺在旁邊看起來像壞掉
              // (2026-09-10 使用者:「不需要那麼大的 + 拍組虛線的樣子, 看起來很怪」)。
              className={cn(
                "mx-auto flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-muted-foreground transition-all",
                compact ? "w-24" : "w-32",
                "hover:border-primary/60 hover:bg-accent/40 hover:text-foreground active:scale-95",
                open && "border-primary bg-accent/50 text-foreground",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
            >
              <Plus className="h-5 w-5" />
              <span className="text-[11px]">加拍組</span>
            </button>
          );
        })}
      </div>

      {/* 搜尋面板 — 開一次連選到滿; 點已選的卡取消。
          compact = 懸浮在卡片下方 (寬度不受 328px 卡片限縮), 超出視窗會自動內推 */}
      {open && !readOnly ? (
        <div
          ref={panelRef}
          style={compact ? { transform: `translateX(${shiftX}px)` } : undefined}
          className={cn(
            "space-y-2 rounded-xl border p-2.5",
            compact
              ? "absolute left-0 top-full z-30 mt-1 w-[min(32rem,calc(100vw-1rem))] bg-popover shadow-xl"
              : "bg-muted/30"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              已選 {picked.length}/{slots}
            </span>
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="輸入訓練家或寶可夢名稱"
                className="h-8 pl-7"
              />
            </div>
            {allowedSet ? (
              <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => toggleShowAll(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                全圖鑑
              </label>
            ) : null}
            {!compact ? (
              <button
                onClick={() => setOpen(false)}
                className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="收起"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* 屬性快篩 */}
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTypeFilter("all")}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                typeFilter === "all" ? "border-primary font-medium" : "text-muted-foreground"
              )}
            >
              全部
            </button>
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                title={TYPE_LABELS[t]}
                className={cn(
                  "rounded-full border p-0.5 transition-all",
                  // 未選中用去彩度 (不用降透明度 — 看起來像 disabled 且對比不足)
                  typeFilter === t
                    ? "border-primary bg-accent"
                    : "border-transparent grayscale hover:grayscale-0"
                )}
              >
                <TypeIcon type={t} className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div
            ref={setResultsEl}
            aria-busy={loadingCatalog}
            className="grid max-h-96 grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 overflow-y-auto"
          >
            {loadingCatalog
              ? /* 全圖鑑抓取中 — 骨架與結果卡同構 (96px 卡 + 兩行卡名), 長出來時版面不跳 */
                Array.from({ length: 12 }, (_, i) => (
                  <div key={`sk-${i}`} className="flex flex-col items-center gap-0.5 p-1">
                    <Sk className="h-24 w-24 rounded-xl" delay={i * 100} />
                    <Sk className="mt-0.5 h-2 w-20" delay={i * 100} />
                    <Sk className="h-2 w-14" delay={i * 100 + 50} />
                  </div>
                ))
              : results.map((c) => {
                  const isChosen = chosen.has(c.pairId);
                  const full = !isChosen && picked.length >= slots;
                  return (
                    <button
                      key={c.pairId}
                      onClick={() => toggle(c.pairId)}
                      disabled={full}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-lg p-1 transition-all hover:-translate-y-0.5 hover:bg-accent active:scale-95",
                        full &&
                          "cursor-not-allowed opacity-40 hover:translate-y-0 hover:bg-transparent"
                      )}
                      title={isChosen ? `${pairName(c)} — 點擊移除` : pairName(c)}
                    >
                      <SyncPairCard
                        pair={c}
                        size="sm"
                        showName={false}
                        minimal
                        selected={isChosen}
                        scrollRoot={resultsEl}
                      />
                      <span className="line-clamp-2 text-center text-[10px] leading-tight">
                        {pairName(c)}
                      </span>
                    </button>
                  );
                })}
            {!loadingCatalog && results.length === 0 ? (
              <p className="col-span-full p-3 text-center text-xs text-muted-foreground">
                {allowedSet && !showAll
                  ? "候選池找不到 — 勾「全圖鑑」搜整本, 或先到道館成員拍組頁把拍組加進名單"
                  : "找不到拍組"}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
