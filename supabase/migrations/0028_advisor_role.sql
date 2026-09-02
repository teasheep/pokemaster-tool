-- 0028: 顧問 (advisor) 角色 — 唯讀觀察者
--   看得到: 全館成員狀況、戰鬥看板、變化紀錄 (與管理員同視野)
--   不能改: 共筆攻略/拍組標籤/出戰紀錄/券數/排刀 (自己的個人收藏不受限)
--   不佔 20 人名額: 應用層把 advisor 從「成員」名單排除 (排刀/券數/統計都不算)

alter table public.gym_members drop constraint if exists gym_members_role_check;
alter table public.gym_members
  add constraint gym_members_role_check check (role in ('admin', 'member', 'advisor'));

-- 可寫入的成員 (管理員或一般成員; 顧問為否)
create or replace function public.is_gym_editor(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gyms where id = p_gym and owner_id = auth.uid()
  ) or exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role in ('admin', 'member')
  );
$$;

create or replace function public.is_gym_advisor(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role = 'advisor'
  );
$$;

-- 呼叫者在該館目前的角色 (self-update 檢查用: 不准自己改角色)
create or replace function public.my_gym_role(p_gym uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.gym_members
  where gym_id = p_gym and user_id = auth.uid() limit 1;
$$;

grant execute on function public.is_gym_editor(uuid) to anon, authenticated;
grant execute on function public.is_gym_advisor(uuid) to anon, authenticated;
grant execute on function public.my_gym_role(uuid) to anon, authenticated;

-- 自助更新自己的成員列: 角色必須維持原樣 (原本寫死 role='member', 顧問會被擋;
-- 且僅比對字面值時顧問可自我升級成 member → 改成必須等於現況)
drop policy if exists "gym_members_update_self" on public.gym_members;
create policy "gym_members_update_self" on public.gym_members
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = public.my_gym_role(gym_id)
    and public.is_gym_member(gym_id)
  );

-- ── 顧問不可寫的共享資料 ──
drop policy if exists "gym_guides_insert" on public.gym_guides;
create policy "gym_guides_insert" on public.gym_guides
  for insert with check (public.is_gym_editor(gym_id) and created_by = auth.uid());

drop policy if exists "gym_guides_update" on public.gym_guides;
create policy "gym_guides_update" on public.gym_guides
  for update using (
    public.is_gym_editor(gym_id) and (created_by = auth.uid() or public.is_gym_admin(gym_id))
  ) with check (public.is_gym_editor(gym_id));

drop policy if exists "gym_pair_tags_insert" on public.gym_pair_tags;
create policy "gym_pair_tags_insert" on public.gym_pair_tags
  for insert with check (public.is_gym_editor(gym_id) and created_by = auth.uid());

drop policy if exists "battle_logs_insert" on public.battle_logs;
create policy "battle_logs_insert" on public.battle_logs
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "battle_logs_update" on public.battle_logs;
create policy "battle_logs_update" on public.battle_logs
  for update using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  ) with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "battle_logs_delete" on public.battle_logs;
create policy "battle_logs_delete" on public.battle_logs
  for delete using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "member_tickets_insert" on public.member_tickets;
create policy "member_tickets_insert" on public.member_tickets
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "member_tickets_update" on public.member_tickets;
create policy "member_tickets_update" on public.member_tickets
  for update using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  ) with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "stage_assignments_update" on public.stage_assignments;
create policy "stage_assignments_update" on public.stage_assignments
  for update using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  ) with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

-- 顧問與管理員一樣看得到全館變化紀錄
drop policy if exists gym_activity_select on public.gym_activity;
create policy gym_activity_select on public.gym_activity
  for select using (
    public.is_gym_admin(gym_id)
    or public.is_gym_advisor(gym_id)
    or (member_id is not null and public.is_self_member(member_id))
  );

-- ── 分享頁: 公開的擁有者資訊 (RLS 讀不到 profiles, 用 security definer 給名稱) ──
create or replace function public.get_share_meta(p_token text)
returns table (display_name text, avatar_url text, created_at timestamptz, expires_at timestamptz)
language sql security definer set search_path = public as $$
  select coalesce(p.display_name, '訓練家'), p.avatar_url, s.created_at, s.expires_at
  from public.shares s
  left join public.profiles p on p.id = s.user_id
  where s.token = p_token
    and (s.expires_at is null or s.expires_at > now());
$$;

grant execute on function public.get_share_meta(text) to anon, authenticated;
