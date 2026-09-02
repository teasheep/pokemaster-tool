"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, Loader2, RotateCw, Save, Sparkles, Triangle, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ClientPairRecord } from "@/lib/pairs/types";

type CellMetadata = {
  starCount: number;
  exUnlocked: boolean;
  currentRarity: number;
  level: number | null;
  potential: number | null;
  superAwakening?: number;
};

type ExStyleInfo = { available: boolean; worn: boolean; confidence: number };

type ApiCandidate = {
  pairId: string;
  trainerId: string;
  pokemonId: string;
  trainerName: string;
  trainerNameZh: string | null;
  pokemonName: string;
  pokemonNameZh: string | null;
  type: string;
  score: number;
};

type ApiCell = {
  index: number;
  row: number;
  col: number;
  bestPairId: string | null;
  cellDataUrl: string;
  candidates: ApiCandidate[];
  score: number;
  gap: number; // 最佳與第二名分數差 — 內部用作信心指標, 不直接秀給使用者
  metadata: CellMetadata;
  exStyle: ExStyleInfo;
};

type EditableEntry = {
  apiCell: ApiCell;
  pairId: string; // 使用者確認的 pairId (可能跟 bestPair 不同)
  starLevel: number; // 1-5 (EX 由 exUnlocked 表示)
  level: number;
  exUnlocked: boolean;
  exStyleWorn: boolean;
  potential: number | null;
  superAwakening: number; // 0-5
  selected: boolean;
  saved: boolean; // 已寫入收藏 (避免重複 + 視覺回饋)
};

// embedding 分數的信心分檔 (gap = 最佳-第二名)
const CONFIDENCE_HIGH = 0.3;
const CONFIDENCE_MID = 0.12;
const AUTO_SELECT_GAP = 0.2;
// client 端逾時 (server maxDuration=300, 但避免連線卡死無限轉)
const CLIENT_TIMEOUT_MS = 180_000;

const TYPE_OPTIONS = [
  ["all", "所有屬性"], ["normal", "一般"], ["fire", "火"], ["water", "水"],
  ["electric", "電"], ["grass", "草"], ["ice", "冰"], ["fighting", "格鬥"],
  ["poison", "毒"], ["ground", "地面"], ["flying", "飛行"], ["psychic", "超能力"],
  ["bug", "蟲"], ["rock", "岩石"], ["ghost", "幽靈"], ["dragon", "龍"],
  ["dark", "惡"], ["steel", "鋼"], ["fairy", "妖精"],
] as const;

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|fetch failed|load failed/i.test(msg)) {
    return "網路連線失敗, 請稍後再試";
  }
  return msg || "發生未知錯誤";
}

