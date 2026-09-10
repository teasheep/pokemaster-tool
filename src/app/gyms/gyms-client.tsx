"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Plus, Shield, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { readGymRpc } from "@/lib/gym/gym-rpc";
import type { PendingGym } from "@/lib/gym/membership";

type GymListItem = {
  id: string;
  name: string;
  isAdmin: boolean;
  memberCount: number;
};

export function GymsClient({
  gyms,
  pending = [],
}: {
  gyms: GymListItem[];
  /** 送出了但管理員還沒確認的申請 (0071) — 這些**還不是**我的道館, 點不進去 */
  pending?: PendingGym[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gymName, setGymName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  /** 建館碼 (封測) — 一組只能用一次, 由作者發 */
  const [createCode, setCreateCode] = useState("");

  async function handleCreate() {
    if (!gymName.trim()) {
      toast.error("請輸入道館名稱");
      return;
    }
    if (!createCode.trim()) {
      toast.error("請輸入建館碼");
      return;
    }
    setBusy(true);
    try {
      // 原子地 認領建館碼 + 建道館 + 自己成為管理員 (名字取自個人設定)
      const { data, error } = await supabase.rpc("create_gym", {
        p_name: gymName.trim(),
        p_code: createCode.trim(),
      });
      const res = readGymRpc(data, error);
      if (res.error) {
        toast.error("建立道館失敗", { description: res.error });
        return;
      }
      setCreateOpen(false);
      router.push(`/gyms/${res.gymId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("join_gym", { p_code: inviteCode.trim() });
      const res = readGymRpc(data, error);
      if (res.error) {
        toast.error("加入失敗", { description: res.error });
        return;
      }
      setJoinOpen(false);
      setInviteCode("");
      // 0071: 貼碼只是送出申請, 管理員按確認之後才進得去。
      // **這裡不能 push 進道館** —— 待確認的人讀不到那一館的任何資料, 進去只會看到
      // 「找不到道館或你不是成員」, 而他其實什麼都沒做錯。
      if (res.pending) {
        toast.success("已送出加入申請", { description: "等管理員確認後就會出現在這裡" });
        router.refresh();
        return;
      }
      toast.success("已加入道館");
      router.push(`/gyms/${res.gymId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-tour="gym-create">
              <Plus className="mr-1 h-4 w-4" />
              建立道館
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>建立道館</DialogTitle>
              {/* 這句與教學卡片、錯誤訊息講的是同一件事, 三處用同一組字 */}
              <DialogDescription>
                目前為封測，需要作者提供的建館碼，一組只能用一次。你會成為管理員，建立後可用邀請碼邀請成員。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gym-name">道館名稱</Label>
                <Input
                  id="gym-name"
                  value={gymName}
                  onChange={(e) => setGymName(e.target.value)}
                  placeholder="例: 館主跑路自救會"
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gym-create-code">建館碼</Label>
                {/* 等寬 + 全大寫顯示: 與邀請碼欄位同一種手感 (碼本身大小寫不敏感, RPC 會正規化) */}
                <Input
                  id="gym-create-code"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="12 碼"
                  maxLength={12}
                  autoCapitalize="characters"
                  className="font-mono uppercase"
                  data-tour="gym-create-code"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={busy}>
                建立
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-tour="gym-join">
              <Users className="mr-1 h-4 w-4" />
              用邀請碼加入
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>加入道館</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="join-code">邀請碼</Label>
                <Input
                  id="join-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="例: 36AF69F6"
                  className="font-mono uppercase"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleJoin} disabled={busy}>
                加入
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {pending.length > 0 ? <PendingGyms pending={pending} /> : null}

      {gyms.length === 0 ? (
        pending.length > 0 ? null : (
          <p className="text-sm text-muted-foreground">
            還沒有加入任何道館 — 建立一個, 或向管理員要邀請碼。
          </p>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gyms.map((g) => (
            <Link key={g.id} href={`/gyms/${g.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-amber-500" />
                    {g.name}
                  </CardTitle>
                  <CardDescription>
                    {g.memberCount} 位成員{g.isAdmin ? " ・ 管理員" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 「等管理員確認」的申請卡 (0071)。
 *
 * 刻意**不是** `<Link>`: 點進去只會看到「找不到道館或你不是成員」, 而那句話對
 * 一個乖乖貼了碼的人來說是錯的訊息。這裡要講的只有兩件事 —— 你申請的是哪一館,
 * 以及球在管理員那邊。
 */
function PendingGyms({ pending }: { pending: PendingGym[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(gymId: string) {
    setBusy(gymId);
    try {
      const { error } = await supabase.rpc("cancel_join_request", { p_gym: gymId });
      if (error) {
        toast.error("取消失敗", { description: error.message });
        return;
      }
      toast.success("已取消申請");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">等待確認</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((p) => (
          <Card key={p.gymId} className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                {p.gymName}
              </CardTitle>
              <CardDescription>
                {p.role === "advisor" ? "顧問申請" : "成員申請"}・等管理員確認
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                disabled={busy === p.gymId}
                onClick={() => void cancel(p.gymId)}
              >
                取消申請
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
