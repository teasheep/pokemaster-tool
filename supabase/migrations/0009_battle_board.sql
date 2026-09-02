-- 0009: 道館賽版面改造 — 8 關固定卡片、輪次 (round)、排刀拍組組合、成員頭像
--
-- 依實戰協調方式調整:
--   - 一場賽事固定 8 關 (8 位館主), 每關選一個弱點屬性 → 建賽事時自動建立
--   - 輪次 (round): 一般對戰 R1-R3 + 額外對戰 Ex1-Ex15; 排刀與用券都以輪次為單位
--   - 排刀不只排人, 還要排「這關這輪要用哪些拍組、各要幾寶」→ stage_plan_pairs,
--     系統據此列出符合條件的成員 (取代人工翻查詢網頁)
--   - 成員頭像: 選一個代表拍組, 用其訓練家頭像當頭像 (排刀時好認人)
-- 在 0008 之後執行。

-- 成員代表拍組 (頭像用; pair_id 對 catalog, 無 FK 同既有慣例)
alter table public.gym_members
  add column if not exists avatar_pair_id text;

comment on column public.gym_members.avatar_pair_id is '代表拍組 pairId — 用其訓練家頭像當成員頭像';

-- 賽事目前進行到第幾輪 (1-3 一般對戰, 4+ 額外對戰 Ex1…)
alter table public.gym_battles
  add column if not exists current_round smallint not null default 1
    check (current_round between 1 and 20);

-- 派遣/紀錄掛輪次
alter table public.stage_assignments
  add column if not exists round smallint check (round is null or round between 1 and 20);
alter table public.battle_logs
  add column if not exists round smallint check (round is null or round between 1 and 20);

comment on column public.stage_assignments.round is '此派遣屬於第幾輪 (null = 整場通用)';
comment on column public.battle_logs.round is '這場出戰是第幾輪';

-- 排刀的拍組組合: 某關某輪要用哪些拍組、各自要求幾寶 (0-6, 6=超覺醒)
create table public.stage_plan_pairs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  stage_id uuid not null references public.battle_stages(id) on delete cascade,
  round smallint check (round is null or round between 1 and 20),
  slot smallint not null default 1 check (slot between 1 and 6),
  pair_id text not null,
  min_grade smallint not null default 1 check (min_grade between 0 and 6),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, round, slot, pair_id)
);

create index stage_plan_pairs_stage_idx on public.stage_plan_pairs (stage_id);
create index stage_plan_pairs_battle_idx on public.stage_plan_pairs (battle_id);

create trigger stage_plan_pairs_set_updated_at
  before update on public.stage_plan_pairs
  for each row execute function public.set_updated_at();

alter table public.stage_plan_pairs enable row level security;

create policy "stage_plan_pairs_select" on public.stage_plan_pairs
  for select using (public.is_gym_member(gym_id));
create policy "stage_plan_pairs_insert" on public.stage_plan_pairs
  for insert with check (public.is_gym_admin(gym_id));
create policy "stage_plan_pairs_update" on public.stage_plan_pairs
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "stage_plan_pairs_delete" on public.stage_plan_pairs
  for delete using (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.stage_plan_pairs to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stage_plan_pairs'
  ) then
    alter publication supabase_realtime add table public.stage_plan_pairs;
  end if;
end $$;

-- 建立賽事時自動開 8 關 (屬性先給 normal, 由管理員在頁面上選)
create or replace function public.handle_new_battle()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.battle_stages (gym_id, battle_id, seq, weak_type)
  select new.gym_id, new.id, s, 'normal'::public.sync_pair_type
  from generate_series(1, 8) as s;
  return new;
end;
$$;

drop trigger if exists on_battle_created on public.gym_battles;
create trigger on_battle_created
  after insert on public.gym_battles
  for each row execute function public.handle_new_battle();
