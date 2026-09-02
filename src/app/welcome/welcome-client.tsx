"use client";

// 首次登入設定: 頭貼 + 遊戲名/社群名 (+ 尚未入館者可直接輸入邀請碼)
// 完成後寫 profiles.onboarded_at, 之後登入不再進來。

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberAvatar } from "@/components/gym/member-card";
import { createClient } from "@/lib/supabase/client";
import { saveProfile, uploadAvatar } from "@/lib/profile";

const JOIN_ERRORS: Record<string, string> = {
  INVALID_CODE: "邀請碼無效",
};

export function WelcomeClient({
  userId,
  next,
  initial,
  hasGym,
}: {
  userId: string;
  next: string;
  initial: { displayName: string; lineName: string | null; avatarUrl: string | null };
  hasGym: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [lineName, setLineName] = useState(initial.lineName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [inviteCode, setInviteCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onPickAvatar(file: File) {
    setUploading(true);
    try {
      const url = await uploadAvatar(supabase, userId, file);
      setAvatarUrl(url);
      toast.success("頭貼已上傳");
    } catch (e) {
      toast.error("上傳失敗", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  async function finish() {
    const name = displayName.trim();
    if (!name) {
      toast.error("請填遊戲名稱");
      return;
    }
    setSaving(true);
    try {
      await saveProfile(supabase, userId, {
        display_name: name,
        line_name: lineName.trim() || null,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        onboarded_at: new Date().toISOString(),
      });
      // 尚未入館且填了邀請碼 → 直接加入 (RPC 會把 profile 帶進成員列)
      const code = inviteCode.trim();
      if (!hasGym && code) {
        const { data, error } = await supabase.rpc("join_gym", { p_code: code });
        if (error) {
          const key = Object.keys(JOIN_ERRORS).find((k) => error.message.includes(k));
          toast.error("加入道館失敗", { description: key ? JOIN_ERRORS[key] : error.message });
          setSaving(false);
          return;
        }
        toast.success("已加入道館");
        router.push(`/gyms/${data}`);
        router.refresh();
        return;
      }
      toast.success("設定完成");
      router.push(hasGym ? next : "/gyms");
      router.refresh();
    } catch (e) {
      toast.error("儲存失敗", { description: e instanceof Error ? e.message : undefined });
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="上傳頭貼"
          className="group relative rounded-full transition-transform hover:scale-105 active:scale-95"
        >
          <MemberAvatar
            member={{ id: userId, displayName: displayName || "?", avatarUrl }}
            size="lg"
            className="h-20 w-20 text-2xl"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-60">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            ) : (
              <Camera className="h-6 w-6 text-white" />
            )}
          </span>
        </button>
        <div className="space-y-1">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}
            上傳頭貼
          </Button>
          <p className="text-xs text-muted-foreground">可略過 — 之後在個人設定隨時能改</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickAvatar(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label>遊戲名稱 *</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="遊戲裡的暱稱"
          maxLength={20}
        />
      </div>

      <div className="space-y-1.5">
        <Label>社群名稱</Label>
        <Input
          value={lineName}
          onChange={(e) => setLineName(e.target.value)}
          placeholder="LINE 顯示名 (與遊戲名不同才需要填)"
          maxLength={20}
        />
      </div>

      {!hasGym ? (
        <div className="space-y-1.5">
          <Label>道館邀請碼</Label>
          <Input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="向管理員索取 (之後也能在道館列表輸入)"
            className="font-mono tracking-widest"
          />
        </div>
      ) : null}

      <Button onClick={finish} disabled={saving} className="w-full">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        完成設定
      </Button>
    </div>
  );
}
