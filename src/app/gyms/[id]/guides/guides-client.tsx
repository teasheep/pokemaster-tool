"use client";

// 攻略庫 — 極簡共筆: 屬性篩選 chips + 卡片清單 + 新增/編輯 slideover。
// 內容是純文字 (換行保留), 網址自動變連結。

import { useMemo, useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TypeBadge, TypeIcon } from "@/components/sync-pair-badges";
import { ALL_TYPES, TYPE_LABELS } from "@/data/sync-pairs";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Database, SyncPairType } from "@/lib/supabase/types";

type GuideRow = Database["public"]["Tables"]["gym_guides"]["Row"];

/** 純文字 → 段落, 網址自動變超連結 */
function GuideBody({ content }: { content: string }) {
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-600 underline underline-offset-2 hover:text-sky-500 dark:text-sky-400"
          >
            {p}
          </a>
        ) : (
          p
        )
      )}
    </p>
  );
}

export function GuidesClient({
  gymId,
  userId,
  isAdmin,
  authorName,
  initialGuides,
}: {
  gymId: string;
  userId: string;
  isAdmin: boolean;
  authorName: string | null;
  initialGuides: GuideRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [guides, setGuides] = useState(initialGuides);
  const [scope, setScope] = useState<SyncPairType | "all">("all");
  const [editing, setEditing] = useState<GuideRow | "new" | null>(null);
  const [draft, setDraft] = useState<{ title: string; type: SyncPairType | null; content: string }>(
    { title: "", type: null, content: "" }
  );
  const [busy, setBusy] = useState(false);

  const refetch = async () => {
    const { data } = await supabase
      .from("gym_guides")
      .select("*")
      .eq("gym_id", gymId)
      .order("updated_at", { ascending: false });
    if (data) setGuides(data);
  };

  const visible = scope === "all" ? guides : guides.filter((g) => g.type === scope);
  const countOf = (t: SyncPairType) => guides.filter((g) => g.type === t).length;

  function startNew() {
    setDraft({ title: "", type: scope === "all" ? null : scope, content: "" });
    setEditing("new");
  }

  function startEdit(g: GuideRow) {
    setDraft({ title: g.title, type: g.type, content: g.content });
    setEditing(g);
  }

  async function save() {
    if (!draft.title.trim()) {
      toast.error("請填標題");
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        const { error } = await supabase.from("gym_guides").insert({
          gym_id: gymId,
          title: draft.title.trim(),
          type: draft.type,
          content: draft.content,
          created_by: userId,
          author_name: authorName,
        });
        if (error) throw error;
      } else if (editing) {
        const { error } = await supabase
          .from("gym_guides")
          .update({ title: draft.title.trim(), type: draft.type, content: draft.content })
          .eq("id", editing.id);
        if (error) throw error;
      }
      toast.success("已儲存攻略");
      setEditing(null);
      await refetch();
    } catch (e) {
      toast.error("儲存失敗", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: GuideRow) {
    const { error } = await supabase.from("gym_guides").delete().eq("id", g.id);
    if (error) toast.error("刪除失敗", { description: error.message });
    else {
      toast.success("已刪除");
      await refetch();
    }
  }

  return (
    <div className="space-y-4">
      {/* 屬性篩選 + 新增 */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => setScope("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-all active:scale-95",
            scope === "all"
              ? "border-primary bg-accent font-medium shadow-sm"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          全部 {guides.length}
        </button>
        {ALL_TYPES.filter((t) => countOf(t) > 0 || scope === t).map((t) => (
          <button
            key={t}
            onClick={() => setScope(t)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-all active:scale-95",
              scope === t
                ? "border-primary bg-accent font-medium shadow-sm"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <TypeIcon type={t} className="h-3.5 w-3.5" />
            {TYPE_LABELS[t]}
            <span className="tabular-nums">{countOf(t)}</span>
          </button>
        ))}
        <Button size="sm" className="ml-auto h-8" onClick={startNew}>
          <Plus className="mr-1 h-4 w-4" />
          新增攻略
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-muted-foreground">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm">還沒有攻略 — 把 LINE 上散落的打法貼過來吧</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((g) => {
            const canEdit = g.created_by === userId || isAdmin;
            return (
              <article key={g.id} className="rounded-xl border p-3.5 transition-shadow hover:shadow-sm">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {g.type ? <TypeBadge type={g.type} /> : null}
                  <h2 className="font-semibold">{g.title}</h2>
                  <span className="ml-auto flex items-center gap-1">
                    {canEdit ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => startEdit(g)}
                          title="編輯"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => void remove(g)}
                          title="刪除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </span>
                </div>
                <GuideBody content={g.content} />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {g.author_name ?? "匿名"} ・ {new Date(g.updated_at).toLocaleDateString("zh-TW")}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {/* 新增 / 編輯 slideover */}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing === "new" ? "新增攻略" : "編輯攻略"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">標題</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="例: 火關雙寶 3 手速刷"
                maxLength={60}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">屬性 (選填)</Label>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, type: null }))}
                  className={cn(
                    "rounded-full border px-2 py-1 text-xs transition-all",
                    draft.type === null
                      ? "border-primary bg-accent font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  通用
                </button>
                {ALL_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, type: t }))}
                    title={TYPE_LABELS[t]}
                    className={cn(
                      "rounded-full border p-1 transition-all",
                      draft.type === t
                        ? "border-primary bg-accent shadow-sm"
                        : "border-transparent opacity-50 hover:opacity-100"
                    )}
                  >
                    <TypeIcon type={t} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                內容 (貼網址會自動變連結)
              </Label>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                rows={10}
                maxLength={4000}
                placeholder={"手順、注意事項、影片連結…\n例:\n1. 首抽開盾\n2. 第二棒降抗 2 層\nhttps://youtu.be/..."}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                儲存
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                取消
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
