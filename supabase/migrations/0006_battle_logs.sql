-- 0006: 戰鬥紀錄 (ref/道館戰紀錄暨剩餘卷統計表.xlsx 的線上化)
--
-- 道館實務: 成員每打一場就登記 (關卡, 使用卷數, 擔任角色, 分數),
-- 「剩餘券」由紀錄推導: 應剩 = 當日累積發放 (開賽9張+每日3張, 上限30) − Σ已花。
-- app 的做法: 回報戰鬥時同步呼叫 adjust_member_ticket 扣掉手動計數器 (刪除回報則退回),
-- 看板同時顯示「手動剩餘」與「帳面應剩」對照。
-- role: main=主力, assist=補刀, debuff=降抗 (統計表的三分工)。
-- round_label: 場次代號自由填 (例 R1/R2/Ex3; 統計表用 F1-F3/C1-C24)。
-- 在 0005 之後執行。

create table public.battle_logs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  stage_id uuid references public.battle_stages(id) on delete set null,
  round_label text check (round_label is null or char_length(round_label) between 1 and 10),
  role text not null default 'main' check (role in ('main', 'assist', 'debuff')),
  tickets_used smallint not null default 3 check (tickets_used between 0 and 3),
  score integer check (score is null or score >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index battle_logs_battle_idx on public.battle_logs (battle_id);
create index battle_logs_member_idx on public.battle_logs (member_id);
create index battle_logs_gym_idx on public.battle_logs (gym_id);

create trigger battle_logs_set_updated_at
  before update on public.battle_logs
  for each row execute function public.set_updated_at();

alter table public.battle_logs enable row level security;

create policy "battle_logs_select" on public.battle_logs
  for select using (public.is_gym_member(gym_id));
create policy "battle_logs_insert" on public.battle_logs
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "battle_logs_update" on public.battle_logs
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "battle_logs_delete" on public.battle_logs
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

grant select, insert, update, delete on public.battle_logs to authenticated, service_role;

-- 即時: 回報一進來, 所有人的看板同步更新
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'battle_logs'
  ) then
    alter publication supabase_realtime add table public.battle_logs;
  end if;
end $$;
