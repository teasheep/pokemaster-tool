-- 0052: avatars bucket 補上 MIME 白名單 / 大小上限 / 檔名收斂
--
-- 為什麼要有這支:
--   0024 把 avatars 建成 `public: true` 的 bucket, 寫入 policy 只比對檔名前綴
--   (`name like auth.uid()::text || '%'`), 而 storage.buckets 的
--   allowed_mime_types 與 file_size_limit 都是 null (已用線上 DB 查證)。
--   結果: 任何登入者都能往一個**對外公開**的 bucket 塞任意型別、任意大小的檔案,
--   而且因為只比前綴, 同一個人可以無限量長出 `{uid}1.webp`、`{uid}xxx.zip`… 佔用空間。
--   公開 bucket + 任意檔案 = 免費的檔案託管 / 圖床, 也是散佈內容的管道。
--
-- 數值怎麼定的 (對照 src/lib/profile.ts, 不要擋掉現有功能):
--   toAvatarBlob() 一律在瀏覽器端裁成 256×256 並輸出 `image/webp` (quality 0.9),
--   uploadAvatar() 用 `${userId}.webp` + upsert:true + contentType "image/webp"。
--   256×256 的 webp 實際只有幾十 KB, 512KB (524288) 上限有十倍以上餘裕。
--   MIME 白名單放 webp/png/jpeg —— webp 是現在唯一會用到的, png/jpeg 留給日後
--   換掉 canvas 轉檔時不用再改 DB。
--
-- 套用後會不會影響現有功能: 不會。
--   查證過線上 storage.objects **一列都沒有** (所有 bucket 合計 0 個物件) ——
--   目前 profiles.avatar_url 上的兩筆都是 Google OAuth 的 lh3.googleusercontent.com 網址,
--   沒有人走過這條上傳路徑。所以這裡收緊不會讓任何既有檔案變成讀不到或改不動。
--   bucket 維持 public: true (getPublicUrl 要用), 讀取行為完全不變。

-- ── 1. bucket 層級的硬限制 (storage API 在收檔時就擋掉, 不必等 RLS) ──
do $$
begin
  update storage.buckets
     set file_size_limit = 524288,                                        -- 512 KB
         allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg']
   where id = 'avatars';
exception
  when insufficient_privilege then
    -- storage.buckets 屬於 supabase_storage_admin; 若這條連線的角色改不動,
    -- 請改在 Supabase Dashboard → Storage → avatars → Settings 手動填同樣的兩個值。
    raise notice '0052: 沒有權限改 storage.buckets, 請改用 Dashboard 設定 avatars 的大小上限與 MIME 白名單';
end;
$$;

-- ── 2. 寫入 policy: 從「前綴」收斂成「就是自己的頭貼那一個檔」 ──
-- 前綴比對讓一個人可以無限量建檔; 實際上 uploadAvatar 只會寫 `{uid}.webp` 這一個路徑。
-- 副檔名跟上面的 MIME 白名單對齊, 之後若客戶端改輸出格式, 兩處要一起改。
do $$
begin
  drop policy if exists avatars_insert on storage.objects;
  create policy avatars_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'avatars'
      and name in (
        auth.uid()::text || '.webp',
        auth.uid()::text || '.png',
        auth.uid()::text || '.jpg',
        auth.uid()::text || '.jpeg'
      )
    );

  drop policy if exists avatars_update on storage.objects;
  create policy avatars_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'avatars'
      and name in (
        auth.uid()::text || '.webp',
        auth.uid()::text || '.png',
        auth.uid()::text || '.jpg',
        auth.uid()::text || '.jpeg'
      )
    )
    with check (
      bucket_id = 'avatars'
      and name in (
        auth.uid()::text || '.webp',
        auth.uid()::text || '.png',
        auth.uid()::text || '.jpg',
        auth.uid()::text || '.jpeg'
      )
    );
exception
  when insufficient_privilege then
    raise notice '0052: 沒有權限改 storage.objects 的 policy, 請改用 Dashboard 設定';
end;
$$;
