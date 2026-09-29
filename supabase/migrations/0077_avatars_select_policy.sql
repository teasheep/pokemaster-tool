-- 0077: avatars 補上 SELECT policy —— 頭貼上傳從來沒有成功過
--
-- 2026-09-29 成員回報「個人設定沒辦法上傳更改頭貼」。查下來:
--   線上 storage.objects 的 avatars bucket **一個檔都沒有**, 57 個有頭貼的人全是 Google 的圖。
--   用隔離測試帳號實測 (真的 JWT 打 storage API):
--     upload(upsert: true)  → `new row violates row-level security policy`   ← 站上的寫法
--     upload(upsert: false) → 成功
--   uploadAvatar() 一律 upsert:true (檔名固定 `{uid}.webp`, 換頭貼 = 覆蓋同一個檔)。
--   Supabase Storage 的 upsert 是 INSERT … ON CONFLICT DO UPDATE … RETURNING,
--   **需要 SELECT 權限** —— 0024 / 0052 只給了 INSERT 與 UPDATE, 所以每一次上傳都被 RLS 擋下。
--   (0052 的註解寫「storage.objects 一列都沒有, 沒有人走過這條上傳路徑」—— 那不是沒人用,
--    是從第一天就壞了。)
--
-- 範圍跟寫入 policy 一模一樣: 只看得到「自己的頭貼那一個檔」。
-- 頭貼的**讀取**走 public bucket 的公開網址 (getPublicUrl), 不經過這條 policy ——
-- 所以這裡不會讓任何人多讀到別人的東西, 也不必開 anon。
do $$
begin
  drop policy if exists avatars_select_own on storage.objects;
  create policy avatars_select_own on storage.objects
    for select to authenticated
    using (
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
    raise notice '0077: 沒有權限改 storage.objects 的 policy, 請改用 Dashboard 設定 (avatars 的 SELECT, 條件同 avatars_update)';
end;
$$;
