"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Copy, Download, Pencil, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberAvatar, MemberCard, memberLabel } from "@/components/gym/member-card";
import { useEditOthersGuard } from "@/components/gym/edit-others-guard";
import { PageHeading } from "@/components/page-shell";
import { useCoalescedWrite } from "@/lib/pairs/use-coalesced-write";
import { CandyBarSkeleton, PairWallSkeleton } from "@/components/skeletons";
import { CANDY_GROUPS, CandyBar, useMyCandies } from "@/components/gym/candy";
import {
  TYPE_FOCUS_KINDS,
  TypeFocusBlock,
  useMyTypeFocus,
} from "@/components/gym/type-focus";
import { SidePanel } from "@/components/ui/side-panel";
import { setGymPair } from "@/lib/gym/gym-pairs-client";
import { GymPairsClient, type PackedGrades, type GymPairRow } from "../pairs/pairs-client";
import { PairTypeGrid, type GridItem } from "@/components/gym/pair-type-grid";
import { PairEditPanel } from "@/components/pair-edit-panel";
import { PairFilterBar } from "@/components/pair-filter-bar";
import { REGION_ORDER } from "@/data/sync-pairs";
import {
  EMPTY_PAIR_FILTERS,
  matchesPairFilters,
  type PairFilters,
} from "@/lib/pairs/filter";
import { type PairSortKey } from "@/lib/pairs/name";
import { cn } from "@/lib/utils";
import { buildMembersCsv, downloadCsv } from "@/lib/gym/export-csv";
import { useUrlState } from "@/lib/use-url-state";
import type { CollectionEntry } from "@/lib/collection";
import { cycleEntry, cyclePromotion, defaultEntry } from "@/lib/collection-entry";
import { createClient } from "@/lib/supabase/client";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { pairLabel, pairName } from "@/lib/pairs/name";
import type { GymViewer } from "@/lib/gym/queries";
import type { SyncPairType } from "@/lib/supabase/types";

type MemberItem = {
  id: string;
  displayName: string;
  role: string;
  bound: boolean;
  lineName: string | null;
  availability: string | null;
  avatarUrl: string | null;
  /** 頭像圓圈的自訂文字 (0062) — 沒設就從社群名取字 */
  badgeText: string | null;
};

type PairRow = {
  id: string;
  pair_label: string;
  pair_id: string | null;
  grade: number;
  super_awakening: number;
  /**
   * 個人練度的四個鏡像 (0057 level / 0059 promotion / 0063 sync_grid / 0065 ex_role_unlocked)。
   * `user_collection` 是 own-rows only, 道館端讀不到 → member_pairs 要有這幾份鏡像。
   * null 一律代表「沒設定過」, 畫面退回預設 (星數退回原始星級)。
   */
  level: number;
  promotion: number | null;
  /** 拍檔石盤段數索引 0-5 → 60/62/64/66/68/70 */
  sync_grid: number | null;
  /** EX 體系有沒有解鎖 (與 6★EX 是兩件事) */
  ex_role_unlocked: boolean | null;
};

type Props = {
  gymId: string;
  viewer: GymViewer;
  members: MemberItem[];
  /**
   * 圖鑑子集 = 道館名單 ∪ 全館持有 (實測 146 筆 / 71.5KB; 整本 645 筆是 309KB)。
   * 這頁預設看得到的每一張卡都在這裡面 —— 少送一邊卡片就會掉成灰字 (前科);
   * 「所有遊戲拍組」範圍的其餘 500 筆等使用者真的切過去才抓 (fullCatalogUrl)。
   */
  catalog: ClientPairRecord[];
  /** 整本圖鑑的網址 (`/api/catalog?v=<指紋>`) — 與隊伍庫/看板的「全圖鑑」同一份 */
  fullCatalogUrl: string;
  /** 邀請碼 (管理員才拿得到) — 加人是成員頁的職責 */
  invite?: { code: string | null; advisorCode: string | null };
  /** 全館視角 (道館拍組總覽) 需要的資料 */
  gymPairs: GymPairRow[];
  grades: PackedGrades;
  /**
   * 網址帶來的畫面狀態 —— 重新整理要留在原本的畫面, 不要每次都跳回預設
   * (2026-09-08 使用者:「重新整理會固定帶到道館重點拍組的 tab」)。
   * 由 page.tsx 從 searchParams 讀了傳下來, 不在 client 讀 (會 hydration mismatch)。
   */
  initialView: {
    member: string | null;
    view: "pairs" | "resources";
    scope: "gym" | "all";
    ownedOnly: boolean;
  };
};

/** 名冊第一項 = 全館視角 (不是某個成員) */
const ALL_GYM = "__gym__";

/**
 * 整本圖鑑 (645 筆) 的按需載入 — 「所有遊戲拍組」範圍才需要, 抓一次就留著
 * (網址帶 catalog 指紋 → 瀏覽器 immutable 快取, 同一份 catalog 只會下載一次;
 *  來源是隊伍庫/看板的「全圖鑑」同一條路, 那條換成靜態資產時這裡跟著換即可)。
 *
 * 為什麼不共用 pair-picker 的那支: 那支的 loader 沒有 export, 只能靠
 * `useCatalogWithFullFallback`「子集裡缺 id 就自動去抓」觸發, 而它抓失敗是**靜默降級**
 * (那裡沒有使用者主動操作, 註解寫得很清楚)。這裡是使用者自己點分頁, 失敗必須當場講
 * 並且留在原分頁 —— 「入口還在但內容少一半」是點名過的前科。
 * (成員頁沒有用到 PairPicker, 兩者不會在同一頁互相打架。)
 */
async function fetchFullCatalog(url: string): Promise<ClientPairRecord[]> {
  const res = await fetch(url, { cache: "force-cache" });
  // session 過期時 middleware 會 307 導去登入頁 (狀態 200 的 HTML), res.ok 擋不住 →
  // 直接 json() 會把瀏覽器的英文 SyntaxError 丟給使用者看
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("登入已過期, 請重新整理頁面");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { records?: ClientPairRecord[] };
  if (!Array.isArray(json.records)) throw new Error("回應格式不對");
  return json.records;
}

