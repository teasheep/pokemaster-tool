-- 0029: 顧問邀請碼 + 一人多館
--   顧問用另一組邀請碼加入 → 直接是 advisor (不佔 20 人名額, 不用對名單認領)
--   顧問本來就會同時看好幾個道館, 一人多館是常態 (前端用 active gym cookie 決定目前道館)

alter table public.gym_invites
  add column if not exists advisor_code text unique
  default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));

update public.gym_invites
set advisor_code = upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12))
where advisor_code is null;

create or replace function public.join_gym(p_code text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_role text := 'member';
  v_name text := trim(coalesce(p_display_name, ''));
  v_claimed uuid;
  v_avatar text;
  v_line text;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 成員碼 / 顧問碼 (顧問碼 → 唯讀身分)
  select gym_id into v_gym from public.gym_invites where code = v_code;
  if v_gym is null then
    select gym_id into v_gym from public.gym_invites where advisor_code = v_code;
    if v_gym is null then
      raise exception 'INVALID_CODE';
    end if;
    v_role := 'advisor';
  end if;

  -- 已是這個道館的成員 → 直接回傳 (冪等; 不同道館各自有列, 一人可多館)
  if exists (
    select 1 from public.gym_members where gym_id = v_gym and user_id = v_uid
  ) then
    return v_gym;
  end if;

  if char_length(v_name) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select avatar_url, line_name into v_avatar, v_line from public.profiles where id = v_uid;

  -- 顧問不認領名單 (他不是名單上的 20 人之一), 直接建唯讀列
  if v_role = 'advisor' then
    insert into public.gym_members (gym_id, user_id, display_name, role, avatar_url, line_name)
    values (v_gym, v_uid, v_name, 'advisor', v_avatar, v_line);
    return v_gym;
  end if;

  -- 名單上已有同名的未綁定成員 (匯入資料) → 認領綁定 (見 0005 的安全註解)
  update public.gym_members
     set user_id = v_uid,
         avatar_url = coalesce(avatar_url, v_avatar),
         line_name = coalesce(line_name, v_line)
   where gym_id = v_gym and user_id is null and display_name = v_name and role = 'member'
   returning id into v_claimed;

  if v_claimed is null then
    insert into public.gym_members (gym_id, user_id, display_name, avatar_url, line_name)
    values (v_gym, v_uid, v_name, v_avatar, v_line);
  end if;

  return v_gym;
exception
  when unique_violation then
    raise exception 'NAME_TAKEN';
end;
$$;

revoke execute on function public.join_gym(text, text) from public, anon;
grant execute on function public.join_gym(text, text) to authenticated;
