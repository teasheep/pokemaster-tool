-- 0061: join_gym 也套上試碼節流
--
-- 與 0060 同一個機制 (code_attempts), 但**這一支更該做**: 邀請碼是進到**真實成員資料**
-- 的門 (0040 起 join_gym 只吃碼, 不再比對名字), 建館碼只是開一個空館。
--
-- 拆成獨立一支 migration 的理由: 0060 只影響建館 (只有作者會做), 這支動的是
-- 20 位成員真的在用的加入流程 —— 要退可以單獨退, 不必連建館碼一起拔掉。
--
-- **行為完全沒變**, 只有兩件事不同:
--   1. 使用者輸入類的錯誤改成**回傳** {error} 而不是丟例外 (理由見 0060 檔頭第 2 點:
--      丟例外會讓那筆「他試錯了」跟著交易一起回滾, 節流等於沒有作用)。
--   2. 10 分鐘內試錯 5 次 → 鎖 10 分鐘。
--   已經是成員時照舊直接回那一館 (冪等), 顧問碼照舊給 advisor 身分。
--
-- 前端**同時吃得下新舊兩種回傳** (uuid 字串 = 舊版, jsonb = 新版), 所以先部署前端
-- 再套這支、或反過來, 加入流程都不會斷 —— 「不要影響到線上正在使用的部分」。

drop function if exists public.join_gym(text);

create or replace function public.join_gym(p_code text)
returns jsonb
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
  v_fails int;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;

  delete from public.code_attempts
   where user_id = v_uid and at < now() - interval '1 day';

  select count(*) into v_fails
    from public.code_attempts
   where user_id = v_uid
     and kind = 'join'
     and not ok
     and at > now() - interval '10 minutes';
  if v_fails >= 5 then
    return jsonb_build_object('error', 'TOO_MANY_ATTEMPTS');
  end if;

  -- 成員碼 / 顧問碼 (顧問碼 → 唯讀身分, 不佔 20 人名額)
  select gym_id into v_gym from public.gym_invites where code = v_code;
  if v_gym is null then
    select gym_id into v_gym from public.gym_invites where advisor_code = v_code;
    if v_gym is null then
      insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'join', false);
      return jsonb_build_object('error', 'INVALID_CODE');
    end if;
    v_role := 'advisor';
  end if;

  insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'join', true);

  -- 已是這個道館的成員 → 直接回傳 (冪等; 一人可多館)
  if exists (
    select 1 from public.gym_members where gym_id = v_gym and user_id = v_uid
  ) then
    return jsonb_build_object('gym_id', v_gym);
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
    from public.profiles where id = v_uid;

  -- 個人資料沒名字時退回 email 帳號前綴 (之後可在個人設定改)
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gym_members (gym_id, user_id, display_name, role, avatar_url, line_name)
  values (v_gym, v_uid, coalesce(v_name, '訓練家'), v_role, v_avatar, v_line);

  return jsonb_build_object('gym_id', v_gym);
end;
$$;

comment on function public.join_gym(text) is
  '用邀請碼/顧問碼加入道館。回 {gym_id} 或 {error}; 10 分鐘內試錯 5 次會被擋 (code_attempts)。';

-- 新簽章 = 新物件 = 重新套用 default privileges → 一定要再收一次 (0040 的前科)
revoke all on function public.join_gym(text) from public, anon;
grant execute on function public.join_gym(text) to authenticated;
