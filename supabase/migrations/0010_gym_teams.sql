-- 0010: 挑戰隊伍庫 — 每個屬性事先備好幾套隊伍, 排刀時直接套用
--
-- 實務: 一個屬性通常會準備 3-5 套隊伍 (降抗隊 / 物攻隊 / 特攻隊 / 磨隊),
-- 每套 = 3 個拍組 + 各自要求的寶數 + 一行說明 (手順/注意事項)。
-- 關卡排刀時選一套隊伍, 系統即可列出「持有這些拍組且達要求寶數」的成員。
-- 在 0009 之後執行。

create table public.gym_teams (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  type public.sync_pair_type not null,
  name text not null check (char_length(trim(name)) between 1 and 30),
  tag text not null default 'physical'
    check (tag in ('debuff', 'physical', 'special', 'dot')),
  note text check (note is null or char_length(note) <= 120),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_teams_gym_type_idx on public.gym_teams (gym_id, type);

create table public.gym_team_pairs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.gym_teams(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  pair_id text not null,
  min_grade smallint not null default 1 check (min_grade between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, slot)
);

create index gym_team_pairs_team_idx on public.gym_team_pairs (team_id);

create trigger gym_teams_set_updated_at
  before update on public.gym_teams
  for each row execute function public.set_updated_at();
create trigger gym_team_pairs_set_updated_at
  before update on public.gym_team_pairs
  for each row execute function public.set_updated_at();

alter table public.gym_teams enable row level security;
alter table public.gym_team_pairs enable row level security;

create policy "gym_teams_select" on public.gym_teams
  for select using (public.is_gym_member(gym_id));
create policy "gym_teams_insert" on public.gym_teams
  for insert with check (public.is_gym_admin(gym_id));
create policy "gym_teams_update" on public.gym_teams
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "gym_teams_delete" on public.gym_teams
  for delete using (public.is_gym_admin(gym_id));

create policy "gym_team_pairs_select" on public.gym_team_pairs
  for select using (public.is_gym_member(gym_id));
create policy "gym_team_pairs_insert" on public.gym_team_pairs
  for insert with check (public.is_gym_admin(gym_id));
create policy "gym_team_pairs_update" on public.gym_team_pairs
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "gym_team_pairs_delete" on public.gym_team_pairs
  for delete using (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.gym_teams to authenticated, service_role;
grant select, insert, update, delete on public.gym_team_pairs to authenticated, service_role;

-- 關卡排刀可指定用哪一套隊伍 (每關每輪一套)
alter table public.battle_stages
  add column if not exists team_id uuid references public.gym_teams(id) on delete set null;

comment on column public.battle_stages.team_id is '本關採用的挑戰隊伍 (gym_teams)';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gym_teams'
  ) then
    alter publication supabase_realtime add table public.gym_teams;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gym_team_pairs'
  ) then
    alter publication supabase_realtime add table public.gym_team_pairs;
  end if;
end $$;
