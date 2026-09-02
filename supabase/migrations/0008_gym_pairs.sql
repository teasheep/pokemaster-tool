-- 0008: 道館拍組庫 — 表單調查涵蓋的拍組固定名單
--
-- 「道館拍組」= 戰力調查表單裡列出的拍組 (道館戰的核心牌組池)。
-- 每組拍組屬於一個屬性、掛一個角色標籤 (表單分類直接對應):
--   物攻 → ph_main 物攻主力; 特攻 → sp_main 特攻主力; 場域/降抗 → support 輔助
-- source_kind 保留原始細分 (輔助再分 降抗/場域)。
-- 成員持有情況由 member_pairs join (pair_id 優先, 否則正規化名稱)。
-- 在 0007 之後執行。

create table public.gym_pairs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  pair_label text not null,
  pair_id text,
  type public.sync_pair_type not null,
  tag text not null check (tag in ('ph_main', 'sp_main', 'support')),
  source_kind text check (source_kind in ('ph_atk', 'sp_atk', 'field', 'debuff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, pair_label)
);

create index gym_pairs_gym_idx on public.gym_pairs (gym_id);

create trigger gym_pairs_set_updated_at
  before update on public.gym_pairs
  for each row execute function public.set_updated_at();

alter table public.gym_pairs enable row level security;

create policy "gym_pairs_select" on public.gym_pairs
  for select using (public.is_gym_member(gym_id));
create policy "gym_pairs_insert" on public.gym_pairs
  for insert with check (public.is_gym_admin(gym_id));
create policy "gym_pairs_update" on public.gym_pairs
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "gym_pairs_delete" on public.gym_pairs
  for delete using (public.is_gym_admin(gym_id));

grant select, insert, update, delete on public.gym_pairs to authenticated, service_role;
