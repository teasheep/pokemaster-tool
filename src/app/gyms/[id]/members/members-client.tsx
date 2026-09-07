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
import { PageHeading } from "@/components/page-shell";
import { CandyBarSkeleton, PairWallSkeleton } from "@/components/skeletons";
import { CandyBar, useMyCandies } from "@/components/gym/candy";
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
import type { CollectionEntry } from "@/lib/collection";
import { cycleEntry, defaultEntry } from "@/lib/collection-entry";
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
};

type PairRow = {
  id: string;
  pair_label: string;
  pair_id: string | null;
  grade: number;
  super_awakening: number;
  /** 個人練度的鏡像 (0057 level / 0059 promotion) — 只顯示在側板, 卡牆一律用原始星級 */
  level: number;
  /** null = 沒設定過 → 畫面退回這隻拍組的原始星級 */
  promotion: number | null;
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
  /** 道館拍組 (★) 名單 — 成員拍組牆預設只列這些 (由 gymPairs 推導, 不另外送一份) */
  const gymPairIds = useMemo(
    () => gymPairs.map((g) => g.pair_id).filter((v): v is string => !!v),
    [gymPairs]
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    viewer.memberId ?? ALL_GYM
  );
  /**
   * 換人要重畫整面卡牆 (道館視角約 144 張, 全圖鑑 600+) → 丟進 transition,
   * 點名冊當下不會卡住; 右欄在算的期間淡一下 (高度不變, 捲軸不會跳)。
   */
  const [switching, startSwitch] = useTransition();
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
          .select("id, pair_label, pair_id, grade, super_awakening, level, promotion")
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
      extra?: { level?: number; promotion?: number }
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
        })),
    [members]
  );

  return (
    <>
      <PageHeading
        title="成員與拍組"
        beside={viewer.isAdmin && invite ? <InviteCodes invite={invite} /> : null}
        action={<ExportCsvButton gymId={gymId} members={members} catalog={catalogAll} />}
      />
      {editing ? (
        <MemberEditDialog
          member={editing}
          isSelf={editing.id === viewer.memberId}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-6">
      {/* 手機/平板 (< lg = 名冊與明細疊成一欄的寬度): 名冊收成一列「目前在看誰」,
          點開 bottom sheet 選人 — 20 人的垂直清單擺在最上面等於把拍組推到第二屏。 */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        className="flex min-h-14 w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40 lg:hidden"
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
            gymId={gymId}
            isAdmin={viewer.isAdmin}
            members={gymViewMembers}
            gymPairs={gymPairs}
            grades={grades}
            catalog={catalogAll}
            catalogIsFull={fullCatalog.records !== null}
            fullCatalogLoading={fullCatalog.loading}
            onNeedFullCatalog={fullCatalog.load}
            />
        ) : !selected ? (
          <p className="text-sm text-muted-foreground">選擇一位成員檢視資料。</p>
        ) : (
          <Tabs defaultValue="pairs">
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
              />
            </TabsContent>
            <TabsContent value="resources">
              {/* key = 換人就整顆重來: 庫存 state 才不會殘留上一位的數字 */}
              <ResourcePanel
                key={selected.id}
                gymId={gymId}
                memberId={selected.id}
                canEdit={canEdit}
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
          displayName: member.displayName + (isMe ? "（我）" : ""),
          lineName: member.lineName,
          availability: member.availability,
          role: member.role,
          bound: member.bound,
          avatarUrl: member.avatarUrl,
        }}
        selected={selected}
        onClick={onSelect}
      />
      {canManage ? (
        <button
          onClick={onEdit}
          title="編輯這位成員的資料"
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
  onClose,
  onSaved,
}: {
  member: MemberItem;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [displayName, setDisplayName] = useState(member.displayName);
  const [lineName, setLineName] = useState(member.lineName ?? "");
  const [availability, setAvailability] = useState(member.availability ?? "");
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
        display_name: name,
        line_name: lineName.trim() || null,
        availability: availability.trim() || null,
        role: role as "admin" | "member" | "advisor",
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
          <DialogTitle>編輯成員</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">出沒時段</Label>
            <Input
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              maxLength={100}
              placeholder="例: 平日 12-14, 22-24 / 夜班 00-08"
            />
          </div>
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
}: {
  gymId: string;
  memberId: string;
  canEdit: boolean;
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
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-base font-semibold">糖果</h3>
        {/* 未到位時畫同尺寸的骨架 (七顆糖), 資料一到直接換上, 不會整排重排 */}
        {candies.counts ? (
          <CandyBar
            counts={candies.counts}
            onChange={canEdit ? candies.change : undefined}
            editable={canEdit}
          />
        ) : (
          <CandyBarSkeleton />
        )}
      </div>
      {TYPE_FOCUS_KINDS.map((kind) => (
        <TypeFocusBlock
          key={kind}
          kind={kind}
          selected={focus.focus?.[kind] ?? null}
          onToggle={focus.toggle}
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
  onChanged,
  onOptimistic,
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
  /** 送出前先把畫面改掉 (見上層的 patchPairGrade) — 受控的側板下拉不能等兩趟往返 */
  onOptimistic: (
    pairId: string,
    label: string,
    grade: number,
    superAwakening: number,
    extra?: { level?: number; promotion?: number }
  ) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  /** 範圍: 道館拍組 (預設) / 所有遊戲拍組 — 與全館視角同一種分頁 */
  const [scope, setScope] = useState<"gym" | "all">("gym");
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
   * 只看這位成員持有的 —— 與 /pairs 的「顯示全部 / 只看我持有的」是同一顆藥丸、同一個心智模型
   * (2026-09-07 補: 道館拍組分頁收嚴之後, 「他還有什麼」只剩全圖鑑可看, 645 張太難找)。
   * **預設關 (顯示全部)**, 與 /pairs 一致 —— 道館名單裡他沒有的那些灰卡才是這頁的重點。
   */
  const [ownedOnly, setOwnedOnly] = useState(false);
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
   * **只有寶數/超覺醒是真資料** —— member_pairs 沒有星數與等級, 其餘欄位是 defaultEntry
   * 的預設值, 所以側板一律開 `gradeOnly` 把那兩個下拉收起來 (畫出來就是在說謊)。
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
      };
    },
    [rowByPairId]
  );

  /**
   * 寫入這位成員的練度 — **這一頁唯一的寫入路徑** (左下角循環與側板下拉都走它)。
   * 走 set_member_pair RPC: 成員已綁定帳號時會一併更新他的個人收藏,
   * 否則他下次自己一改就會把這裡填的值蓋回去 (舊版就是這樣默默丟資料的)。
   */
  const saveGrade = useCallback(
    async (
      rec: ClientPairRecord,
      next: { potential: number; superAwakening: number },
      /**
       * 等級與星數。**沒傳 = 不要動** —— RPC 的 p_level / p_promotion 是 null 就保留原值
       * (0058 / 0059)。左下角的寶數循環不知道 (也不該知道) 這兩個值, 一律不傳;
       * 傳了 defaultEntry 的預設值就會把人家設好的 Lv200 / 6★EX 洗掉。
       */
      extra?: { level?: number; promotion?: number }
    ) => {
      // 這條軸的編碼與全站一致: 0=未持有, 1-5=寶, 6-10=超覺醒 (RPC 自己會照 sa 算 grade)
      const grade = next.superAwakening > 0 ? 5 + next.superAwakening : next.potential;
      onOptimistic(rec.pairId, pairLabel(rec), grade, next.superAwakening, extra);
      const { error } = await supabase.rpc("set_member_pair", {
        p_member: memberId,
        p_pair_id: rec.pairId,
        p_pair_label: pairLabel(rec),
        // 一定要拆成 (potential, superAwakening) 再送 —— RPC 會把 p_potential 夾到 0..5,
        // 直接把 0-10 的 grade 塞進去的話「超覺醒3」會靜靜變成「寶5」(0038:41-42)
        p_potential: next.potential,
        p_super_awakening: next.superAwakening,
        // null = 不要動 (見上面的 extra 參數)
        p_level: extra?.level ?? null,
        p_promotion: extra?.promotion ?? null,
      });
      if (error) {
        toast.error("更新失敗", { description: error.message });
        onChanged(); // 重抓 = 回滾 (伺服器才是真相)
        return;
      }
      onChanged();
    },
    [supabase, memberId, onChanged, onOptimistic]
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
    if (!ok) apply(isIn);
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
              // 側板的 entry 帶著真實的等級與星數 (entryOf 從 member_pairs 讀), 所以連同送出 ——
            // 改寶數時等於原值寫回, 改等級/星數時就是新值
            onChange={(next) =>
              void saveGrade(panelPair, next, { level: next.level, promotion: next.promotion })
            }
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

