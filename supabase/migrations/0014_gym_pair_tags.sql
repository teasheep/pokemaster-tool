-- 0014: 拍組自由標籤 — 道館共筆, 貼在拍組上的短標籤 (例: 降抗手/96跨/收尾/新手友善)
-- 與 gym_pairs.tag (物攻主力/特攻主力/輔助 三分類) 不同: 這是自由文字、一拍組可多個。
-- 成員都可貼 (共筆), 刪除限貼的人或管理員。在 0013 之後執行。

create table public.gym_pair_tags (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  pair_id text not null,
  tag text not null check (char_length(trim(tag)) between 1 and 12),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (gym_id, pair_id, tag)
);

create index gym_pair_tags_gym_pair_idx on public.gym_pair_tags (gym_id, pair_id);

alter table public.gym_pair_tags enable row level security;

create policy "gym_pair_tags_select" on public.gym_pair_tags
  for select using (public.is_gym_member(gym_id));
create policy "gym_pair_tags_insert" on public.gym_pair_tags
  for insert with check (public.is_gym_member(gym_id) and created_by = auth.uid());
create policy "gym_pair_tags_delete" on public.gym_pair_tags
  for delete using (created_by = auth.uid() or public.is_gym_admin(gym_id));

grant select, insert, delete on public.gym_pair_tags to authenticated, service_role;
