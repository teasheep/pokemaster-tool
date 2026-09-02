-- 0002: 使用者收藏 (brybry string pairId 版本)
-- 獨立於舊的 numeric sync_pairs / user_pairs — catalog 改由 brybry JSON 提供,
-- 這裡只存「使用者擁有狀態 + 練度」, 用 brybry 的 11-digit string pairId 當 key。

create table if not exists public.user_collection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pair_id text not null,                         -- brybry trainerId (11-digit string)
  owned boolean not null default true,
  level int not null default 1 check (level between 1 and 200),
  promotion int not null default 5 check (promotion between 1 and 6),       -- 星數 (升級後當前星)
  potential int not null default 0 check (potential between 0 and 5),       -- 寶 (招式盤)
  super_awakening int not null default 0 check (super_awakening between 0 and 5), -- 超覺醒
  ex_unlocked boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pair_id)
);

create index if not exists user_collection_user_idx on public.user_collection (user_id);

alter table public.user_collection enable row level security;

drop policy if exists "user_collection_select_own" on public.user_collection;
create policy "user_collection_select_own" on public.user_collection
  for select using (auth.uid() = user_id);

drop policy if exists "user_collection_insert_own" on public.user_collection;
create policy "user_collection_insert_own" on public.user_collection
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_collection_update_own" on public.user_collection;
create policy "user_collection_update_own" on public.user_collection
  for update using (auth.uid() = user_id);

drop policy if exists "user_collection_delete_own" on public.user_collection;
create policy "user_collection_delete_own" on public.user_collection
  for delete using (auth.uid() = user_id);

-- updated_at 自動維護 (set_updated_at 已在 0001 建立)
drop trigger if exists user_collection_set_updated_at on public.user_collection;
create trigger user_collection_set_updated_at
  before update on public.user_collection
  for each row execute function public.set_updated_at();

-- 公開分享: 用 token 拿某人的收藏 (回傳 pair_id + 練度, catalog 由前端用 JSON 補)
create or replace function public.get_shared_collection(p_token text)
returns table (
  pair_id text,
  owned boolean,
  level int,
  promotion int,
  potential int,
  super_awakening int,
  ex_unlocked boolean
)
language sql
security definer
set search_path = public
as $$
  select c.pair_id, c.owned, c.level, c.promotion, c.potential, c.super_awakening, c.ex_unlocked
  from public.shares s
  join public.user_collection c on c.user_id = s.user_id
  where s.token = p_token
    and c.owned = true
    and (s.expires_at is null or s.expires_at > now());
$$;

grant execute on function public.get_shared_collection(text) to anon, authenticated;
