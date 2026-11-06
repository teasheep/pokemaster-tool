-- 0086: 每位成員「拍組最後更新」的時間 (名冊第二行 + 成員明細)
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-11-05 使用者:「幫我加一個成員最後更新拍組的時間在每個成員的名字後面 然後側邊欄顯示在第二行
--   …用區間來顯示 但點進去以後還是會有精確的更新日期和時間」
--
-- **時間取帳號那一份 (user_collection.updated_at), 不取道館的鏡像 (member_pairs.updated_at)**。
-- 2026-11-05 對線上那一館逐人比過三個來源 (鏡像 / 道館紀錄的 pair / 帳號):
--   - 鏡像會被「不是本人做的事」蓋掉: 0080 那次全員同步 (10/01) 一次改了 2,597 列 ——
--     老人 / 大智肉魚 / 樓樓屋實際是 9/28-9/30 改的, 鏡像卻都是 10/01;
--     backfill_my_member_pairs 補鏡像也會晚幾個小時 (傑瑞帳號 11/02、鏡像 11/04)。
--   - 道館紀錄只記寶數與超覺醒 (改等級 / 星數 / 潛能不記), 而且一般成員的 RLS 只讀得到自己的那幾筆。
--   - 帳號那一份: 本人在 /pairs 改、管理員代改 (set_member_pair 會一併寫帳號, 0030/0031) 都會動到,
--     任何一個欄位改了都算, 而且沒有被腳本整批洗過 (最近一次整批是 09/29, 每個人都比那晚)。
--   拍組本來就跟著帳號走 (0080) —— 這個時間回答的正是「他的拍組上次動是什麼時候」。
-- 沒綁帳號的成員 (只有管理員代填的那份) 才退回鏡像的時間。
--
-- user_collection 是 own-rows only, 道館端讀不到 → 做成 security definer。只回「時間」一個值,
-- 不回任何拍組內容; 呼叫者必須是這一館的成員 (is_gym_member 只認 status = 'active', 0071)。
-- **顧問與待確認的人不回** —— 他們的練度不屬於這一館 (0072 / 0071), 名冊上也不畫這一行。

create or replace function public.gym_pairs_last_updated(p_gym uuid)
returns table (member_id uuid, updated_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select m.id,
         coalesce(
           (select max(c.updated_at) from public.user_collection c where c.user_id = m.user_id),
           (select max(mp.updated_at) from public.member_pairs mp where mp.member_id = m.id)
         )
    from public.gym_members m
   where m.gym_id = p_gym
     and m.status = 'active'
     and m.role <> 'advisor'
     and public.is_gym_member(p_gym);
$$;

-- Supabase 的 default privileges 會把 EXECUTE 授給 anon —— 只 revoke public 無效 (見 0050)
revoke all on function public.gym_pairs_last_updated(uuid) from public, anon;
grant execute on function public.gym_pairs_last_updated(uuid) to authenticated;
