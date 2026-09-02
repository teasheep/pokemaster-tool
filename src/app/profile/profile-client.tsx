"use client";

// 個人設定: 頭貼上傳 + 遊戲名/社群名 (寫 profiles, 同步 gym_members)

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberAvatar } from "@/components/gym/member-card";
import { createClient } from "@/lib/supabase/client";
import { saveProfile, uploadAvatar } from "@/lib/profile";

export type ProfileInfo = {
  displayName: string;
  lineName: string | null;
  avatarUrl: string | null;
  /** 出沒時段 — 存在 gym_members (道館排刀要看), 不在 profiles */
  availability: string | null;
};

export function ProfileClient({
  userId,
  profile,
}: {
  userId: string;
  profile: ProfileInfo;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState(profile);
  const [uploading, setUploading] = useState(false);

  async function onPickAvatar(file: File) {
    setUploading(true);
    try {
      const url = await uploadAvatar(supabase, userId, file);
      await saveProfile(supabase, userId, { avatar_url: url });
      setInfo((i) => ({ ...i, avatarUrl: url }));
      toast.success("頭貼已更新");
    } catch (e) {
      toast.error("上傳失敗", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  /** 出沒時段只存在道館成員列 — RLS 只允許改自己的 */
  async function saveAvailability(value: string) {
    const v = value.trim() || null;
    const { error } = await supabase
      .from("gym_members")
      .update({ availability: v })
      .eq("user_id", userId);
    if (error) {
      toast.error("儲存失敗", { description: error.message });
      return;
    }
    setInfo((i) => ({ ...i, availability: v }));
    toast.success("已儲存");
  }

  async function saveField(field: "display_name" | "line_name", value: string) {
    const v = value.trim();
    if (field === "display_name" && !v) return;
    try {
      await saveProfile(
        supabase,
        userId,
        field === "display_name" ? { display_name: v } : { line_name: v || null }
      );
      setInfo((i) =>
        field === "display_name" ? { ...i, displayName: v } : { ...i, lineName: v || null }
      );
      toast.success("已儲存");
    } catch (e) {
      toast.error("儲存失敗", { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="更換頭貼"
          className="group relative rounded-full transition-transform hover:scale-105 active:scale-95"
        >
          <MemberAvatar
            member={{ id: userId, displayName: info.displayName, avatarUrl: info.avatarUrl }}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-1 h-4 w-4" />
            )}
            上傳頭貼
          </Button>
          <p className="text-xs text-muted-foreground">正方形裁切, 任何常見圖片格式都可以</p>
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
        <Label className="text-xs text-muted-foreground">遊戲名稱</Label>
        <Input
          key={`dn-${info.displayName}`}
          defaultValue={info.displayName}
          maxLength={20}
          onBlur={(e) => {
            if (e.target.value.trim() !== info.displayName)
              void saveField("display_name", e.target.value);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          社群名稱 (LINE 名; 與遊戲名不同才會以括號顯示)
        </Label>
        <Input
          key={`ln-${info.lineName ?? ""}`}
          defaultValue={info.lineName ?? ""}
          maxLength={20}
          onBlur={(e) => {
            if ((e.target.value.trim() || null) !== info.lineName)
              void saveField("line_name", e.target.value);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">出沒時段 (道館戰協調參考)</Label>
        <Input
          key={`av-${info.availability ?? ""}`}
          defaultValue={info.availability ?? ""}
          maxLength={100}
          placeholder="例: 平日 12-14, 22-24 / 夜班 00-08"
          onBlur={(e) => {
            if ((e.target.value.trim() || null) !== info.availability)
              void saveAvailability(e.target.value);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">改動即時儲存 (離開輸入框時)</p>
    </div>
  );
}
