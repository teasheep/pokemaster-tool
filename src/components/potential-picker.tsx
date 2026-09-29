"use client";

// 拍組側板的「潛能」—— 最多 5 個, 特殊潛能與一般潛能分開選 (2026-09-29 使用者指定)。
//
// 選擇區是**在側板裡就地展開**, 不是再疊一層彈窗: 側板在手機上本身就是 bottom sheet,
// 再疊一層就是「sheet 上面的 popover」, 捲動與關閉都會打架。
//
// 特殊潛能依餅乾分組 (專用 / 塔1 / 塔2 / 道館對戰) —— 一種餅乾有好幾個潛能的是**隨機得到其一**,
// 分組標題上講一次就好。一般潛能 219 種依餅乾分成五組 (硬脆 / 鬆脆 / 酥脆 / 香脆 / 特別,
// 與 pomatools 的潛能選單同一個分法), 可搜尋 (搜尋時跨五組找), 同一個效果的各級排在同一列。
// ⚠ 級數按鈕**放在名稱下面另起一行**, 不要跟名稱擠同一行 —— 有些效果有 1-9 級,
//   九顆按鈕會把左邊的名稱擠到只剩一兩個字 (2026-09-29 使用者抓到)。

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_LUCKY_SKILLS,
  cookieHeading,
  cookieIcon,
  loadPotentials,
  skillIcon,
  splitTier,
  type GeneralCookieKey,
  type PotentialData,
} from "@/lib/pairs/potentials";
import { cn } from "@/lib/utils";

/** 延遲載入潛能資料 (enabled = false 時不抓) */
export function usePotentials(enabled = true): PotentialData | null {
  const [data, setData] = useState<PotentialData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPotentials()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* 載入失敗: 名稱顯示成 id, 不擋其他欄位 */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return data;
}

type Family = { family: string; desc: string; tiers: { id: string; tier: string }[] };

/** 餅乾圖示 (純裝飾, 旁邊一定有文字) */
export function CookieIcon({ src, className }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- 64px 的遊戲小圖示, 不需要 next/image
  return <img src={src} alt="" aria-hidden className={cn("shrink-0 object-contain", className)} />;
}

