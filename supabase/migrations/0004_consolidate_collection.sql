-- 0004: 收斂收藏資料模型 + 安全性修正
--
-- 背景: 先前有兩套不互通的「使用者收藏」:
--   - 舊 MVP: sync_pairs (numeric id + slug) + user_pairs (FK sync_pair_id)
--   - 新版:   user_collection (text pair_id = brybry 11 碼) + JSON catalog
-- /pairs 寫 user_collection, 但 /upload 匯入、/inventory、首頁、/share 全走 user_pairs,
-- 兩邊看不到對方的資料。本 migration 把 user_collection 定為唯一收藏表, 補齊缺的欄位,
-- 把舊資料搬過去, 然後退役 sync_pairs / user_pairs / get_shared_pairs。
-- 在 0001 / 0002 / 0003 之後執行。

-- ====================================================================
-- 1. 安全性: shares 表不該對 anon 公開 SELECT
--    (using(true) 會讓任何人用 anon key 枚舉全平台 token + user_id)
--    token 解析一律走 get_shared_collection SECURITY DEFINER RPC。
-- ====================================================================
drop policy if exists "shares_public_read_by_token" on public.shares;

-- 分享連結預設 90 天到期 (既有 row 不受影響; UI 仍可自行覆寫)
alter table public.shares
  alter column expires_at set default (now() + interval '90 days');

-- ====================================================================
-- 2. user_collection 補欄位 (對齊 OCR 匯入流程送的練度)
-- ====================================================================
alter table public.user_collection
  add column if not exists move_level int not null default 1 check (move_level between 1 and 5),
  add column if not exists sync_level int not null default 1 check (sync_level between 1 and 5),
  add column if not exists lucky_skills text[] not null default '{}';

-- ====================================================================
-- 3. 把舊 user_pairs 資料搬進 user_collection (string pairId 來自 slug 去掉 poma- 前綴)
--    沒有舊資料時這段是 no-op。
-- ====================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_pairs'
  ) then
    insert into public.user_collection
      (user_id, pair_id, owned, level, promotion, potential, super_awakening, ex_unlocked, move_level, sync_level, lucky_skills, notes)
    select
      up.user_id,
      replace(sp.slug, 'poma-', ''),
      true,
      least(greatest(up.level, 1), 200),
      least(greatest(up.star_level, 1), 6),
      0,
      least(greatest(up.super_awakening, 0), 5),
      up.ex_unlocked,
      least(greatest(up.move_level, 1), 5),
      least(greatest(up.sync_level, 1), 5),
      coalesce(up.lucky_skills, '{}'),
      up.notes
    from public.user_pairs up
    join public.sync_pairs sp on sp.id = up.sync_pair_id
    where sp.slug like 'poma-%'
    on conflict (user_id, pair_id) do nothing;
  end if;
end $$;

-- ====================================================================
-- 4. get_shared_collection: 補回 move_level / sync_level
--    (return type 變更需先 drop 再建)
-- ====================================================================
drop function if exists public.get_shared_collection(text);

create function public.get_shared_collection(p_token text)
returns table (
  pair_id text,
  owned boolean,
  level int,
  promotion int,
  potential int,
  super_awakening int,
  ex_unlocked boolean,
  move_level int,
  sync_level int
)
language sql
security definer
set search_path = public
as $$
  select c.pair_id, c.owned, c.level, c.promotion, c.potential,
         c.super_awakening, c.ex_unlocked, c.move_level, c.sync_level
  from public.shares s
  join public.user_collection c on c.user_id = s.user_id
  where s.token = p_token
    and c.owned = true
    and (s.expires_at is null or s.expires_at > now());
$$;

grant execute on function public.get_shared_collection(text) to anon, authenticated;

-- ====================================================================
-- 5. 退役舊模型 (catalog 已改由 JSON 提供, sync_pairs/user_pairs 不再使用)
-- ====================================================================
drop function if exists public.get_shared_pairs(text);
drop table if exists public.user_pairs;
drop table if exists public.sync_pairs;
