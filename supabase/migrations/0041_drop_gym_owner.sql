-- 0041: 拿掉「館主」概念 (使用者指示) — 只分 管理員 / 一般成員 (/顧問)
--   - 建立道館的人就是管理員 (create_gym RPC, 原子建立 道館+自己的 admin 列)
--   - 管理員可以把自己移除/降級, 但道館不能沒有管理員 (trigger 擋最後一位)
--   - gyms.owner_id 與其保護 trigger 一併移除

-- 1) 回填: 每個 owner 的成員列升為 admin (概念交接, 不掉權限)
update public.gym_members m
set role = 'admin'
from public.gyms g
where m.gym_id = g.id and m.user_id = g.owner_id and m.role <> 'admin';

-- 2) helpers 改為純角色判定 (不再看 owner_id)
create or replace function public.is_gym_member(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid()
  );
$$;

create or replace function public.is_gym_admin(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_gym_editor(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role in ('admin', 'member')
  );
$$;

-- 3) 政策與 trigger: 先拆再刪欄
drop trigger if exists gyms_protect_owner on public.gyms;
drop function if exists public.protect_gym_owner();
drop policy if exists "gyms_insert_own" on public.gyms;
drop policy if exists "gyms_delete_owner" on public.gyms;

alter table public.gyms drop column if exists owner_id;

-- 建館走 create_gym RPC (下方); 直接 insert 不開放
create policy "gyms_delete_admin" on public.gyms
  for delete using (public.is_gym_admin(id));

-- 4) 建立道館: 原子地 建道館 + 自己成為管理員 (名字取自 profiles)
create or replace function public.create_gym(p_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_name text;
  v_avatar text;
  v_line text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
  from public.profiles where id = v_uid;
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gyms (name) values (trim(p_name)) returning id into v_gym;
  insert into public.gym_members (gym_id, user_id, display_name, role, avatar_url, line_name)
  values (v_gym, v_uid, coalesce(v_name, '訓練家'), 'admin', v_avatar, v_line);
  return v_gym;
end;
$$;

grant execute on function public.create_gym(text) to authenticated;

-- 5) 道館不能沒有管理員: 擋「最後一位 admin」被刪或被降級
create or replace function public.protect_last_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.gym_members
       where gym_id = old.gym_id and role = 'admin' and id <> old.id
     )
  then
    raise exception 'LAST_ADMIN';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists gym_members_protect_last_admin on public.gym_members;
create trigger gym_members_protect_last_admin
  before update or delete on public.gym_members
  for each row execute function public.protect_last_admin();
