-- 0040: 加入道館只填邀請碼 (使用者指示)
--
-- 名字是「人」的資料, 不因道館而異 → 一律取自 profiles (個人設定編輯)。
-- 舊的「同暱稱認領匯入名單」路徑移除: 暱稱可重複, 不能當身分;
-- 帳號識別一律 email (= auth 帳號本身)。要把匯入列綁到帳號是管理員的事, 不在加入流程裡。

drop function if exists public.join_gym(text, text);

create or replace function public.join_gym(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_role text := 'member';
  v_name text;
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

  -- 已是這個道館的成員 → 直接回傳 (冪等; 一人可多館)
  if exists (
    select 1 from public.gym_members where gym_id = v_gym and user_id = v_uid
  ) then
    return v_gym;
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
  from public.profiles where id = v_uid;

  -- 個人資料沒名字時退回 email 帳號前綴 (之後可在個人設定改)
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gym_members (gym_id, user_id, display_name, role, avatar_url, line_name)
  values (v_gym, v_uid, coalesce(v_name, '訓練家'), v_role, v_avatar, v_line);

  return v_gym;
end;
$$;

grant execute on function public.join_gym(text) to authenticated;
