-- 0044: 每關每輪一句敘述 (2026-08-18 使用者要求「每個屬性的輪次加一個敘述」)
--
-- battle_round_rules 是「整場某一輪」的全域特規; 這張是「某關某輪」的說明
-- (例: 這關這輪要留誰補刀 / 血量打到哪)。管理員可編, 全館可讀。

create table public.stage_round_notes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  stage_id uuid not null references public.battle_stages(id) on delete cascade,
  round smallint not null check (round between 1 and 20),
  note text not null check (char_length(note) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, round)
);

create index stage_round_notes_battle_idx on public.stage_round_notes (battle_id);
create index stage_round_notes_gym_idx on public.stage_round_notes (gym_id);

create trigger stage_round_notes_set_updated_at
  before update on public.stage_round_notes
  for each row execute function public.set_updated_at();

alter table public.stage_round_notes enable row level security;

create policy "stage_round_notes_select" on public.stage_round_notes
  for select using (public.is_gym_member(gym_id));
create policy "stage_round_notes_insert" on public.stage_round_notes
  for insert with check (public.is_gym_admin(gym_id));
create policy "stage_round_notes_update" on public.stage_round_notes
  for update using (public.is_gym_admin(gym_id))
  with check (public.is_gym_admin(gym_id));
create policy "stage_round_notes_delete" on public.stage_round_notes
  for delete using (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.stage_round_notes
  to authenticated, service_role;
