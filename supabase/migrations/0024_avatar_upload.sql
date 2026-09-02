-- 0024: 成員頭貼改上傳圖片 (取代拍組頭像)
-- gym_members.avatar_url = Supabase Storage 公開網址 (avatars bucket, 檔名 = auth uid)
-- 上傳走瀏覽器直傳 (storage RLS: 只能寫自己 uid 開頭的檔案), 公開 bucket 免讀取政策。

alter table public.gym_members
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name like auth.uid()::text || '%');

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name like auth.uid()::text || '%')
  with check (bucket_id = 'avatars' and name like auth.uid()::text || '%');
