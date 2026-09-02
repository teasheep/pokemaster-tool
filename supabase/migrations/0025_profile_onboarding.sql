-- 0025: 個人檔案 (Google 登入 + 首次設定引導)
--   profiles 成為「跨道館的個人身分」: 遊戲名/社群名/頭貼
--   加入道館時 join_gym 會把 profile 的資料帶進 gym_members (成員名單顯示用)

alter table public.profiles
  add column if not exists line_name text,
  add column if not exists avatar_url text,
  add column if not exists onboarded_at timestamptz;

-- Google 登入的新使用者: 直接沿用 Google 的名字與大頭照當預設值
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 加入道館時把個人檔案帶進成員列 (認領既有列時只補頭貼/社群名, 不覆蓋名單上的遊戲名)
create or replace function public.join_gym(p_code text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_name text := trim(coalesce(p_display_name, ''));
  v_claimed uuid;
  v_avatar text;
  v_line text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select gym_id into v_gym from public.gym_invites
  where code = upper(trim(coalesce(p_code, '')));
  if v_gym is null then
    raise exception 'INVALID_CODE';
  end if;

  if exists (
    select 1 from public.gym_members where gym_id = v_gym and user_id = v_uid
  ) then
    return v_gym;
  end if;

  if char_length(v_name) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select avatar_url, line_name into v_avatar, v_line from public.profiles where id = v_uid;

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
