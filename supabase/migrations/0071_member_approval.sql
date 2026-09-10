-- 0071: 加入道館要管理員按確認 (pending → active)
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-10 使用者指定:
--   「就算用道館碼或顧問碼加入的玩家, 也不會立刻看到道館內的所有拍組 ——
--     因為碼確實有可能被外流, 此時再踢出, 已經被看光了。
--     所以需要管理員多一個確認加入的動作 … 管理拍組的個人功能還是不影響,
--     只影響到館。顧問同理。」
--
-- **這是一條安全邊界, 不是流程裝飾**。邀請碼外流之後, 舊制的損害在他點進來的那一秒
-- 就已經發生 (全館的練度、背包、道館拍組名單、賽事看板一次看完), 事後踢出救不回來。
-- 新制把「碼」降級成**申請的資格**, 真正開門的是管理員按的那一下。
--
-- ── 為什麼是改 `is_gym_member` 而不是在每一頁加判斷 ──────────────────────────
-- 全站的道館資料 (gyms / gym_members / member_pairs / member_candies / member_tickets /
-- member_type_focus / gym_pairs / gym_teams / gym_battles / battle_stages / battle_logs /
-- stage_round_notes / gym_activity …) 的讀取權限**全部**收斂在 `is_gym_member(gym_id)`
-- 這一支 helper 上。改這一支 = 現有的表與以後才長出來的表一起生效;
-- 在頁面層加判斷則是每加一頁就要記得一次, 而漏掉的症狀是「資料照樣渲染出來」——
-- 沒有任何徵兆。五支 helper 要一起收, 少一支就是一扇側門:
--   is_gym_member  → 讀 (全部)
--   is_gym_editor  → 寫共享資料 (出戰回報 / 券數 / 攻略)
--   is_gym_admin   → 管理
--   is_gym_advisor → 顧問視野 (道館紀錄)
--   is_self_member → 「這一列是我的」(成員資料表的寫入)
--
-- ── 完全不影響的東西 (使用者:「管理拍組的個人功能還是不影響」) ────────────────
--   /pairs 個人收藏 (user_collection)、/resources 我的背包、/share 分享頁、
--   個人匯出金鑰 —— 那些都不看 is_gym_member。待確認的人照樣用得到,
--   他只是還沒進到「那一館」。
--
-- ── 對現有的道館與 20 位成員: 零影響 ────────────────────────────────────────
--   新欄位 default 'active' → ALTER TABLE 當下每一列都是 'active';
--   只有這支之後**新按下加入**的人才會是 'pending'。
--
-- ── 沒有做的一件事, 與為什麼 ───────────────────────────────────────────────
--   `set_member_pair` (security definer) 裡的 `v_user = auth.uid()` 那條自助分支
--   沒有另外補 status 檢查。它需要 `p_member` = 那個人的 gym_members.id, 而待確認的人
--   **拿不到自己那一列的 id**: RLS 讀不到, join_gym 只回 gym_id, my_pending_gyms
--   也刻意不回 id。真正擋住直寫 member_pairs 的是下面收緊的 is_self_member。
--   ⚠ 哪天有人替待確認狀態加了「看得到自己那一列」的 policy 或 RPC, 這個假設就不成立了,
--     那時候要回來替 set_member_pair 補一句 `status = 'active'`。

-- ====================================================================
-- 1. 欄位
-- ====================================================================

alter table public.gym_members
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gym_members_status_check') then
    alter table public.gym_members
      add constraint gym_members_status_check check (status in ('pending', 'active'));
  end if;
end;
$$;

comment on column public.gym_members.status is
  'pending = 用邀請碼/顧問碼送出申請, 還沒被管理員確認 (看不到這一館的任何資料); active = 正式成員。';

-- 管理員的待確認清單走這個索引 (partial: 平常一列都沒有, 幾乎不佔空間)
create index if not exists gym_members_pending_idx
  on public.gym_members (gym_id) where status = 'pending';

