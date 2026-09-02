-- 0021: 輪次規則 (道館賽每輪條件不同: 血量遞增, Ex 輪特規輪替 —
-- 非異常攻擊無效/物攻無效/量表-2, Ex4 起雙特規+非弱點無效)
-- blocked 供排刀過濾隊伍 (物攻無效 → physical 隊不用); note 自由備註顯示用。

create table if not exists public.battle_round_rules (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null,
  battle_id uuid not null,
  round int not null,
  blocked text check (blocked in ('physical', 'special')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (battle_id, round)
);

alter table public.battle_round_rules enable row level security;

drop policy if exists battle_round_rules_select on public.battle_round_rules;
create policy battle_round_rules_select on public.battle_round_rules
  for select using (public.is_gym_member(gym_id));

drop policy if exists battle_round_rules_admin on public.battle_round_rules;
create policy battle_round_rules_admin on public.battle_round_rules
  for all using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.battle_round_rules to authenticated;
