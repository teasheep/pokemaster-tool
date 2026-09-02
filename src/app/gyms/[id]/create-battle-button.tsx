"use client";

// 建立賽事 — 放在「道館賽一覽」標題列右側。
// (原本只存在於沒有分頁的道館總覽頁, 一般人根本找不到)

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
import { createClient } from "@/lib/supabase/client";

export function CreateBattleButton({ gymId }: { gymId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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
      setOpen(false);
      setName("");
      router.push(`/gyms/${gymId}/battles/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          建立賽事
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>建立賽事</DialogTitle>
          <DialogDescription>
            一回帕希歐道館對戰。建立後在賽事頁設定 8 關的弱點屬性。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="battle-name">賽事名稱</Label>
          <Input
            id="battle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