-- ====================================================================
-- 2. RLS helpers —— 一律只認 status = 'active'
--    (簽章沒變 → create or replace 不會重置 ACL, 不必重收權限;
--     0058 檔頭那條「改簽章要 drop 再重收」講的是**換簽章**的情況。)
-- ====================================================================

create or replace function public.is_gym_member(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_gym_admin(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_gym_editor(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid()
      and role in ('admin', 'member') and status = 'active'
  );
$$;

create or replace function public.is_gym_advisor(p_gym uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role = 'advisor' and status = 'active'
  );
$$;

-- 「這一列 member row 是我的」—— member_pairs / member_candies / member_tickets /
-- member_type_focus / battle_logs 的寫入都吃它。待確認的人也有一列 member row,
-- 不收的話他雖然讀不到這一館, 卻寫得進自己那一份持有 —— 管理員會在還沒確認之前
-- 就看到他的練度, 道館紀錄也會冒出一個名單上還不存在的人。
create or replace function public.is_self_member(p_member uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where id = p_member and user_id = auth.uid() and status = 'active'
  );
$$;

-- 我在這一館的狀態 (null = 根本沒有列)。gym_members_update_self 的 with check 用它
-- 把 status 釘死 —— RLS 沒有欄位粒度, 不釘的話「改自己那一列」就是一條自助核准的路。
create or replace function public.my_gym_status(p_gym uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from public.gym_members
  where gym_id = p_gym and user_id = auth.uid() limit 1;
$$;

grant execute on function public.my_gym_status(uuid) to anon, authenticated;

-- 自助更新自己那一列: 角色 (0028) 之外, **status 也必須維持現況**。
-- 這一條照舊保留 is_gym_member(gym_id) —— 待確認的人在被確認之前連自己那一列都不能動
-- (所以 lib/profile.ts 的名字鏡像打不到 pending 列; 管理員看到的就是他按下加入當下的名字,
--  這是可以接受的取捨: 名字之後被確認了就會跟著同步)。
drop policy if exists "gym_members_update_self" on public.gym_members;
create policy "gym_members_update_self" on public.gym_members
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = public.my_gym_role(gym_id)
    and status = public.my_gym_status(gym_id)
    and public.is_gym_member(gym_id)
  );

-- ====================================================================
-- 3. 最後一位管理員: 「還有沒有別的管理員」只算 active 的
--    (待確認的人不可能是 admin —— join_gym 只給 member/advisor —— 但這條防呆的
--     語意是「這一館還有沒有人管得動」, 只有 active 算數。)
-- ====================================================================

create or replace function public.protect_last_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- 道館本體已刪 (cascade 進行中) → 放行 (0042)
  if not exists (select 1 from public.gyms where id = old.gym_id) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.gym_members
       where gym_id = old.gym_id and role = 'admin' and status = 'active' and id <> old.id
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

-- ====================================================================
-- 4. join_gym: 建的是**申請列** (status = 'pending')
--
--    回傳多一個旗標:  { "gym_id": "<uuid>", "pending": true|false }
--    前端 (lib/gym/gym-rpc.ts) 據此決定「導進道館」還是「留在清單顯示等待中」。
--    ⚠ 已經有列的那條冪等分支**也要回 pending** —— 待確認的人再貼一次碼是很自然的反應
--       (他什麼都看不到, 會以為沒成功), 那時候回 pending:false 就會把他導進一個
--       他讀不到的道館頁。
--
--    節流 (0061) 與「使用者輸入類的錯誤一律回傳不丟例外」(0060 檔頭第 2 點) 原封不動。
-- ====================================================================

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
  v_status text;
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

  -- 已經有列 → 直接回傳 (冪等; 一人可多館), 並照實說還在不在等
  select status into v_status from public.gym_members
   where gym_id = v_gym and user_id = v_uid;
  if v_status is not null then
    return jsonb_build_object('gym_id', v_gym, 'pending', v_status = 'pending');
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
    from public.profiles where id = v_uid;

  -- 個人資料沒名字時退回 email 帳號前綴 (之後可在個人設定改)
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gym_members
    (gym_id, user_id, display_name, role, avatar_url, line_name, status)
  values
    (v_gym, v_uid, coalesce(v_name, '訓練家'), v_role, v_avatar, v_line, 'pending');

  return jsonb_build_object('gym_id', v_gym, 'pending', true);
end;
$$;

comment on function public.join_gym(text) is
  '用邀請碼/顧問碼送出加入申請 (status=pending, 要管理員確認)。回 {gym_id, pending} 或 {error}。';

-- 新簽章 = 新物件 = 重新套用 default privileges → 一定要再收一次 (0040 的前科)
revoke all on function public.join_gym(text) from public, anon;
grant execute on function public.join_gym(text) to authenticated;

-- ====================================================================
-- 5. create_gym: 建館的人當然是已確認的 —— 明寫, 不靠欄位預設
--    (簽章沒變, 只換函式本體 → 權限不用重收。)
-- ====================================================================

create or replace function public.create_gym(p_name text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_name text;
  v_avatar text;
  v_line text;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_claimed text;
  v_fails int;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then
    return jsonb_build_object('error', 'NAME_REQUIRED');
  end if;

  delete from public.code_attempts
   where user_id = v_uid and at < now() - interval '1 day';

  select count(*) into v_fails
    from public.code_attempts
   where user_id = v_uid
     and kind = 'create'
     and not ok
     and at > now() - interval '10 minutes';
  if v_fails >= 5 then
    return jsonb_build_object('error', 'TOO_MANY_ATTEMPTS');
  end if;

  -- 認領要原子 (0060): 一句 update ... where used_by is null returning
  update public.gym_create_codes
     set used_by = v_uid, used_at = now()
   where code = v_code and used_by is null
  returning code into v_claimed;

  if v_claimed is null then
    insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'create', false);
    return jsonb_build_object('error', 'INVALID_CREATE_CODE');
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
    from public.profiles where id = v_uid;
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gyms (name) values (trim(p_name)) returning id into v_gym;
  insert into public.gym_members
    (gym_id, user_id, display_name, role, avatar_url, line_name, status)
  values
    (v_gym, v_uid, coalesce(v_name, '訓練家'), 'admin', v_avatar, v_line, 'active');

  update public.gym_create_codes set used_gym = v_gym where code = v_claimed;
  insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'create', true);

  return jsonb_build_object('gym_id', v_gym);
end;
$$;

-- ====================================================================
-- 6. 「我還在等哪幾館」+ 「我不等了」
--    待確認的人讀不到 gyms 也讀不到自己那一列 (RLS 兩邊都收了),
--    所以清單頁要一支 security definer 才問得到館名。
--    ⚠ 只回**呼叫者自己**的申請, 沒有任何枚舉面; 也刻意不回 gym_members.id
--      (見檔頭最後一段: set_member_pair 的自助分支靠「拿不到 id」擋著)。
-- ====================================================================

create or replace function public.my_pending_gyms()
returns table (gym_id uuid, gym_name text, role text, requested_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select m.gym_id, g.name, m.role, m.created_at
  from public.gym_members m
  join public.gyms g on g.id = m.gym_id
  where m.user_id = auth.uid() and m.status = 'pending'
  order by m.created_at;
$$;

revoke all on function public.my_pending_gyms() from public, anon;
grant execute on function public.my_pending_gyms() to authenticated;

-- 取消自己送出的申請。做成 RPC 而不是讓前端直接 delete: 待確認的人 select 不到自己那一列,
-- 直接 delete 回來的影響列數是 0 也是 0 (RLS 擋掉與根本沒有列長得一樣), 分不出成功與失敗。
create or replace function public.cancel_join_request(p_gym uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;
  delete from public.gym_members
   where gym_id = p_gym and user_id = v_uid and status = 'pending'
  returning id into v_id;
  return jsonb_build_object('ok', v_id is not null);
end;
$$;

revoke all on function public.cancel_join_request(uuid) from public, anon;
grant execute on function public.cancel_join_request(uuid) to authenticated;