export function PotentialPicker({
  pairId,
  value,
  onChange,
  disabled,
}: {
  pairId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const data = usePotentials();
  const [open, setOpen] = useState(false);
  const special = data?.pairs[pairId] ?? [];
  const [tab, setTab] = useState<"special" | "general">("special");
  const [group, setGroup] = useState<GeneralCookieKey>("red");
  const [query, setQuery] = useState("");
  // 沒有特殊潛能的拍組直接看一般 (不要讓人先點進一個空分頁)
  const activeTab = special.length === 0 ? "general" : tab;
  const full = value.length >= MAX_LUCKY_SKILLS;

  const nameOf = (id: string) => data?.skills[id]?.[0] ?? id;
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!full) onChange([...value, id]);
  };

  // 一般潛能: 每組內依「效果」分列, 同一效果的各級放同一列
  const groups = useMemo(() => {
    if (!data) return [];
    return data.general.map((g) => {
      const map = new Map<string, Family>();
      for (const id of g.skills) {
        const [name, desc] = data.skills[id] ?? [id, ""];
        const [family, tier] = splitTier(name);
        if (!map.has(family)) map.set(family, { family, desc, tiers: [] });
        map.get(family)!.tiers.push({ id, tier });
      }
      return { ...g, families: [...map.values()] };
    });
  }, [data]);
  const q = query.trim();
  // 有打字就跨五組找 (使用者不會知道某個效果是哪一種餅乾抽的); 沒打字就只看選中的那一組
  const shownGroups = q
    ? groups
        .map((g) => ({ ...g, families: g.families.filter((f) => f.family.includes(q) || f.desc.includes(q)) }))
        .filter((g) => g.families.length > 0)
    : groups.filter((g) => g.key === group);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">潛能</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.length}/{MAX_LUCKY_SKILLS}
        </span>
      </div>

      {/* 已選的潛能 */}
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              title={data?.skills[id]?.[1]}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 py-0.5 pl-1 pr-1 text-xs"
            >
              {data ? <CookieIcon src={skillIcon(data, pairId, id)} className="h-4 w-4" /> : null}
              {nameOf(id)}
              {disabled ? (
                <span className="w-1" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`移除潛能 ${nameOf(id)}`}
                  className="relative rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : disabled ? (
        <p className="text-xs text-muted-foreground">未設定</p>
      ) : null}

      {disabled ? null : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-1.5 rounded-md border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
        >
          {open ? <ChevronDown className="h-4 w-4 rotate-180" /> : <Plus className="h-4 w-4" />}
          {open ? "收起" : full ? "已選滿" : "新增潛能"}
        </button>
      )}

      {open && !disabled ? (
        <div className="space-y-2 rounded-lg border p-2">
          <div className="flex gap-1" role="tablist">
            {(["special", "general"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={activeTab === t}
                disabled={t === "special" && special.length === 0}
                onClick={() => setTab(t)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors pointer-coarse:min-h-11 disabled:opacity-40",
                  activeTab === t ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent"
                )}
              >
                <CookieIcon src={cookieIcon(t === "special" ? (special[0]?.kind ?? "exclusive") : "red")} className="h-5 w-5" />
                {t === "special" ? `特殊潛能${special.length ? "" : "（無）"}` : "一般潛能"}
              </button>
            ))}
          </div>

          {!data ? (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">載入中…</p>
          ) : activeTab === "special" ? (
            <div className="max-h-80 space-y-3 overflow-y-auto pr-0.5">
              {special.map((c, i) => (
                <div key={i} className="space-y-1">
                  <p className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
                    <CookieIcon src={cookieIcon(c.kind)} className="h-5 w-5" />
                    {cookieHeading(c)}
                    {c.skills.length > 1 ? "（隨機其一）" : ""}
                  </p>
                  {c.skills.map((id) => (
                    <OptionRow
                      key={id}
                      name={nameOf(id)}
                      desc={data.skills[id]?.[1] ?? ""}
                      selected={value.includes(id)}
                      disabled={full && !value.includes(id)}
                      onClick={() => toggle(id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* 五種餅乾: 圖示 + 兩個字, 手機上一排剛好放得下 */}
              <div className="grid grid-cols-5 gap-1">
                {groups.map((g) => {
                  const on = !q && group === g.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => {
                        setGroup(g.key);
                        setQuery("");
                      }}
                      aria-pressed={on}
                      title={g.label}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-md border px-1 py-1 text-xs transition-colors",
                        on ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
                      )}
                    >
                      <CookieIcon src={cookieIcon(g.key)} className="h-6 w-6" />
                      {g.label.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋潛能"
                  className="h-9 pl-8"
                />
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-0.5">
                {shownGroups.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">找不到符合的潛能</p>
                ) : (
                  shownGroups.map((g) => (
                    <div key={g.key} className="space-y-1">
                      {q ? (
                        <p className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
                          <CookieIcon src={cookieIcon(g.key)} className="h-4 w-4" />
                          {g.label}
                        </p>
                      ) : null}
                      {g.families.map((f) =>
                        f.tiers.length === 1 ? (
                          <OptionRow
                            key={f.family}
                            name={nameOf(f.tiers[0]!.id)}
                            desc={f.desc}
                            selected={value.includes(f.tiers[0]!.id)}
                            disabled={full && !value.includes(f.tiers[0]!.id)}
                            onClick={() => toggle(f.tiers[0]!.id)}
                          />
                        ) : (
                          <FamilyRow key={f.family} family={f} value={value} full={full} onToggle={toggle} />
                        )
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 同一個效果有好幾級: 名稱與說明佔滿整列, 級數按鈕在下面另起一行 (九級也不會擠掉名稱) */
function FamilyRow({
  family: f,
  value,
  full,
  onToggle,
}: {
  family: Family;
  value: string[];
  full: boolean;
  onToggle: (id: string) => void;
}) {
  const picked = f.tiers.some((t) => value.includes(t.id));
  return (
    <div className={cn("space-y-1 rounded-md border px-2.5 py-1.5", picked && "border-primary bg-primary/10")}>
      <div>
        <p className="text-sm">{f.family}</p>
        {f.desc ? <p className="text-xs text-muted-foreground">{f.desc}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {f.tiers.map((t) => {
          const on = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggle(t.id)}
              disabled={full && !on}
              aria-pressed={on}
              aria-label={`${f.family}${t.tier}`}
              className={cn(
                "min-w-8 rounded-md border px-1.5 py-1 text-xs tabular-nums transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:opacity-30",
                on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
              )}
            >
              {t.tier}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OptionRow({
  name,
  desc,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors pointer-coarse:min-h-11 disabled:opacity-40",
        selected ? "border-primary bg-primary/10" : "hover:bg-accent"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
        )}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm">{name}</span>
        {desc ? <span className="block text-xs text-muted-foreground">{desc}</span> : null}
      </span>
    </button>
  );
}

/**
 * 備註 —— 打字時不存, **離開欄位才存** (每打一個字送一次的話, 連打一句話就是幾十趟往返,
 * 而且中途的半句話會出現在別人的畫面上)。切換到別的拍組時 key 會換, 草稿跟著重來。
 */
export function NotesField({
  value,
  onCommit,
  disabled,
  maxLength,
}: {
  value: string | null;
  onCommit: (next: string) => void;
  disabled: boolean;
  maxLength: number;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs" htmlFor="pair-notes">
          備註
        </Label>
        {disabled ? null : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {draft.length}/{maxLength}
          </span>
        )}
      </div>
      {disabled ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {value || "未設定"}
        </p>
      ) : (
        <textarea
          id="pair-notes"
          value={draft}
          maxLength={maxLength}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() !== (value ?? "").trim()) onCommit(draft.trim());
          }}
          className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
    </div>
  );
}
