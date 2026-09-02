-- 2026-05 補上超覺醒 (super awakening) 欄位 + 解除等級上限 (150 → 200)
-- 為什麼: 6★EX 超覺醒拍組可以練到 Lv 200; 超覺醒等級 0-5 是獨立屬性 (不是星級也不是寶數)。
-- 這份 migration 要在 0001/0002 之後跑。

alter table public.user_pairs
  drop constraint if exists user_pairs_level_check,
  add constraint user_pairs_level_check check (level between 1 and 200);

alter table public.user_pairs
  add column if not exists super_awakening int not null default 0
  check (super_awakening between 0 and 5);

-- 同步擴充 get_shared_pairs (回傳新增欄位)
-- 回傳型別變更, create or replace 不允許 → 先 drop (0004 最終會退役此函式)
drop function if exists public.get_shared_pairs(text);

create function public.get_shared_pairs(p_token text)
returns table (
  sync_pair_id bigint,
  star_level int,
  level int,
  move_level int,
  sync_level int,
  ex_unlocked boolean,
  super_awakening int,
  lucky_skills text[],
  notes text,
  trainer_name text,
  pokemon_name text,
  display_name_zh text,
  type sync_pair_type,
  role sync_pair_role
)
language sql
security definer
set search_path = public
as $$
  select
    up.sync_pair_id,
    up.star_level,
    up.level,
    up.move_level,
    up.sync_level,
    up.ex_unlocked,
    up.super_awakening,
    up.lucky_skills,
    up.notes,
    sp.trainer_name,
    sp.pokemon_name,
    sp.display_name_zh,
    sp.type,
    sp.role
  from public.shares s
  join public.user_pairs up on up.user_id = s.user_id
  join public.sync_pairs sp on sp.id = up.sync_pair_id
  where s.token = p_token
    and (s.expires_at is null or s.expires_at > now());
$$;
