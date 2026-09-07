"use client";

// 建立賽事 — 放在「道館賽一覽」標題列右側。
// (原本只存在於沒有分頁的道館總覽頁, 一般人根本找不到)
//
// 可以套用**系統層級的模板** (lib/gym/battle-templates.ts): 遊戲每一回道館對戰的
// 8 關弱點屬性是固定的, 選一個就一次填好, 不用建立完再一格一格點 8 次。
// 「先不套用」永遠留著 —— 遊戲開了新的一回而模板還沒補上時, 那是唯一能用的路。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeIcon } from "@/components/sync-pair-badges";
import { TYPE_LABELS } from "@/data/sync-pairs";
import { BATTLE_TEMPLATES, battleTemplate } from "@/lib/gym/battle-templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function CreateBattleButton({ gymId }: { gymId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  /** 選了模板但名稱是自己打的 → 不要覆蓋他 */
  const [nameTouched, setNameTouched] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const template = battleTemplate(templateId);

  function pickTemplate(id: string | null) {
    setTemplateId(id);
    // 模板名稱直接當賽事名稱的預設值 —— 使用者自己打過就不動
    const t = battleTemplate(id);
    if (t && !nameTouched) setName(t.name);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("請輸入賽事名稱");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("gym_battles")
        .insert({ gym_id: gymId, name: trimmed })
        .select("id")
        .single();
      if (error || !data) {
        toast.error("建立失敗", { description: error?.message });
        return;
      }

      // 8 關由 DB trigger 在上面那筆 insert 之後自動開好 (屬性預設 normal),
      // 所以這裡是 upsert 覆蓋而不是新增 —— 走 (battle_id, seq) 的唯一鍵, 一趟就好。
      if (template) {
        const { error: stageErr } = await supabase.from("battle_stages").upsert(
          template.types.map((weak_type, i) => ({
            gym_id: gymId,
            battle_id: data.id,
            seq: i + 1,
            weak_type,
          })),
          { onConflict: "battle_id,seq" }
        );
        // 賽事已經建起來了 —— 屬性沒套用不是致命錯誤, 講清楚讓他自己補就好,
        // 不要把整個動作當成失敗 (那會讓人以為要重建一場)
        if (stageErr) {
          toast.warning("賽事建好了, 但屬性沒套用成功", {
            description: "可以在賽事頁自己選 8 關的屬性。",
          });
        }
      }

      setOpen(false);
      setName("");
      setNameTouched(false);
      setTemplateId(null);
      router.push(`/gyms/${gymId}/battles/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-tour="battle-create">
          <Plus className="mr-1 h-4 w-4" />
          建立賽事
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>建立賽事</DialogTitle>
          <DialogDescription>
            一回帕希歐道館對戰。選一個模板就會把 8 關的弱點屬性一起填好。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>套用模板</Label>
          <div className="grid gap-1.5" data-tour="battle-template">
            {BATTLE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTemplate(templateId === t.id ? null : t.id)}
                aria-pressed={templateId === t.id}
                className={cn(
                  "flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors",
                  templateId === t.id
                    ? "border-primary bg-accent"
                    : "hover:bg-accent/50"
                )}
              >
                <span className="text-sm font-medium">{t.name}</span>
                {/* 8 顆屬性 icon = 這個模板到底會填什麼, 選之前就看得到 */}
                <span className="flex flex-wrap items-center gap-0.5">
                  {t.types.map((ty, i) => (
                    <TypeIcon key={i} type={ty} className="h-4 w-4" />
                  ))}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => pickTemplate(null)}
              aria-pressed={templateId === null}
              className={cn(
                "min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                templateId === null ? "border-primary bg-accent" : "hover:bg-accent/50"
              )}
            >
              先不套用
              <span className="ml-2 text-xs text-muted-foreground">
                8 關都是「{TYPE_LABELS.normal}」, 建立後自己選
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="battle-name">賽事名稱</Label>
          <Input
            id="battle-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="例: 第3回 城都館主"
            maxLength={50}
          />
        </div>

        <DialogFooter>
          <Button onClick={create} disabled={busy}>
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