export function ScreenshotUploadClient({ pairs }: { pairs: ClientPairRecord[] }) {
  const router = useRouter();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [entries, setEntries] = useState<EditableEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pairsById = useMemo(() => new Map(pairs.map((p) => [p.pairId, p])), [pairs]);

  // 卸載時清掉 object URL + 取消在途請求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("請上傳圖片");
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setEntries([]);
    setSavedCount(null);
  };

  const resetForNext = () => {
    abortRef.current?.abort();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageFile(null);
    setImageUrl(null);
    setEntries([]);
    setSavedCount(null);
  };

  const cancelMatch = () => {
    abortRef.current?.abort();
  };

  const runMatch = async () => {
    if (!imageFile) return;
    setMatching(true);
    setEntries([]);
    setSavedCount(null);
    setElapsed(0);

    const ac = new AbortController();
    abortRef.current = ac;
    const timeout = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);
    const ticker = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      if (filterType !== "all") fd.append("filterType", filterType);
      const resp = await fetch("/api/match-grid", { method: "POST", body: fd, signal: ac.signal });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as { cells: ApiCell[]; durationMs: number };

      const newEntries: EditableEntry[] = json.cells
        .filter((c) => c.bestPairId)
        .map((c) => {
          const selected = c.gap > AUTO_SELECT_GAP;
          // currentRarity 上限 5 (6★EX 用 exUnlocked 表示, 不混在星數)
          const rar = Math.min(5, c.metadata.currentRarity || c.metadata.starCount || 5);
          return {
            apiCell: c,
            pairId: c.bestPairId!,
            starLevel: rar,
            level: c.metadata.level ?? 1,
            exUnlocked: c.metadata.exUnlocked,
            exStyleWorn: c.exStyle?.worn ?? false,
            potential: c.metadata.potential,
            superAwakening: c.metadata.superAwakening ?? 0,
            selected,
            saved: false,
          };
        });
      setEntries(newEntries);
      toast.success(`辨識完成: ${newEntries.length} 格 (${(json.durationMs / 1000).toFixed(1)}s)`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("已取消辨識");
      } else {
        toast.error("辨識失敗", { description: friendlyError(e) });
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(ticker);
      abortRef.current = null;
      setMatching(false);
    }
  };

  // 穩定 callback: 避免每次 render 都產生新 onChange → 配合 memo(EntryRow) 只重渲染被編輯的那列
  const onEntryChange = useCallback((idx: number, patch: Partial<EditableEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }, []);

  const toggleAll = (checked: boolean) => {
    setEntries((prev) => prev.map((e) => (e.saved ? e : { ...e, selected: checked })));
  };

  const saveAll = async () => {
    const selected = entries.filter((e) => e.selected && !e.saved);
    if (selected.length === 0) {
      toast.error("沒有勾選任何 (未加入的) 拍組");
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/save-user-pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: selected.map((e) => ({
            pairId: e.pairId,
            starLevel: e.starLevel,
            level: e.level,
            exUnlocked: e.exUnlocked,
            exStyleWorn: e.exStyleWorn,
            potential: e.potential,
            superAwakening: e.superAwakening,
          })),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as {
        saved: number;
        total: number;
        results: Array<{ pairId: string; ok: boolean; error?: string; displayName?: string }>;
      };
      const okIds = new Set(json.results.filter((r) => r.ok).map((r) => r.pairId));
      // 標記已成功寫入的列 (鎖定 + 視覺回饋), 避免重複儲存
      setEntries((prev) =>
        prev.map((e) => (okIds.has(e.pairId) ? { ...e, saved: true, selected: false } : e))
      );
      const errs = json.results.filter((r) => !r.ok);
      if (errs.length) {
        toast.warning(`儲存 ${json.saved}/${json.total} 隻 (${errs.length} 失敗)`, {
          description: errs
            .slice(0, 3)
            .map((e) => {
              const p = pairsById.get(e.pairId);
              const name = p ? p.trainerNameZh ?? p.trainerName : e.pairId;
              return `${name}: ${e.error}`;
            })
            .join("; "),
        });
      } else {
        toast.success(`已加入 ${json.saved} 隻拍組到收藏`);
      }
      setSavedCount(json.saved);
      router.refresh();
    } catch (e) {
      toast.error("儲存失敗", { description: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = entries.filter((e) => e.selected && !e.saved).length;

  const openPicker = () => fileRef.current?.click();

  return (
    <div className="space-y-6">
      {/* Step 1: upload */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-semibold">1. 上傳整頁截圖</h2>
        <div
          role="button"
          tabIndex={0}
          aria-label="選擇或拖放拍組截圖"
          className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <ImagePlus className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">點此選擇,或拖一張遊戲內「拍檔組合」整頁截圖</p>
            <p className="mt-1 text-xs text-muted-foreground">
              5×4 grid 共 20 隻拍組 ・ 自動偵測格線 + 寶可夢/訓練家比對 + EX 裝/超覺醒/Lv
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {imageUrl && (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3">
              {/* 截圖預覽 — 讓使用者確認傳對檔 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="screenshot preview"
                className="h-24 w-auto rounded border bg-muted/30 object-contain"
              />
              <div className="flex-1 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {imageFile?.name} · {imageFile && (imageFile.size / 1024).toFixed(0)} KB
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    屬性篩選
                  </label>
                  <Select value={filterType} onValueChange={setFilterType} disabled={matching}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">
                    若整頁截圖是某屬性 filter, 選對應屬性可大幅提升準確度
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={runMatch} disabled={matching}>
                    {matching ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        辨識中… 已 {elapsed}s{elapsed > 30 ? " (首次載入模型較久)" : ""}
                      </>
                    ) : (
                      "開始辨識"
                    )}
                  </Button>
                  {matching ? (
                    <Button variant="ghost" size="sm" onClick={cancelMatch}>
                      <X className="mr-1 h-4 w-4" />
                      取消
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={resetForNext}>
                      換一張
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Step 2: review + edit */}
      {entries.length > 0 && (
        <Card className="p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              2. 確認結果 ({selectedCount} / {entries.length} 待加入)
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
                全選
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
                全不選
              </Button>
              <Button onClick={saveAll} disabled={saving || selectedCount === 0}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                加入收藏 ({selectedCount})
              </Button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            高信心 (綠) 自動勾選 ・ 待確認 (黃) 與低信心 (紅) 請手動確認 ・
            點下方 top-3 縮圖可直接換正解, 不對再用搜尋從 {pairs.length} 隻資料庫挑選。
          </p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {entries.map((entry, idx) => (
              <EntryRow
                key={entry.apiCell.index}
                index={idx}
                entry={entry}
                onChange={onEntryChange}
                allPairs={pairs}
                resolvedPair={pairsById.get(entry.pairId) ?? null}
              />
            ))}
          </div>

          {savedCount != null && savedCount > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                已加入 {savedCount} 隻拍組到收藏
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={resetForNext}>
                  <RotateCw className="mr-1 h-4 w-4" />
                  繼續上傳下一張
                </Button>
                <Button asChild size="sm">
                  <Link href="/pairs?tab=mine">前往我的拍組</Link>
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ConfidenceChip({ gap }: { gap: number }) {
  if (gap > CONFIDENCE_HIGH) {
    return (
      <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">
        高信心
      </Badge>
    );
  }
  if (gap > CONFIDENCE_MID) {
    return (
      <Badge variant="outline" className="border-yellow-500/50 text-yellow-600 text-[10px]">
        待確認
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-500/50 text-red-600 text-[10px]">
      低信心
    </Badge>
  );
}

const EntryRow = memo(function EntryRow({
  index,
  entry,
  onChange,
  allPairs,
  resolvedPair,
}: {
  index: number;
  entry: EditableEntry;
  onChange: (index: number, patch: Partial<EditableEntry>) => void;
  allPairs: ClientPairRecord[];
  resolvedPair: ClientPairRecord | null | undefined;
}) {
  const c = entry.apiCell;
  const gap = c.gap;
  const tone =
    gap > CONFIDENCE_HIGH
      ? "border-emerald-500/60"
      : gap > CONFIDENCE_MID
        ? "border-yellow-500/60"
        : "border-red-500/60";

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allPairs
      .filter((p) =>
        `${p.trainerName} ${p.pokemonName} ${p.trainerNameZh ?? ""} ${p.pokemonNameZh ?? ""}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 8);
  }, [search, allPairs]);

  const pick = (pairId: string) => {
    onChange(index, { pairId });
    setSearchOpen(false);
    setSearch("");
    setActiveIdx(0);
  };

  const teraDetected = resolvedPair?.change === "TERA";

  return (
    <div
      className={`rounded-md border-2 p-3 ${tone} ${
        entry.saved ? "bg-emerald-500/5" : entry.selected ? "bg-card" : "bg-muted/30 opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={entry.selected}
          disabled={entry.saved}
          onCheckedChange={(v) => onChange(index, { selected: v === true })}
          className="mt-1"
        />

        {/* 截圖原圖 */}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded border bg-muted/30">
          <Image
            src={c.cellDataUrl}
            alt={`格 ${c.index + 1}`}
            fill
            unoptimized
            className="object-contain"
          />
        </div>

        {/* 比對結果 — 偵測為穿 EX 裝時改顯示 EX 換裝立繪 + 標記。
            兩邊副檔名不一樣是刻意的: trainer/ 全站已轉 .webp (卡牆在用, 量最大);
            trainer-ex/ 沒轉也沒進部署 (public/.assetsignore) — 它只有這一頁在用, 而這頁是
            *.node.tsx, cloudflare build 的 pageExtensions 根本不收 → 只有本機跑得到, 讀 .png 就好。
            要重啟 EX 立繪 UI 時: 先把 trainer-ex 加進 convert-card-images.mjs 的 TARGETS,
            再把這裡改成 .webp, 並拿掉 .assetsignore 那一行。 */}
        {resolvedPair && (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded border bg-muted/30">
            <Image
              src={
                entry.exStyleWorn && resolvedPair.trainerId
                  ? `/reference/trainer-ex/${resolvedPair.trainerId}_ex.png`
                  : `/reference/trainer/${resolvedPair.trainerId}_128.webp`
              }
              alt="比對結果"
              fill
              unoptimized
              className="object-contain"
            />
            {entry.exStyleWorn && (
              <span className="absolute left-0.5 top-0.5 rounded bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-1 text-[8px] font-bold leading-tight text-white">
                EX 裝
              </span>
            )}
            {teraDetected && (
              <span className="absolute right-0.5 top-0.5 flex items-center gap-0.5 rounded bg-violet-600 px-1 text-[8px] font-bold leading-tight text-white">
                <Triangle className="h-2 w-2" />
                太晶
              </span>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            #{c.index + 1}
            <ConfidenceChip gap={gap} />
            {entry.saved && (
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">
                已加入
              </Badge>
            )}
            {entry.superAwakening > 0 && (
              <Badge variant="secondary" className="text-[9px]">
                <Sparkles className="mr-0.5 h-2.5 w-2.5" />
                超覺醒 {entry.superAwakening}
              </Badge>
            )}
          </div>
          {resolvedPair && (
            <>
              <div className="truncate text-sm font-medium">
                {resolvedPair.trainerNameZh ?? resolvedPair.trainerName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                & {resolvedPair.pokemonNameZh ?? resolvedPair.pokemonName}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Top-N 候選縮圖 — 一鍵切換正解 (matcher 已經算好) */}
      {c.candidates.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] text-muted-foreground">辨識前 3 候選 (點選即切換):</div>
          <div className="flex gap-1.5">
            {c.candidates.slice(0, 3).map((cand) => {
              const isPicked = cand.pairId === entry.pairId;
              return (
                <button
                  key={cand.pairId}
                  onClick={() => onChange(index, { pairId: cand.pairId })}
                  disabled={entry.saved}
                  className={`flex flex-1 min-w-0 items-center gap-1.5 rounded border p-1 text-left transition-colors disabled:opacity-50 ${
                    isPicked
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-border hover:bg-accent"
                  }`}
                  title={`${cand.trainerNameZh ?? cand.trainerName} & ${cand.pokemonNameZh ?? cand.pokemonName}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/reference/trainer/${cand.trainerId}_128.webp`}
                    alt={cand.trainerName}
                    loading="lazy"
                    className="h-9 w-9 shrink-0 rounded object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium">
                      {cand.trainerNameZh ?? cand.trainerName}
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {cand.pokemonNameZh ?? cand.pokemonName}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {!searchOpen ? (
            <button
              onClick={() => setSearchOpen(true)}
              disabled={entry.saved}
              className="mt-1.5 text-[10px] text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              都不對? 從全部 {allPairs.length} 隻搜尋...
            </button>
          ) : (
            <div
              className="relative mt-1.5"
              onBlur={(e) => {
                // 焦點移出整個搜尋區塊才關閉 (允許點選項目)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setSearchOpen(false);
              }}
            >
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearch("");
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(i + 1, searchResults.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const sel = searchResults[activeIdx];
                    if (sel) pick(sel.pairId);
                  }
                }}
                placeholder="搜尋訓練家或寶可夢..."
                className="h-7 text-xs"
                autoFocus
                role="combobox"
                aria-expanded={searchResults.length > 0}
                aria-controls={`search-list-${c.index}`}
                aria-activedescendant={
                  searchResults[activeIdx] ? `opt-${c.index}-${activeIdx}` : undefined
                }
              />
              {searchResults.length > 0 && (
                <ul
                  id={`search-list-${c.index}`}
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border bg-popover shadow"
                >
                  {searchResults.map((p, i) => (
                    <li key={p.pairId} role="option" id={`opt-${c.index}-${i}`} aria-selected={i === activeIdx}>
                      <button
                        onClick={() => pick(p.pairId)}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`block w-full px-2 py-1 text-left text-xs ${
                          i === activeIdx ? "bg-accent" : "hover:bg-accent"
                        }`}
                      >
                        {p.trainerNameZh ?? p.trainerName} & {p.pokemonNameZh ?? p.pokemonName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <div>
          <label className="text-[10px] text-muted-foreground">星數</label>
          <Select
            value={String(entry.starLevel)}
            onValueChange={(v) => onChange(index, { starLevel: Number(v) })}
            disabled={entry.saved}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}★
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Lv</label>
          <Input
            type="number"
            min={1}
            max={200}
            value={entry.level}
            disabled={entry.saved}
            onChange={(e) => onChange(index, { level: Number(e.target.value) })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">超覺醒</label>
          <Select
            value={String(entry.superAwakening)}
            onValueChange={(v) => onChange(index, { superAwakening: Number(v) })}
            disabled={entry.saved}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 0 ? "無" : n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-1 text-[11px]">
            <Checkbox
              checked={entry.exUnlocked}
              disabled={entry.saved}
              onCheckedChange={(v) => onChange(index, { exUnlocked: v === true })}
            />
            EX
          </label>
        </div>
      </div>
    </div>
  );
});
