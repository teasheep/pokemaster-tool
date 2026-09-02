"use client";

// 分享連結管理 — 重用既有連結 (不再每按一次就長一條), 可複製/開啟/停用/重新產生。

import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export function ShareDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token ? `${window.location.origin}/share/${token}` : "";

  /** 開啟時: 有既有連結就用它, 沒有才建一條 */
  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next || token) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("請先登入");
        return;
      }
      const { data: existing } = await supabase
        .from("shares")
        .select("token, expires_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        setToken(existing.token);
        setExpiresAt(existing.expires_at);
        return;
      }
      const { data, error } = await supabase
        .from("shares")
        .insert({ user_id: user.id })
        .select("token, expires_at")
        .single();
      if (error || !data) {
        toast.error("建立分享連結失敗", { description: error?.message });
        return;
      }
      setToken(data.token);
      setExpiresAt(data.expires_at);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("已複製連結");
    } catch {
      toast.error("複製失敗", { description: url });
    }
  }

  /** 停用: 刪掉現有連結 (舊網址立刻失效) */
  async function revoke() {
    if (!token) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("shares").delete().eq("token", token);
    setBusy(false);
    if (error) {
      toast.error("停用失敗", { description: error.message });
      return;
    }
    setToken(null);
    setExpiresAt(null);
    toast.success("連結已停用 — 舊網址不再有效");
  }

  /** 重新產生: 停用舊的並建新的 */
  async function regenerate() {
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    await supabase.from("shares").delete().eq("user_id", user.id);
    const { data, error } = await supabase
      .from("shares")
      .insert({ user_id: user.id })
      .select("token, expires_at")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("重新產生失敗", { description: error?.message });
      return;
    }
    setToken(data.token);
    setExpiresAt(data.expires_at);
    toast.success("已產生新連結 (舊的失效)");
  }

  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" onClick={() => void onOpenChange(true)} disabled={disabled}>
        <Share2 className="mr-1 h-4 w-4" />
        分享
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享我的拍組收藏</DialogTitle>
          <DialogDescription>
            拿到連結的人不用登入就能看你的收藏 (唯讀, 只包含已持有的拍組)。
          </DialogDescription>
        </DialogHeader>

        {busy && !token ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            準備連結中…
          </div>
        ) : token ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button onClick={copy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {expiryText ? (
              <p className="text-xs text-muted-foreground">連結有效到 {expiryText}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" />
                  預覽
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
                <RefreshCw className="mr-1 h-4 w-4" />
                重新產生
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={revoke}
                disabled={busy}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" />
                停用連結
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">目前沒有有效的分享連結。</p>
            <Button onClick={regenerate} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              產生連結
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
