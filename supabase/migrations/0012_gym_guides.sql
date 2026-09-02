-- 0012: 攻略庫 — 存放打法筆記/手順/影片連結的簡易分頁
-- 成員都能讀寫 (攻略是共筆), 刪除限作者或管理員。在 0011 之後執行。

create table public.gym_guides (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  type public.sync_pair_type,
  title text not null check (char_length(trim(title)) between 1 and 60),
  content text not null default '' check (char_length(content) <= 4000),
  created_by uuid references auth.users(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_guides_gym_idx on public.gym_guides (gym_id, type);

create trigger gym_guides_set_updated_at
  before update on public.gym_guides
  for each row execute function public.set_updated_at();

alter table public.gym_guides enable row level security;

create policy "gym_guides_select" on public.gym_guides
  for select using (public.is_gym_member(gym_id));
create policy "gym_guides_insert" on public.gym_guides
  for insert with check (public.is_gym_member(gym_id) and created_by = auth.uid());
create policy "gym_guides_update" on public.gym_guides
  for update using (public.is_gym_member(gym_id) and (created_by = auth.uid() or public.is_gym_admin(gym_id)))
  with check (public.is_gym_member(gym_id));
create policy "gym_guides_delete" on public.gym_guides
  for delete using (created_by = auth.uid() or public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.gym_guides to authenticated, service_role;
