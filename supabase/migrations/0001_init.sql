-- Pokemon Masters Inventory: 初始 schema
-- 將此整段貼到 Supabase 專案的 SQL Editor 後執行

-- ====================================================================
-- ENUMS
-- ====================================================================
create type sync_pair_type as enum (
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'
);

create type sync_pair_role as enum (
  'strike','tech','support','field','sprint'
);

-- ====================================================================
-- PROFILES (對應 auth.users)
-- ====================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_read_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

-- 註冊時自動建立 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ====================================================================
-- SYNC PAIRS (主資料 — 所有玩家共用)
-- ====================================================================
create table public.sync_pairs (
  id bigserial primary key,
  slug text unique not null,
  trainer_name text not null,
  pokemon_name text not null,
  display_name_zh text,
  type sync_pair_type not null,
  role sync_pair_role not null,
  base_potential int not null default 3 check (base_potential between 1 and 6),
  ex_role text,
  region text,
  notes text,
  image_url text,
  created_at timestamptz not null default now()
);

create index sync_pairs_trainer_idx on public.sync_pairs (trainer_name);
create index sync_pairs_pokemon_idx on public.sync_pairs (pokemon_name);
create index sync_pairs_type_role_idx on public.sync_pairs (type, role);

alter table public.sync_pairs enable row level security;

-- 所有人都可以讀取主資料
create policy "sync_pairs_public_read" on public.sync_pairs
  for select using (true);

-- 寫入只給 service_role
-- (RLS 預設拒絕, 不需要明寫 deny)

-- ====================================================================
-- USER PAIRS (使用者擁有的拍組)
-- ====================================================================
create table public.user_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sync_pair_id bigint not null references public.sync_pairs(id) on delete cascade,
  star_level int not null default 3 check (star_level between 1 and 6),
  level int not null default 1 check (level between 1 and 150),
  move_level int not null default 1 check (move_level between 1 and 5),
  sync_level int not null default 1 check (sync_level between 1 and 5),
  ex_unlocked boolean not null default false,
  lucky_skills text[] default '{}',
  notes text,
  source_screenshot_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sync_pair_id)
);

create index user_pairs_user_idx on public.user_pairs (user_id);
create index user_pairs_sync_pair_idx on public.user_pairs (sync_pair_id);

alter table public.user_pairs enable row level security;

create policy "user_pairs_select_own" on public.user_pairs
  for select using (auth.uid() = user_id);

create policy "user_pairs_insert_own" on public.user_pairs
  for insert with check (auth.uid() = user_id);

create policy "user_pairs_update_own" on public.user_pairs
  for update using (auth.uid() = user_id);

create policy "user_pairs_delete_own" on public.user_pairs
  for delete using (auth.uid() = user_id);

-- 自動維護 updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_pairs_set_updated_at
  before update on public.user_pairs
  for each row execute function public.set_updated_at();

-- ====================================================================
-- SHARES (公開分享連結)
-- ====================================================================
create table public.shares (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index shares_user_idx on public.shares (user_id);

alter table public.shares enable row level security;

-- 任何人可以透過 token 讀取 (應用層自行用 token 查詢)
create policy "shares_public_read_by_token" on public.shares
  for select using (true);

create policy "shares_insert_own" on public.shares
  for insert with check (auth.uid() = user_id);

create policy "shares_delete_own" on public.shares
  for delete using (auth.uid() = user_id);

-- ====================================================================
-- 用 token 拿到某人的拍組清單 (供公開分享頁使用)
-- ====================================================================
create or replace function public.get_shared_pairs(p_token text)
returns table (
  sync_pair_id bigint,
  star_level int,
  level int,
  move_level int,
  sync_level int,
  ex_unlocked boolean,
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

grant execute on function public.get_shared_pairs(text) to anon, authenticated;
