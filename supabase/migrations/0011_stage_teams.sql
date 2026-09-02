-- 0011: 一關可以綁多套隊伍, 並依分類 (降抗/物攻/特攻/收尾) 分區
--
-- 實務: 同一關通常要好幾套隊伍搭配 — 降抗手一套、物攻主力一套、特攻備援一套、
-- 收尾一套。原本 battle_stages.team_id 只能綁一套, 改成多對多。
-- 同時把隊伍標籤的「磨隊 (dot)」正名為「收尾 (closer)」。
-- 在 0010 之後執行。

-- 1. 標籤: dot → closer
alter table public.gym_teams drop constraint if exists gym_teams_tag_check;
update public.gym_teams set tag = 'closer' where tag = 'dot';
alter table public.gym_teams
  add constraint gym_teams_tag_check
  check (tag in ('debuff', 'physical', 'special', 'closer'));

-- 2. 關卡 ↔ 隊伍 多對多
create table public.stage_teams (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  stage_id uuid not null references public.battle_stages(id) on delete cascade,
  team_id uuid not null references public.gym_teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (stage_id, team_id)
);

create index stage_teams_stage_idx on public.stage_teams (stage_id);
create index stage_teams_battle_idx on public.stage_teams (battle_id);

alter table public.stage_teams enable row level security;

create policy "stage_teams_select" on public.stage_teams
  for select using (public.is_gym_member(gym_id));
create policy "stage_teams_insert" on public.stage_teams
  for insert with check (public.is_gym_admin(gym_id));
create policy "stage_teams_delete" on public.stage_teams
  for delete using (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.stage_teams to authenticated, service_role;

-- 3. 既有的單一 team_id 搬進來 (之後 UI 只讀 stage_teams)
insert into public.stage_teams (gym_id, battle_id, stage_id, team_id)
select bs.gym_id, bs.battle_id, bs.id, bs.team_id
from public.battle_stages bs
where bs.team_id is not null
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stage_teams'
  ) then
    alter publication supabase_realtime add table public.stage_teams;
  end if;
end $$;