function useFullCatalog(url: string) {
  const [records, setRecords] = useState<ClientPairRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** 同一份請求兩個範圍切換器共用 (全館視角與成員視角各有一個分頁列) */
  const inflight = useRef<Promise<ClientPairRecord[]> | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    if (records) return true;
    setLoading(true);
    try {
      inflight.current ??= fetchFullCatalog(url);
      setRecords(await inflight.current);
      return true;
    } catch (e) {
      inflight.current = null; // 失敗不留下壞掉的 promise, 再點一次還能重試
      // 使用者看得到的字一律繁中: 只有我們自己丟的訊息才往外顯示
      const msg = e instanceof Error ? e.message : "";
      toast.error("全圖鑑載入失敗", {
        description: /[一-鿿]/.test(msg) ? msg : "網路或連線問題, 請再點一次",
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [records, url]);

  return { records, loading, load };
}

// pair_label 一律用 lib/pairs/name 的 pairLabel (標準寫法, 別再自刻)

export function MembersClient({
  gymId,
  viewer,
  members,
  catalog,
  fullCatalogUrl,
  invite,
  gymPairs,
  grades,
  initialView,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  /**
   * 整本圖鑑只有「所有遊戲拍組」範圍用得到 → 按需抓, 兩個範圍切換器共用這一份。
   * 沒抓之前 catalogAll === catalog (同一個參考), 卡牆的 memo 不會白白失效。
   */
  const fullCatalog = useFullCatalog(fullCatalogUrl);
  const catalogAll = useMemo(() => {
    if (!fullCatalog.records) return catalog;
    const have = new Set(catalog.map((p) => p.pairId));
    return [...catalog, ...fullCatalog.records.filter((p) => !have.has(p.pairId))];
  }, [catalog, fullCatalog.records]);
  /**
   * 道館名單。**server 的那份是起點不是終點** —— 這一頁常常開著不動 (管理員一邊看名冊
   * 一邊排), 而名單是**兩個管理員會同時改**的東西 (2026-09-09 使用者回報:
   * 「管理員設定完, 我的道館拍組分頁沒有一起變」、「有可能是兩個管理員同時進去新增」)。
   *
   * 所以回到這個分頁時重抓一次 (與看板的新鮮度同一套: visibilitychange + focus, 5 秒節流)。
   * 這**不是** Realtime —— 沒有連線、沒有訂閱, 只是回到畫面時多一個 150 列的小查詢
   * (AGENTS「全站沒有 Realtime」那條擋的是連線, 不是這個)。
   */
  const [refetched, setRefetched] = useState<GymPairRow[] | null>(null);
  // server 送了新的一份 → 丟掉本地重抓的那份 (它比較舊)。**在 render 期間調整 state**
  // 是 React 官方對「props 變了要重設 state」的作法; 寫成 effect 會多一次 render,
  // react-hooks/set-state-in-effect 也會擋 (見 react.dev「You Might Not Need an Effect」)。
  const [seenProps, setSeenProps] = useState(gymPairs);
  if (seenProps !== gymPairs) {
    setSeenProps(gymPairs);
    setRefetched(null);
  }
  const gymPairRows = refetched ?? gymPairs;
  useEffect(() => {
    let last = Date.now();
    let alive = true;
    const refetch = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 5000) return;
      last = Date.now();
      const { data } = await supabase
        .from("gym_pairs")
        .select("id, pair_label, pair_id, type")
        .eq("gym_id", gymId);
      if (alive && data) setRefetched(data);
    };
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("focus", refetch);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", refetch);
      window.removeEventListener("focus", refetch);
    };
  }, [gymId, supabase]);

  /** 道館拍組 (★) 名單 — 成員拍組牆預設只列這些 (由 gymPairRows 推導, 不另外送一份) */
  const gymPairIds = useMemo(
    () => gymPairRows.map((g) => g.pair_id).filter((v): v is string => !!v),
    [gymPairRows]
  );
  /**
   * **名單更新了還要有圖鑑紀錄才畫得出來**。server 送的是子集 (道館名單 ∪ 全館持有),
   * 而那份是**進頁面當下**算的 —— 別人在你開著頁面時加的拍組不在裡面, 於是名單同步了
   * 卡片還是不會出現 (這正是這次回報最難查的一段: 名單對了、畫面沒動、零錯誤)。
   * 缺了就自動補抓整本圖鑑 —— 與 PairPicker 的 `useCatalogWithFullFallback({ ids })`
   * 同一條規矩 (AGENTS:「別人在你開著頁面時加了名單外的拍組才會自動補抓」)。
   * 抓回來就 return, 不會反覆抓。
   */
  const loadFullCatalog = fullCatalog.load;
  const haveFullCatalog = fullCatalog.records !== null;
  useEffect(() => {
    if (haveFullCatalog) return;
    const have = new Set(catalog.map((p) => p.pairId));
    if (gymPairIds.some((id) => !have.has(id))) void loadFullCatalog();
  }, [gymPairIds, catalog, haveFullCatalog, loadFullCatalog]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialView.member ?? viewer.memberId ?? ALL_GYM
  );
  /** 成員底下的分頁 (拍組 / 資源) —— 也要跟著網址走 */
  const [view, setView] = useState<"pairs" | "resources">(initialView.view);
  /**
   * 換人要重畫整面卡牆 (道館視角約 144 張, 全圖鑑 600+) → 丟進 transition,
   * 點名冊當下不會卡住; 右欄在算的期間淡一下 (高度不變, 捲軸不會跳)。
   */
  const [switching, startSwitch] = useTransition();

  // 重新整理留在原本的畫面: 看誰 + 哪個分頁寫進網址。
  // 預設值不寫 (自己那一列、拍組分頁) —— 網址才不會長出一串沒有意義的參數。
  useUrlState({
    member: selectedId && selectedId !== (viewer.memberId ?? ALL_GYM) ? selectedId : null,
    view: view === "resources" ? "resources" : null,
  });
  const selectMember = useCallback((id: string) => {
    startSwitch(() => setSelectedId(id));
  }, []);
  const [pairs, setPairs] = useState<PairRow[]>([]);
  // loading 用「目前載入完成的是誰」推導, 避免在 effect 內同步 setState
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** 管理員正在編輯哪一位 (名冊上的鉛筆) */
  const [editing, setEditing] = useState<MemberItem | null>(null);
  /** 手機的成員選擇 bottom sheet (桌機是常駐左欄, 不用開關) */
  const [pickerOpen, setPickerOpen] = useState(false);
  const loading = selectedId !== null && selectedId !== loadedFor;

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const canEdit = viewer.isAdmin || (selectedId !== null && selectedId === viewer.memberId);
  /**
   * 改別人的資料要先確認一次 (2026-09-09 使用者回報的成員意見)。
   * **建在這一層**: 拍組與資源兩個面板共用同一份「問過了」—— 在拍組那邊確認過,
   * 切到資源分頁不會再問一次; 換一位成員才會再問。
   */
  const guard = useEditOthersGuard({
    userId: viewer.userId,
    memberId: selected?.id ?? "",
    memberName: selected ? memberLabel(selected) : "",
    isSelf: selected?.id === viewer.memberId,
  });
  // 查表用整份 (子集 + 抓回來的整本): 從「所有遊戲拍組」點的卡也要開得了側板/改得了寶數
  const pairById = useMemo(() => new Map(catalogAll.map((p) => [p.pairId, p])), [catalogAll]);

  // 快速切換成員時, 較慢的舊請求回來不能蓋掉新請求的結果
  const loadSeq = useRef(0);

  const loadMember = useCallback(
    async (memberId: string) => {
      const seq = ++loadSeq.current;
      const [pairsRes] = await Promise.all([
        supabase
          .from("member_pairs")
          .select("id, pair_label, pair_id, grade, super_awakening, level, promotion, sync_grid, ex_role_unlocked")
          .eq("member_id", memberId)
          .order("grade", { ascending: false })
          .order("pair_label"),
      ]);
      if (seq !== loadSeq.current) return; // 已有更新的請求, 這批結果作廢
      if (pairsRes.error) {
        toast.error("讀取成員資料失敗");
        return;
      }
      setPairs(pairsRes.data ?? []);
      setLoadedFor(memberId);
    },
    [supabase]
  );

  useEffect(() => {
    // 標準的 effect 資料抓取: setState 都在 await 之後 (非同步), 規則誤報
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId && selectedId !== ALL_GYM) void loadMember(selectedId);
  }, [selectedId, loadMember]);

  /** 練度改完後重抓目前這位 — 穩定的一顆, 才不會每次 render 都換掉卡牆的 handler */
  const reloadSelected = useCallback(() => {
    if (selectedId && selectedId !== ALL_GYM) void loadMember(selectedId);
  }, [selectedId, loadMember]);

  /**
   * 樂觀更新: 送出 RPC **之前**先把這一列改掉, 伺服器回來再對帳 (reloadSelected)。
   *
   * 側板的下拉是受控元件 —— 值來自 `pairs`。沒有這一步的話, 選了「超覺醒 3」畫面會先
   * **彈回舊值**, 等 RPC + 重抓整份 member_pairs 兩趟往返之後才變; 而 `/pairs` 那顆是即時的。
   * 同一顆側板兩種手感就等於白統一 (使用者這次抱怨的就是兩邊不一樣)。
   *
   * 一定要 patch **既有的 `pairs` state** 而不是另外開一份草稿 map ——
   * 草稿 map 會進到卡牆 handler 的 deps, 每改一次寶數整牆 SyncPairCard 的 memo 就全失效
   * (AGENTS「卡牆的 memo 要真的有效」點名過的前科)。走這條的話 rowByPairId / rowsRef /
   * items 全部沿原路更新, handler 身分不變。
   * 失敗時不手動回滾, 直接重抓 —— 伺服器才是真相, 手寫回滾會有第二套推導。
   */
  const patchPairGrade = useCallback(
    (
      pairId: string,
      label: string,
      grade: number,
      superAwakening: number,
      /** 沒傳 = 這次沒動 (左下角循環), 保留原值 —— 與 RPC 的 p_level / p_promotion 同一個約定 */
      extra?: { level?: number; promotion?: number; syncGrid?: number; exRoleUnlocked?: boolean }
    ) => {
      setPairs((prev) => {
        const i = prev.findIndex((p) => p.pair_id === pairId);
        // 寶0 = 沒有這隻 → RPC 會刪列, 這裡也刪 (不留幽靈列, 與 syncMemberPair 同一條規矩)
        if (grade === 0) return i < 0 ? prev : prev.filter((_, k) => k !== i);
        if (i < 0) {
          return [
            ...prev,
            {
              // 這一列還沒有伺服器給的 id; 卡牆用 pairId 當 key, 這個 id 只有孤兒列才會用到
              id: `pending:${pairId}`,
              pair_label: label,
              pair_id: pairId,
              grade,
              super_awakening: superAwakening,
              // 新列沒傳時 RPC 寫的是 1 / null, 這裡跟著
              level: extra?.level ?? 1,
              promotion: extra?.promotion ?? null,
              sync_grid: extra?.syncGrid ?? null,
              ex_role_unlocked: extra?.exRoleUnlocked ?? null,
            },
          ];
        }
        const next = [...prev];
        next[i] = {
          ...next[i]!,
          grade,
          super_awakening: superAwakening,
          // 沒傳 = 這次沒動, 保留原值 (與 RPC 的 coalesce 同一個語意)
          level: extra?.level ?? next[i]!.level,
          promotion: extra?.promotion ?? next[i]!.promotion,
          sync_grid: extra?.syncGrid ?? next[i]!.sync_grid,
          ex_role_unlocked: extra?.exRoleUnlocked ?? next[i]!.ex_role_unlocked,
        };
        return next;
      });
    },
    []
  );

  /** 全館視角要的成員清單 (不含顧問) — memo 掉, 否則 GymPairsClient 每次都收到新陣列 */
  const gymViewMembers = useMemo(
    () =>
      members
        .filter((m) => m.role !== "advisor")
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          lineName: m.lineName,
          avatarUrl: m.avatarUrl,
          badgeText: m.badgeText,
        })),
    [members]
  );

  return (
    <>
      {/* 「你正在改別人的資料」確認 —— 拍組與資源兩個面板共用這一個 */}
      {guard.dialog}
      <PageHeading
        title="成員與拍組"
        beside={viewer.isAdmin && invite ? <InviteCodes invite={invite} /> : null}
        action={<ExportCsvButton gymId={gymId} members={members} catalog={catalogAll} />}
      />
      {editing ? (
        <MemberEditDialog
          member={editing}
          isSelf={editing.id === viewer.memberId}
          canManage={viewer.isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-6">
      {/* 手機/平板 (< lg = 名冊與明細疊成一欄的寬度): 名冊收成一列「目前在看誰」,
          點開 bottom sheet 選人 — 20 人的垂直清單擺在最上面等於把拍組推到第二屏。
          外面這層 `member-picker` 是**只有手機看得見**的教學目標: 教學「點任何一位成員」
          那一步框的 member-row 在手機是收在這個 sheet 裡的, 沒開就框不到任何東西
          (findTarget 只挑看得見的, 桌機這層是 lg:hidden 所以量到 0 高度會被跳過)。 */}
      <div className="lg:hidden" data-tour="member-picker">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40"
        data-tour="gym-pairs-row"
      >
        {selectedId === ALL_GYM || !selected ? (
          <>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-muted">
              <Users className="h-5 w-5 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">全館拍組</span>
          </>
        ) : (
          <>
            <MemberAvatar member={selected} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{memberLabel(selected)}</span>
              <span className="block text-xs text-muted-foreground">
                {selected.role === "advisor"
                  ? "顧問"
                  : selected.role === "admin"
                    ? "管理員"
                    : "成員"}
                {canEdit ? "" : "・唯讀"}
              </span>
            </span>
          </>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          切換
          <ChevronsUpDown className="h-4 w-4" />
        </span>
      </button>
      </div>

      {/* 名冊 (頭像卡片) — 第一項是「全館」(道館拍組總覽), 顧問另外分區不佔名額。
          桌機常駐左欄; 手機同一份清單長在 bottom sheet 裡 (見頁尾的 SidePanel)。 */}
      <div className="hidden h-fit space-y-0.5 lg:block">
        <Roster
          members={members}
          selectedId={selectedId}
          viewerMemberId={viewer.memberId}
          canManage={viewer.isAdmin}
          onSelect={selectMember}
          onEdit={setEditing}
        />
      </div>

      {/* 明細: 全館 = 道館拍組總覽 (★ 名單 + 持有率); 選成員 = 那個人的練度/糖果/紀錄。
          換人時只淡化不換版面 — 一整面卡牆換成一行「載入中…」會讓頁面塌掉、捲軸暴衝。 */}
      <div
        className={cn(
          "min-w-0 transition-opacity motion-reduce:transition-none",
          switching && "opacity-60"
        )}
      >
        {selectedId === ALL_GYM ? (
          <GymPairsClient
            initialScope={initialView.scope}
            gymId={gymId}
            isAdmin={viewer.isAdmin}
            members={gymViewMembers}
            gymPairs={gymPairRows}
            grades={grades}
            catalog={catalogAll}
            catalogIsFull={fullCatalog.records !== null}
            fullCatalogLoading={fullCatalog.loading}
            onNeedFullCatalog={fullCatalog.load}
            />
        ) : !selected ? (
          <p className="text-sm text-muted-foreground">選擇一位成員檢視資料。</p>
        ) : (
          <Tabs value={view} onValueChange={(v) => setView(v === "resources" ? "resources" : "pairs")}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 lg:mb-4">
              {/* 手機: 上面那條選擇器已經寫著「現在在看誰」, 這裡不再重複一次名字 */}
              <h2 className="hidden items-center gap-2 text-lg font-semibold lg:flex">
                {memberLabel(selected)}
                {selected.role === "advisor" ? (
                  <Badge variant="secondary" className="bg-violet-500/15 text-violet-700 dark:text-violet-300">
                    顧問
                  </Badge>
                ) : selected.role === "admin" ? (
                  <Badge variant="secondary">管理員</Badge>
                ) : null}
                {canEdit ? null : (
                  <span className="text-sm font-normal text-muted-foreground">(唯讀)</span>
                )}
              </h2>
              {/* 手機: 兩個分頁等寬填滿一列 (44px 高); 桌機維持靠右的小分段控制項 */}
              <div className="flex w-full items-center gap-2 lg:w-auto">
                {/*
                  44px 是**分頁本身**的高度: TabsList 有 p-[3px] 而 TabsTrigger 是
                  h-[calc(100%-1px)], 把 List 釘成 h-11 只會讓真正可點的 Trigger 剩 37px。
                  改成 List 隨內容長高 + Trigger 自己 min-h-11。
                */}
                <TabsList className="max-lg:h-auto! max-lg:w-full!">
                  <TabsTrigger value="pairs" className="max-lg:min-h-11">
                    持有拍組
                  </TabsTrigger>
                  <TabsTrigger value="resources" className="max-lg:min-h-11">
                    資源
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="pairs">
              <PairsPanel
                gymId={gymId}
                isAdmin={viewer.isAdmin}
                memberId={selected.id}
                memberName={memberLabel(selected)}
                pairs={pairs}
                canEdit={canEdit}
                catalog={catalogAll}
                catalogIsFull={fullCatalog.records !== null}
                fullCatalogLoading={fullCatalog.loading}
                onNeedFullCatalog={fullCatalog.load}
                pairById={pairById}
                gymPairIds={gymPairIds}
                loading={loading}
                onChanged={reloadSelected}
                onOptimistic={patchPairGrade}
                guard={guard.run}
                initialScope={initialView.scope}
                initialOwnedOnly={initialView.ownedOnly}
              />
            </TabsContent>
            <TabsContent value="resources">
              {/* key = 換人就整顆重來: 庫存 state 才不會殘留上一位的數字 */}
              <ResourcePanel
                key={selected.id}
                gymId={gymId}
                memberId={selected.id}
                canEdit={canEdit}
                guard={guard.run}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
      </div>

      {/* 手機的成員選擇 — 手機側板一律 bottom sheet (共用 SidePanel, 已處理);
          選完就關, 直接看內容, 不用先捲過 20 個人。 */}
      <SidePanel
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="選擇成員"
        // 只在名冊收起來的寬度出現 (桌機左欄常駐); 底部安全區與 z 值由 SidePanel 自己處理
        className="lg:hidden"
      >
        <Roster
          members={members}
          selectedId={selectedId}
          viewerMemberId={viewer.memberId}
          canManage={viewer.isAdmin}
          onSelect={(id) => {
            selectMember(id);
            setPickerOpen(false);
          }}
          onEdit={(m) => {
            setEditing(m);
            setPickerOpen(false);
          }}
        />
      </SidePanel>
    </>
  );
}

/**
 * 名冊本體 — 桌機左欄與手機的選擇 bottom sheet 共用同一份。
 * 第一項一律是「全館拍組」(★ 名單 + 持有率), 顧問另外分區不佔名額。
 */
function Roster({
  members,
  selectedId,
  viewerMemberId,
  canManage,
  onSelect,
  onEdit,
}: {
  members: MemberItem[];
  selectedId: string | null;
  viewerMemberId: string | null;
  canManage: boolean;
  onSelect: (id: string) => void;
  onEdit: (m: MemberItem) => void;
}) {
  const advisors = members.filter((m) => m.role === "advisor");
  return (
    <div className="space-y-0.5">
      <button
        onClick={() => onSelect(ALL_GYM)}
        className={cn(
          "flex min-h-14 w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
          selectedId === ALL_GYM ? "border-primary/60 bg-accent font-medium" : "hover:bg-accent/50"
        )}
        data-tour="gym-pairs-row"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-muted">
          <Users className="h-5 w-5 text-muted-foreground" />
        </span>
        <span className="font-semibold">全館拍組</span>
      </button>
      {members
        .filter((m) => m.role !== "advisor")
        .map((m, mi) => (
          <MemberRow
            key={m.id}
            first={mi === 0}
            member={m}
            isMe={m.id === viewerMemberId}
            selected={m.id === selectedId}
            canManage={canManage}
            onSelect={() => onSelect(m.id)}
            onEdit={() => onEdit(m)}
          />
        ))}

      {advisors.length > 0 ? (
        <>
          <p className="pt-3 text-xs font-medium text-muted-foreground">
            顧問 (唯讀, 不佔名額)
          </p>
          {advisors.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isMe={m.id === viewerMemberId}
              selected={m.id === selectedId}
              canManage={canManage}
              onSelect={() => onSelect(m.id)}
              onEdit={() => onEdit(m)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

/** 名冊一列 = 可選取的成員卡 + 管理員的鉛筆 (button 不能包 button, 所以並排) */
function MemberRow({
  member,
  isMe,
  selected,
  canManage,
  onSelect,
  onEdit,
  first = false,
}: {
  member: MemberItem;
  isMe: boolean;
  selected: boolean;
  canManage: boolean;
  onSelect: () => void;
  onEdit: () => void;
  /** 名冊第一位 — 使用教學要框的目標 (只標一位) */
  first?: boolean;
}) {
  return (
    <div className="group relative" data-tour={first ? "member-row" : undefined}>
      <MemberCard
        member={{
          id: member.id,
          displayName: member.displayName,
          lineName: member.lineName,
          availability: member.availability,
          role: member.role,
          bound: member.bound,
          avatarUrl: member.avatarUrl,
        }}
        selected={selected}
        me={isMe}
        onClick={onSelect}
      />
      {/* 管理員可以改每一位; **一般成員可以改自己那一列** (2026-09-10 使用者:
          「頭貼的文字可以多一欄自定義, 讓使用者自己改」)。RLS 的 gym_members_update_self
          本來就允許改自己 (0028, 且 with check 釘住 role 不准變), 缺的只是入口。 */}
      {canManage || isMe ? (
        <button
          onClick={onEdit}
          title={canManage ? "編輯這位成員的資料" : "改我的頭像文字與出沒時段"}
          className="absolute right-1 top-1 inline-flex items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ── 成員資料編輯 (管理員) ──
// 自己的遊戲名/社群名/出沒時段在「頭像選單 → 個人設定」改;
// 這個 modal 是管理員代改別人 (尤其是還沒綁定帳號的成員) 用的。

function MemberEditDialog({
  member,
  isSelf,
  canManage = true,
  onClose,
  onSaved,
}: {
  member: MemberItem;
  isSelf: boolean;
  /** 管理員才看得到名字與角色 —— 一般成員改自己時只露圓圈文字與出沒時段 (見下面的註解) */
  canManage?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [displayName, setDisplayName] = useState(member.displayName);
  const [lineName, setLineName] = useState(member.lineName ?? "");
  const [availability, setAvailability] = useState(member.availability ?? "");
  const [badgeText, setBadgeText] = useState(member.badgeText ?? "");
  const [role, setRole] = useState(member.role);
  const [busy, setBusy] = useState(false);
  /** 移除要按兩次 (第一下變成紅色確認) — 動到全館名單, 不做單擊即刪 */
  const [confirmRemove, setConfirmRemove] = useState(false);
  const router = useRouter();

  async function save() {
    const name = displayName.trim();
    if (!name) {
      toast.error("遊戲名不能空白");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("gym_members")
      .update({
        // 一般成員改自己時**只送這一館的顯示方式** —— 名字與角色他本來就動不了
        // (名字跟人走在 profiles; 角色被 RLS 的 with check 釘死), 送了只會撞 RLS。
        ...(canManage
          ? {
              display_name: name,
              line_name: lineName.trim() || null,
              role: role as "admin" | "member" | "advisor",
            }
          : {}),
        availability: availability.trim() || null,
        // 空白 = 沒設 → 圓圈退回從社群名取字 (0062 的 check 只允許 1-3 字)
        badge_text: badgeText.trim() || null,
      })
      .eq("id", member.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("LAST_ADMIN") ? "道館至少要有一位管理員" : "儲存失敗",
        { description: error.message.includes("LAST_ADMIN") ? undefined : error.message }
      );
      return;
    }
    toast.success("已儲存");
    onSaved();
    onClose();
  }

  async function removeFromGym() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("gym_members").delete().eq("id", member.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("LAST_ADMIN") ? "道館至少要有一位管理員" : "移除失敗",
        { description: error.message.includes("LAST_ADMIN") ? undefined : error.message }
      );
      setConfirmRemove(false);
      return;
    }
    toast.success(isSelf ? "已退出道館" : "已移出道館");
    onClose();
    if (isSelf) router.push("/gyms?list=1");
    else onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{canManage ? "編輯成員" : "我在這一館的顯示方式"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* 名字**只有管理員在這裡改** —— 一般成員的遊戲名/社群名是個人資料 (profiles),
              入口在「頭像選單 → 個人設定」。同一件事兩個入口就會出現「我在這裡改了,
              另一個畫面卻沒變」(AGENTS: 名字跟人走)。這個對話框對一般成員只負責
              「這一館怎麼認我」那兩格。 */}
          {canManage ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">遊戲名</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">社群名 (LINE)</Label>
                <Input
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                  maxLength={30}
                  placeholder="與遊戲名相同可留空"
                />
              </div>
            </>
          ) : (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              名字要改請到「頭像選單 → 個人設定」—— 名字跟人走, 改一次全站都會變。
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">頭像文字</Label>
            <div className="flex items-center gap-2">
              {/* 即時預覽 —— 這個欄位改的就是這顆圓圈, 不看到它就不知道自己在改什麼 */}
              <MemberAvatar
                member={{
                  id: member.id,
                  displayName: displayName || member.displayName,
                  lineName: lineName || null,
                  avatarUrl: null,
                  badgeText: badgeText.trim() || null,
                }}
              />
              <Input
                value={badgeText}
                onChange={(e) => setBadgeText(e.target.value)}
                maxLength={3}
                placeholder="留空 = 取社群名第一個字"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              最多 3 個字。有上傳頭貼的人看不到這個圓圈（圖優先）。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">出沒時段</Label>
            <Input
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              maxLength={100}
              placeholder="例: 平日 12-14, 22-24 / 夜班 00-08"
            />
          </div>
          {/* 角色只有管理員動得了 —— RLS 的 gym_members_update_self 明文要求
              role 必須維持現況 (0028), 對一般成員畫這一格只會讓他存檔時撞 RLS。 */}
          {canManage ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">角色</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">成員</SelectItem>
                  <SelectItem value="advisor">顧問 (唯讀, 不佔名額)</SelectItem>
                  <SelectItem value="admin">管理員</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {/* 手機: 兩顆各自佔滿一列並撐到 44px (DialogFooter 本身已是 flex-col-reverse) */}
          <Button
            variant={confirmRemove ? "destructive" : "outline"}
            className="max-sm:w-full"
            onClick={() => void removeFromGym()}
            disabled={busy}
          >
            {confirmRemove ? "確定移出道館?" : isSelf ? "退出道館" : "移出道館"}
          </Button>
          <Button
            onClick={save}
            disabled={busy}
            className="max-sm:w-full"
          >
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 資源 (每位成員各自的): 糖果庫存 + 屬性資源方向 ──
// 糖果 = 排刀會把「吃糖可達的寶數」算進去; 兩塊屬性 = 安排道館戰時看得出誰在練哪一路。
// 與 /resources 是同一組元件, 兩邊文案不會各走各的。

function ResourcePanel({
  gymId,
  memberId,
  canEdit,
  guard,
}: {
  gymId: string;
  memberId: string;
  canEdit: boolean;
  /** 改別人的資料要先確認一次 (components/gym/edit-others-guard.tsx) */
  guard: (action: () => void) => void;
}) {
  const candies = useMyCandies(gymId, memberId);
  const focus = useMyTypeFocus(gymId, memberId);
  // 抓取一律在 effect: 寫在 render 階段的話第一次 render 必定是 null → 「載入中…」一定會閃。
  useEffect(() => {
    void candies.load();
    void focus.load();
    // deps 只認 memberId — 兩個 hook 的 load 每次 render 都是新函式, 放進 deps 會無限重抓。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);
  // 先綁成 const: 直接在 map 裡讀 candies.counts 的話, 外層那個 null 檢查不會跟進閉包
  const counts = candies.counts;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-base font-semibold">背包</h3>
        {/* 未到位時畫同尺寸的骨架, 資料一到直接換上, 不會整排重排。
            分組 (糖果 / 體系與潛力) 與 /resources 同一份 CANDY_GROUPS —— 同一個人的同一份
            庫存在兩個畫面要長得一樣。 */}
        {counts ? (
          <div className="space-y-3">
            {CANDY_GROUPS.map((g) => (
              <div key={g.key} className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{g.label}</div>
                <CandyBar
                  counts={counts}
                  onChange={
                    canEdit ? (type, next) => guard(() => candies.change(type, next)) : undefined
                  }
                  editable={canEdit}
                  types={g.types}
                />
              </div>
            ))}
          </div>
        ) : (
          <CandyBarSkeleton />
        )}
      </div>
      {TYPE_FOCUS_KINDS.map((kind) => (
        <TypeFocusBlock
          key={kind}
          kind={kind}
          selected={focus.focus?.[kind] ?? null}
          onToggle={(fk, type) => guard(() => focus.toggle(fk, type))}
          editable={canEdit}
          level={3}
        />
      ))}
    </div>
  );
}

// ── 匯出 CSV — 架構對齊道館慣用的調查表 (一列一成員, 一欄一道館拍組) ──

function ExportCsvButton({
  gymId,
  members,
  catalog,
}: {
  gymId: string;
  members: MemberItem[];
  catalog: ClientPairRecord[];
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const csv = await buildMembersCsv(createClient(), gymId, members, catalog);
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`成員拍組_${today}.csv`, csv);
    } catch (e) {
      toast.error("匯出失敗", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void run()}
      disabled={busy}
    >
      <Download className="mr-1 h-4 w-4" />
      {busy ? "匯出中…" : "匯出 CSV"}
    </Button>
  );
}

// ── 邀請碼 (加人是「成員」這頁的職責, 原本藏在沒有分頁的道館總覽) ──

function InviteCodes({
  invite,
}: {
  invite: { code: string | null; advisorCode: string | null };
}) {
  const copy = async (code: string, kind: string) => {
    await navigator.clipboard.writeText(code);
    toast.success(`${kind}已複製`);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-tour="invite-codes">
      {invite.code ? (
        <button
          onClick={() => void copy(invite.code!, "成員碼")}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:px-3"
          title="成員邀請碼 — 輸入即可加入, 佔 20 人名額"
        >
          成員碼 <span className="font-mono">{invite.code}</span>
          <Copy className="h-3 w-3" />
        </button>
      ) : null}
      {invite.advisorCode ? (
        <button
          onClick={() => void copy(invite.advisorCode!, "顧問碼")}
          className="inline-flex items-center gap-1 rounded border border-violet-500/50 px-2 py-1 text-violet-700 hover:bg-accent dark:text-violet-300 pointer-coarse:min-h-11 pointer-coarse:px-3"
          title="顧問邀請碼 — 加入後是唯讀顧問, 不佔名額"
        >
          顧問碼 <span className="font-mono">{invite.advisorCode}</span>
          <Copy className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

// ── 持有拍組 ──

function PairsPanel({
  gymId,
  isAdmin,
  memberId,
  memberName,
  pairs,
  canEdit,
  catalog,
  catalogIsFull,
  fullCatalogLoading,
  onNeedFullCatalog,
  pairById,
  gymPairIds,
  loading,
  guard,
  onChanged,
  onOptimistic,
  initialScope,
  initialOwnedOnly,
}: {
  gymId: string;
  isAdmin: boolean;
  memberId: string;
  memberName: string;
  pairs: PairRow[];
  canEdit: boolean;
  /** 圖鑑: 道館名單 ∪ 全館持有 的子集 (含這位成員持有的每一隻); 切「所有遊戲拍組」才補成整本 */
  catalog: ClientPairRecord[];
  catalogIsFull: boolean;
  fullCatalogLoading: boolean;
  onNeedFullCatalog: () => Promise<boolean>;
  pairById: Map<string, ClientPairRecord>;
  /** 道館拍組名單 (★) — 預設只列這些, 不用一次面對 600+ 張 */
  gymPairIds: string[];
  loading: boolean;
  onChanged: () => void;
  /** 網址帶來的初始狀態 (見上層的 initialView) */
  initialScope: "gym" | "all";
  initialOwnedOnly: boolean;
  /** 送出前先把畫面改掉 (見上層的 patchPairGrade) — 受控的側板下拉不能等兩趟往返 */
  onOptimistic: (
    pairId: string,
    label: string,
    grade: number,
    superAwakening: number,
    extra?: { level?: number; promotion?: number; syncGrid?: number; exRoleUnlocked?: boolean }
  ) => void;
  /** 改別人的資料要先確認一次 (components/gym/edit-others-guard.tsx) */
  guard: (action: () => void) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  /** 範圍: 道館拍組 (預設) / 所有遊戲拍組 — 與全館視角同一種分頁 */
  const [scope, setScope] = useState<"gym" | "all">(initialScope);
  /** 切範圍要對整份圖鑑重算 → transition, pending 期間卡牆淡一下 */
  const [scopePending, startScopeTransition] = useTransition();
  /** 篩選/排序一律用共用元件 (與全館拍組、我的拍組同一套) */
  const [filters, setFilters] = useState<PairFilters>(EMPTY_PAIR_FILTERS);
  // 打字/點 chip 即時更新控制項, 重篩交給 React 排程 (與 /pairs 同一套)
  const deferredFilters = useDeferredValue(filters);
  const [sortBy, setSortBy] = useState<PairSortKey>("release-desc");
  // 地區選項吃 REGION_ORDER 全集 (世代順序) — catalog 是子集, 從它推導會少掉幾個選項
  const regions = useMemo(() => [...REGION_ORDER], []);

  /**
   * 切分頁 —— 「所有遊戲拍組」需要整本圖鑑, 頁面只送子集。抓回來才切:
   * 先切過去再慢慢補會是一份「只有 146 隻」的假清單。失敗留在原分頁 (呼叫端已 toast)。
   */
  async function switchScope(next: "gym" | "all") {
    if (next === "all" && !catalogIsFull) {
      if (!(await onNeedFullCatalog())) return;
    }
    startScopeTransition(() => setScope(next));
  }

  /**
   * **從網址掛載成 scope=all 時要自己補抓整本圖鑑**。
   *
   * 前科 (2026-09-08, 加網址同步時開的洞): scope 現在會寫進網址, 於是重新整理或把連結
   * 貼給別人時, 元件會直接掛載成 scope="all" 而 catalogIsFull=false ——
   * 分頁看起來是選中的、沒有載入中、也沒有錯誤, 但卡牆只剩約 146 張的子集,
   * 其餘 500 隻整個不存在。「入口還在但內容少一半」是 AGENTS 點名過的前科。
   * 抓失敗就退回「道館拍組」, 不要留在一份假的全圖鑑上。
   */
  const askedFull = useRef(false);
  useEffect(() => {
    if (scope !== "all" || catalogIsFull || askedFull.current) return;
    askedFull.current = true;
    void onNeedFullCatalog().then((ok) => {
      if (!ok) setScope("gym");
    });
  }, [scope, catalogIsFull, onNeedFullCatalog]);

  /** pairId → 這位成員的持有列 */
  const rowByPairId = useMemo(() => {
    const m = new Map<string, PairRow>();
    for (const p of pairs) if (p.pair_id) m.set(p.pair_id, p);
    return m;
  }, [pairs]);
  /**
   * 同一份 map 的 ref — 卡牆的 grid 級 handler 從這裡讀當下的練度。
   * 把 map 綁進 callback 的 deps 的話, 每改一次寶數 handler 就換一顆,
   * PairTypeGrid 與整牆 SyncPairCard 的 memo 就全數失效。
   */
  const rowsRef = useRef(rowByPairId);
  useEffect(() => {
    rowsRef.current = rowByPairId;
  }, [rowByPairId]);

  // 道館名單做成 state — 側板按 ★ 即時反映 (管理員可在這裡把拍組加進道館名單)
  const [gymSet, setGymSet] = useState<Set<string>>(() => new Set(gymPairIds));
  /**
   * **server 送新名單下來就跟上** (2026-09-09 使用者回報「管理員設定完, 成員的道館拍組分頁
   * 沒有一起變」)。`useState` 的初始值只在**第一次掛載**時算一次 —— 這個面板在切換成員時
   * 不會重新掛載 (刻意的: 換人不該把篩選與範圍重設), 於是名單就永遠停在剛進頁面的那一份。
   * 另一位管理員加的拍組因此要整頁重新載入才看得到, 而畫面上完全沒有徵兆。
   *
   * 依賴用 join 出來的字串而不是陣列本身: server 每次渲染都會給一個新陣列,
   * 用陣列當依賴會每次都重設 state, 把樂觀更新洗掉。
   */
  const gymPairKey = gymPairIds.join(",");
  const [seenGymPairKey, setSeenGymPairKey] = useState(gymPairKey);
  if (seenGymPairKey !== gymPairKey) {
    setSeenGymPairKey(gymPairKey);
    setGymSet(new Set(gymPairKey ? gymPairKey.split(",") : []));
  }
  /**
   * 只看這位成員持有的 —— 與 /pairs 的「顯示全部 / 只看我持有的」是同一顆藥丸、同一個心智模型
   * (2026-09-07 補: 道館拍組分頁收嚴之後, 「他還有什麼」只剩全圖鑑可看, 645 張太難找)。
   * **預設關 (顯示全部)**, 與 /pairs 一致 —— 道館名單裡他沒有的那些灰卡才是這頁的重點。
   */
  const [ownedOnly, setOwnedOnly] = useState(initialOwnedOnly);

  // 重新整理留在原本的畫面 (範圍 + 持有開關)
  useUrlState({ scope: scope === "all" ? "all" : null, owned: ownedOnly ? "1" : null });
  /**
   * 這一輪操作過的卡 —— 開著「只看持有的」時把寶數循環回 0, 卡片會當場消失,
   * 手就懸在半空 (/pairs 踩過同一個坑, 解法一樣: 操作過的留著顯示灰卡)。
   */
  const [stickyIds, setStickyIds] = useState<Set<string>>(() => new Set());
  const [panelPair, setPanelPair] = useState<ClientPairRecord | null>(null);

  /**
   * 「道館拍組」分頁 = **只有道館名單**, 與旁邊「全館拍組」那個同名分頁完全一樣的定義。
   * 灰卡 = 這位成員沒有這隻 → 點左下角就點亮; 不需要「新增」搜尋框, 也不需要「移除」按鈕。
   * 點擊 handler 一律不掛在 item 上 (交給下面的 grid 級 onSelect/onCount)。
   *
   * **前科 (2026-09-07 使用者抓到)**: 這裡原本是「名單 ∪ 這位成員持有的其他拍組」,
   * 於是沒被設為道館拍組的卡 (例如某位成員自己有的 卡魯穆 & 火狐狸) 會出現在
   * 「道館拍組」分頁裡 —— 同一頁的兩個同名分頁講的是兩件事。
   * 他持有的其他拍組看「所有遊戲拍組」, 那才是那個分頁的職責。
   */
  const items = useMemo<GridItem[]>(() => {
    const q = deferredFilters.search.trim().toLowerCase();
    const inScope = catalog.filter((c) => scope === "all" || gymSet.has(c.pairId));
    const list: GridItem[] = [];
    for (const rec of inScope) {
      if (!matchesPairFilters(rec, deferredFilters, q)) continue;
      const row = rowByPairId.get(rec.pairId);
      const grade = row?.grade ?? 0;
      // 舊資料 grade=6 無等級 = 表單時代「超覺醒當覺5」慣例
      const sa = row ? (row.super_awakening > 0 ? row.super_awakening : grade >= 6 ? 5 : 0) : 0;
      list.push({
        key: rec.pairId,
        type: rec.type as SyncPairType,
        pair: rec,
        owned: grade > 0,
        potential: grade >= 6 ? 5 : grade,
        superAwakening: sa,
        // 個人星數 (2026-09-10 使用者指定拿掉「卡牆一律原始星級」的限制)。
        // 那條規則當初的理由是「自己合成的 6★EX 卡常常跑掉或歪掉」—— 換成官方成品卡之後
        // 那個理由不存在了。**這一面牆是「這一位成員的收藏」**, 顯示他的星數本來就是對的;
        // 混多人的牆 (全館拍組) 才是不能顯示的那一種, 而那邊也沒有「誰」可以拿。
        // null = 沒設定過 → 卡片自己退回原始星級 (SyncPairCard 的 promo 有夾下限)。
        promotion: row?.promotion ?? undefined,
        syncGrid: row?.sync_grid ?? 0,
        exRoleUnlocked: row?.ex_role_unlocked ?? false,
        corner:
          scope === "all" && gymSet.has(rec.pairId) ? (
            <span className="text-sm text-amber-400" title="已是道館拍組">
              ★
            </span>
          ) : null,
      });
    }
    // 圖鑑對不到的舊匯入資料 (只有名字) 也要看得到 —— 同樣只在「所有遊戲拍組」,
    // 它們也不是道館拍組 (與上面那條同一個理由)
    for (const p of scope === "all" ? pairs : []) {
      if (p.pair_id && pairById.has(p.pair_id)) continue;
      if (q && !p.pair_label.toLowerCase().includes(q)) continue;
      list.push({
        key: p.id,
        type: "normal",
        pair: null,
        fallbackLabel: p.pair_label,
        owned: p.grade > 0,
        potential: p.grade >= 6 ? 5 : p.grade,
        superAwakening: p.super_awakening,
      });
    }
    if (!ownedOnly) return list;
    return list.filter((it) => it.owned || stickyIds.has(it.key));
  }, [catalog, scope, gymSet, rowByPairId, deferredFilters, pairs, pairById, ownedOnly, stickyIds]);

  /** 清單還是舊的 (重篩/切範圍還在算) → 卡牆淡一下 */
  const stale = deferredFilters !== filters || scopePending;

  /**
   * 這位成員的練度 → 側板要的 CollectionEntry。
   * member_pairs 現在有四個鏡像欄位: level (0057) / promotion (0059) /
   * sync_grid (0063) / ex_role_unlocked (0065), 所以側板的每一格都是真資料,
   * 不再需要「道館版」旗標把哪幾格收起來。null 一律代表「沒設定過」→ 退回 defaultEntry 的值。
   */
  const entryOf = useCallback(
    (rec: ClientPairRecord): CollectionEntry => {
      const row = rowByPairId.get(rec.pairId);
      const grade = row?.grade ?? 0;
      // 舊資料 grade=6 無等級 = 表單時代「超覺醒當覺5」慣例 (與卡牆那份同一條推導)
      const sa = row ? (row.super_awakening > 0 ? row.super_awakening : grade >= 6 ? 5 : 0) : 0;
      return {
        ...defaultEntry(rec),
        owned: grade > 0,
        potential: grade >= 6 ? 5 : grade,
        superAwakening: sa,
        // 等級是 0057 補的鏡像 —— 沒有那一列 (灰卡) 就是 1 = 還沒設定
        level: row?.level ?? 1,
        // 星數是 0059 補的鏡像; null = 沒設定過 → 退回這隻拍組的原始星級 (defaultEntry 給的)
        ...(row?.promotion != null ? { promotion: row.promotion } : {}),
        syncGrid: row?.sync_grid ?? 0,
        exRoleUnlocked: row?.ex_role_unlocked ?? false,
      };
    },
    [rowByPairId]
  );

  /**
   * 寫入這位成員的練度 — **這一頁唯一的寫入路徑** (左下角循環與側板下拉都走它)。
   * 走 set_member_pair RPC: 成員已綁定帳號時會一併更新他的個人收藏,
   * 否則他下次自己一改就會把這裡填的值蓋回去 (舊版就是這樣默默丟資料的)。
   */
  const flushGrade = useCallback(
    async (
      pairId: string,
      job: {
        label: string;
        potential: number;
        superAwakening: number;
        extra: { level?: number; promotion?: number; syncGrid?: number; exRoleUnlocked?: boolean };
      }
    ) => {
      const { error } = await supabase.rpc("set_member_pair", {
        p_member: memberId,
        p_pair_id: pairId,
        p_pair_label: job.label,
        // 一定要拆成 (potential, superAwakening) 再送 —— RPC 會把 p_potential 夾到 0..5,
        // 直接把 0-10 的 grade 塞進去的話「超覺醒3」會靜靜變成「寶5」(0038:41-42)
        p_potential: job.potential,
        p_super_awakening: job.superAwakening,
        // null = 不要動 (見 saveGrade 的 extra 參數)
        p_level: job.extra.level ?? null,
        p_promotion: job.extra.promotion ?? null,
        p_sync_grid: job.extra.syncGrid ?? null,
        p_ex_role_unlocked: job.extra.exRoleUnlocked ?? null,
      });
      if (error) {
        toast.error("更新失敗", { description: error.message });
        onChanged(); // 重抓 = 回滾 (伺服器才是真相)
      }
      // 成功就**不重抓** —— 樂觀更新已經是正確的值, 而每點一次就重抓整份 member_pairs
      // 等於在使用者連點時排一串跨太平洋的往返, 那正是「按一下要等一下下」的來源。
    },
    [supabase, memberId, onChanged]
  );

  /**
   * 連點合併: 同一張卡 450ms 內連點只送最後一次 (見 lib/pairs/use-coalesced-write.ts)。
   * **extra 要用合併不是覆蓋** —— 側板改等級與左下角改寶數可能落在同一個視窗裡,
   * 覆蓋的話先改的那個欄位會被吃掉 (RPC 收到 null = 不要動 = 那次修改消失)。
   */
  const scheduleGrade = useCoalescedWrite(flushGrade, (prev, next) => ({
    ...next,
    extra: { ...prev.extra, ...next.extra },
  }));

  const writeGrade = useCallback(
    (
      rec: ClientPairRecord,
      next: { potential: number; superAwakening: number },
      /**
       * 等級與星數。**沒傳 = 不要動** —— RPC 的 p_level / p_promotion 是 null 就保留原值
       * (0058 / 0059)。左下角的寶數循環不知道 (也不該知道) 這兩個值, 一律不傳;
       * 傳了 defaultEntry 的預設值就會把人家設好的 Lv200 / 6★EX 洗掉。
       */
      extra?: { level?: number; promotion?: number; syncGrid?: number; exRoleUnlocked?: boolean }
    ) => {
      // 這條軸的編碼與全站一致: 0=未持有, 1-5=寶, 6-10=超覺醒 (RPC 自己會照 sa 算 grade)
      const grade = next.superAwakening > 0 ? 5 + next.superAwakening : next.potential;
      onOptimistic(rec.pairId, pairLabel(rec), grade, next.superAwakening, extra);
      scheduleGrade(rec.pairId, {
        label: pairLabel(rec),
        potential: next.potential,
        superAwakening: next.superAwakening,
        extra: extra ?? {},
      });
    },
    [onOptimistic, scheduleGrade]
  );

  /**
   * **全站寫入成員練度的唯一入口就是這一顆** (左下角循環與側板下拉都走它),
   * 所以防呆包在這裡一次就好 —— 改別人的資料時先問一次「這是 XXX 的資料」。
   * 樂觀更新也在 writeGrade 裡面, 所以「按取消」的畫面不會先變再彈回去。
   */
  const saveGrade = useCallback(
    (
      rec: ClientPairRecord,
      next: { potential: number; superAwakening: number },
      extra?: { level?: number; promotion?: number; syncGrid?: number; exRoleUnlocked?: boolean }
    ) => {
      guard(() => void writeGrade(rec, next, extra));
    },
    [guard, writeGrade]
  );

  // 卡片互動標準: 點卡片 (含灰卡) = 開側板; 點左下角 = 寶數循環。整牆共用同兩顆 handler。
  const onSelectCard = useCallback(
    (key: string) => {
      const rec = pairById.get(key);
      if (rec) setPanelPair(rec); // 圖鑑外的舊資料沒有側板可開
    },
    [pairById]
  );
  const onCountCard = useCallback(
    (key: string) => {
      const rec = pairById.get(key);
      if (!rec) return;
      // 開著「只看持有的」時循環回寶0 也要留在畫面上 (見 stickyIds)
      setStickyIds((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      // rowsRef 而不是 rowByPairId: 把 map 綁進 deps 的話, 每改一次寶數這顆 handler
      // 就換一個身分, 整牆 SyncPairCard 的 memo 全數失效 (檔頭那條)
      const row = rowsRef.current.get(key);
      const grade = row?.grade ?? 0;
      const sa = row ? (row.super_awakening > 0 ? row.super_awakening : grade >= 6 ? 5 : 0) : 0;
      const entry = { ...defaultEntry(rec), potential: grade >= 6 ? 5 : grade, superAwakening: sa };
      void saveGrade(rec, cycleEntry(entry, rec.hasAwakening === true));
    },
    [pairById, saveGrade]
  );

  /**
   * 右鍵 / 長按 = 升星 (2026-09-09 加, 見 lib/pairs/use-promote-gesture.ts)。
   *
   * 與左下角的寶數循環刻意**分成兩顆 handler**: 星數 (promotion) 與寶數/超覺醒 (grade)
   * 是兩條不同的軸, 混在一起就是 AGENTS 記過的那個前科。
   * 這裡只傳 `promotion`, 不傳 level —— RPC 的 null 是「不要動」, 傳了會把人家設好的等級洗掉。
   * 寶數/超覺醒照原值再送一次 (RPC 需要它們才算得出 grade), 所以要從 rowsRef 取現值。
   */
  const onPromoteCard = useCallback(
    (key: string) => {
      const rec = pairById.get(key);
      if (!rec) return;
      const row = rowsRef.current.get(key);
      const grade = row?.grade ?? 0;
      const sa = row ? (row.super_awakening > 0 ? row.super_awakening : grade >= 6 ? 5 : 0) : 0;
      const { promotion } = cyclePromotion(
        row?.promotion ?? rec.basePotential ?? 5,
        rec.basePotential ?? 5,
        rec.hasSixEx === true
      );
      saveGrade(rec, { potential: grade >= 6 ? 5 : grade, superAwakening: sa }, { promotion });
    },
    [pairById, saveGrade]
  );

  /** 管理員: 把這隻加進 / 移出道館拍組名單 (全站同一條寫入路徑) */
  async function toggleGymPair(rec: ClientPairRecord) {
    const isIn = gymSet.has(rec.pairId);
    const apply = (add: boolean) =>
      setGymSet((prev) => {
        const next = new Set(prev);
        if (add) next.add(rec.pairId);
        else next.delete(rec.pairId);
        return next;
      });
    apply(!isIn);
    const ok = await setGymPair(supabase, gymId, rec, !isIn);
    if (!ok) {
      apply(isIn);
      return;
    }
    /**
     * **一定要 router.refresh()**: `gymSet` 只是這個面板的本地 state, 初始值來自
     * server 傳下來的 `gymPairIds`。不刷新的話, 使用者切到「資源」分頁或名冊第一項
     * 再切回來 (面板重新掛載) 時, 初始值仍是**舊的那一份**, ★ 就不見了 ——
     * 看起來像沒存到, 管理員很可能再按一次, 那一次是 delete, 反而真的把名單移掉。
     * (2026-09-08 掃到的前科。)
     */
    router.refresh();
  }


  return (
    <div className="space-y-3">
      {/* 與「全館拍組」同一種結構: 分頁決定看哪一批, 工具列只有 搜尋/排序/篩選。
          手機: 分頁與持有開關各自佔滿一列 (44px 高); 桌機: 底線分頁 + 靠右藥丸同一列。
          排法與 /pairs 的 pairs-hub 一模一樣 —— 同一件事不要長出第二種版面。 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:border-b">
      <nav className="flex gap-1 border-b sm:border-b-0">
        {(["gym", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => void switchScope(v)}
            disabled={v === "all" && fullCatalogLoading}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-1 border-b-2 px-2 text-sm transition-colors",
              "sm:min-h-0 sm:flex-none sm:px-4 sm:py-2",
              scope === v
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {v === "gym" ? "道館拍組" : "所有遊戲拍組"}
            {/* 整本圖鑑按需載入 (只會抓一次) — 有回饋才不會像是點了沒反應 */}
            {v === "all" && fullCatalogLoading ? (
              <span className="text-xs text-muted-foreground">載入中…</span>
            ) : null}
          </button>
        ))}
      </nav>
      {/* 「看哪一批」(分頁) 與「看多少」(這顆) 是兩件事 —— 所以不進篩選列 */}
      <div className="flex rounded-full border p-0.5 text-sm sm:mb-1 sm:ml-auto sm:text-xs">
        {(
          [
            [false, "顯示全部"],
            [true, "只看持有的"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={label}
            onClick={() => setOwnedOnly(v)}
            className={cn(
              // 44px 是這顆藥丸自己的高度 (外框的 p-0.5 + border 不算觸控目標)
              "min-h-11 flex-1 rounded-full px-2.5 py-1 transition-colors sm:min-h-0 sm:flex-none",
              ownedOnly === v
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      </div>

      <PairFilterBar
        filters={filters}
        onChange={setFilters}
        regions={regions}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      {loading ? (
        /* 骨架而不是一行「載入中…」: 卡牆塌成一行字會讓頁面高度從數千 px 掉到幾百 px, 捲軸暴衝。
           段數給 6 (預設 3) — 道館名單本來就橫跨十幾個屬性, 太矮一樣會塌一截 */
        <PairWallSkeleton sections={6} />
      ) : (
        /* 全站統一: 拍組一律卡片牆呈現, 左下角循環更新。淡化只在外層容器, 不動卡片規格 */
        <div
          className={cn("transition-opacity motion-reduce:transition-none", stale && "opacity-60")}
        >
          <PairTypeGrid
            items={items}
            sortBy={sortBy}
            emptyText="沒有符合的拍組"
            onSelect={onSelectCard}
            onCount={canEdit ? onCountCard : undefined}
            onPromote={canEdit ? onPromoteCard : undefined}
          />
        </div>
      )}

      {/* 點卡片 → 這位成員這一張的練度。**與 /pairs 是同一顆側板** (PairEditPanel):
          使用者 2026-09-07 抓到「道館點進去不能下拉寶數, 但點左下角又可以」——
          同一張卡、同一個側板卻有兩種能力, 沒有道理。
          差別只有一個而且是資料決定的: member_pairs 只有寶數/超覺醒那一條軸,
          星數與等級是個人收藏的欄位 (別人的讀不到) → gradeOnly 把那兩格收起來。 */}
      <SidePanel
        open={panelPair !== null}
        onClose={() => setPanelPair(null)}
        title={panelPair ? pairName(panelPair) : ""}
      >
        {panelPair ? (
          <div className="space-y-3">
            {/* 這是誰的練度 —— /pairs 的側板永遠是「我的」不需要講, 這裡會 */}
            <p className="text-xs text-muted-foreground">{memberName} 的練度</p>
            <PairEditPanel
              pair={panelPair}
              entry={entryOf(panelPair)}
                editable={canEdit}
              /**
               * **只送使用者這次真的改動的欄位** —— 沒改的一律不傳 (RPC 的 null = 不要動)。
               *
               * 前科 (2026-09-08): 本來每次都把 next.level / next.promotion 一起送。
               * 但 entryOf 讀的是 member_pairs 的鏡像, 而寶數歸零時那一列會被刪掉 →
               * 側板接著顯示的是 defaultEntry 的預設值 (Lv1 / 原始星級)。使用者把
               * 「未持有」再改回寶3 時, 那兩個預設值就被當成「使用者的選擇」寫進
               * user_collection, 把他真正的 Lv200 / 6★EX 洗掉 (資料真的沒了)。
               */
              onChange={(next) => {
                const cur = entryOf(panelPair);
                void saveGrade(panelPair, next, {
                  level: next.level !== cur.level ? next.level : undefined,
                  promotion: next.promotion !== cur.promotion ? next.promotion : undefined,
                  // ⚠ 新增一條練度軸就要在這裡多一行, 否則側板改得動、卻存不進去。
                  // 前科 (2026-09-10 使用者:「我也改不回60」): 0063/0065 加了拍檔石盤與
                  // EX 體系, 這裡沒跟著加 → RPC 收到 null = 不要動, 下拉怎麼選都白選,
                  // 而且**完全沒有徵兆** (樂觀更新讓畫面先變, 重抓之後才彈回去)。
                  syncGrid: next.syncGrid !== cur.syncGrid ? next.syncGrid : undefined,
                  exRoleUnlocked:
                    next.exRoleUnlocked !== cur.exRoleUnlocked ? next.exRoleUnlocked : undefined,
                });
              }}
              // 左下角循環: 與卡牆同一個手勢、同一條寫入路徑
              onCountClick={() => onCountCard(panelPair.pairId)}
              gymPair={{
                isGymPair: gymSet.has(panelPair.pairId),
                canEdit: isAdmin,
                onToggle: () => void toggleGymPair(panelPair),
              }}
            />
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

