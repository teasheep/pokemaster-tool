-- 0015: 成員糖果庫存 — 通用黃糖 + 18 屬性糖
-- 排刀媒合用: 寶數差一點的成員, 若手上糖夠吃就列為「吃 N 顆糖可打」。
-- 在 0014 之後執行。

create table public.member_candies (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  -- 'universal' = 通用黃糖; 其餘為 18 屬性 (normal/fire/.../fairy)
  candy_type text not null check (
    candy_type in (
      'universal', 'normal', 'fire', 'water', 'electric', 'grass', 'ice',
      'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock',
      'ghost', 'dragon', 'dark', 'steel', 'fairy'
    )
  ),
  count smallint not null default 0 check (count between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, candy_type)
);

create index member_candies_gym_idx on public.member_candies (gym_id);

create trigger member_candies_set_updated_at
  before update on public.member_candies
  for each row execute function public.set_updated_at();

alter table public.member_candies enable row level security;

create policy "member_candies_select" on public.member_candies
  for select using (public.is_gym_member(gym_id));
create policy "member_candies_insert" on public.member_candies
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_candies_update" on public.member_candies
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_candies_delete" on public.member_candies
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

grant select, insert, update, delete on public.member_candies to authenticated, service_role;
