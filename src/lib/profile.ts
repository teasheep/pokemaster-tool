"use client";

// 個人檔案 (profiles) 的共用寫入 — /welcome 首次設定與 /profile 個人設定共用。
// profiles 是跨道館的個人身分; 有道館成員身分時同步一份到 gym_members (名單顯示用)。

import type { SupabaseClient } from "@supabase/supabase-js";

/** 檔案 → 256×256 方形 webp (中央裁切) — 瀏覽器端處理, 不吃伺服器資源 */
export async function toAvatarBlob(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("影像處理失敗"))), "image/webp", 0.9)
  );
}

/** 上傳頭貼到 Storage 並回傳公開網址 (檔名 = uid, 帶版本參數破快取) */
export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<string> {
  const blob = await toAvatarBlob(file);
  const path = `${userId}.webp`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { upsert: true, contentType: "image/webp" });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export type ProfilePatch = {
  display_name?: string;
  line_name?: string | null;
  avatar_url?: string;
  onboarded_at?: string;
};

/** 寫 profiles + 同步 gym_members (自己那些列) */
export async function saveProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: ProfilePatch
): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
  // 道館成員名單顯示用的鏡像 (RLS gym_members_update_self 只允許改自己的列)
  const mirror: Record<string, string | null> = {};
  if (patch.display_name !== undefined) mirror.display_name = patch.display_name;
  if (patch.line_name !== undefined) mirror.line_name = patch.line_name;
  if (patch.avatar_url !== undefined) mirror.avatar_url = patch.avatar_url;
  if (Object.keys(mirror).length > 0) {
    await supabase.from("gym_members").update(mirror).eq("user_id", userId);
  }
}
