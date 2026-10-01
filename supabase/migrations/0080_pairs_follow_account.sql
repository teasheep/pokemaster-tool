-- 0080: 拍組跟著帳號走 —— 加入道館要補上既有拍組; 移出道館不要記成「把練度全部歸 0」
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-10-01 使用者兩個回報, 根因是同一件事 ——「道館端的那一份 (member_pairs) 只是帳號資料的鏡像」:
--   1.「軒之前在麵包店, 現在轉入跑路道館了, 他的拍組也應該被同步才對吧」
--      「拍組應該是跟著 google 帳號, 不會因為道館離開加入而被影響」
--      → 鏡像只在**改練度的那一下**寫 (syncMemberPair), 加入道館不會補 —— 軒 439 張、跑路道館 0 張。
--        線上同樣狀況的還有 5 位 (我不想井一 320 / Allen Lai 103 / (′_ゝ`) 54 / 木頭 10 …)。
--   2.「紀錄有個泡茶綿羊把已退出成員的拍組練度全部歸 0, 這也不合理, 退出的話拍組的資訊也都要在才對」
--      → 移出成員時 FK cascade 刪掉他在這一館的鏡像列, 而 member_pairs / member_candies / battle_logs
--        的 trigger 把每一列都記成「泡茶綿羊 改了 已退出的成員 的 拍組練度 → 未持有」
--        (哲爸 10/1: 107 張拍組 + 10 種糖 + 21 筆出戰, 一次記成 138 筆;
--         9/30 Merlin 移出軒也是同一件事: 439 張 + 14 種糖 = 453 筆)。
--        他們帳號裡的拍組一張都沒少 (user_collection 不受道館影響) —— 錯的是紀錄。
--
-- 兩件事 (已經記下來的那 591 筆假紀錄**不在這支裡清** —— 刪正式資料要使用者另外點頭):
--   A. 三支紀錄 trigger: **那位成員已經不在了 (cascade 刪除中) 就不記** —— 人員異動那一筆 (0079) 已經講完了。
--      另外 member_pairs 的 trigger 認 `pm.mirror_backfill` 這個交易內設定: 從帳號同步鏡像不是「誰改了練度」, 不記。
--   B. 新 RPC backfill_my_member_pairs: 把**呼叫者自己帳號**的拍組同步進他在某一館的鏡像 ——
--      缺的補上, 既有的列對齊帳號 (寶數 / 等級 / 星數 / 石盤 / EX 體系 / 潛能 / 備註)。**不刪**。
--      為什麼可以覆蓋既有列: 對已綁帳號的成員, 兩條寫入路徑都**先寫帳號** —— /pairs 是帳號寫成功才
--      syncMemberPair, set_member_pair (含管理員代改) 在同一個交易裡兩邊一起寫 —— 所以帳號永遠是最新的那一份。
--      鏡像和帳號對不上的來源 (線上 2026-10-01: 176 列 + 586 列星數空白) 是 set_member_pair 新增鏡像列時
--      等級固定給 1、星數給 null, 以及轉館的人在道館頁手動重點 (軒 87 張, 全部 Lv1 / 星數空白)。
--      pair_label 由前端照 pairLabel() 算好傳進來 (資料庫沒有圖鑑); 練度一律讀 user_collection, 不信傳進來的值。

-- ── A. 紀錄 trigger ──

create or replace function public.log_member_pair_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text;
begin
  if tg_op = 'INSERT' then
    -- 補鏡像 (backfill_my_member_pairs) 不是有人改了練度
    if coalesce(current_setting('pm.mirror_backfill', true), '') = 'on' then
      return new;
    end if;
    if coalesce(new.grade, 0) > 0 then
      insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
      values (new.gym_id, new.member_id, auth.uid(), 'pair', new.pair_label, new.pair_id, null, new.grade::text);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    -- 從帳號同步回來的值 (backfill_my_member_pairs) 也不是有人改了練度
    if coalesce(current_setting('pm.mirror_backfill', true), '') = 'on' then
      return new;
    end if;
    if new.grade is distinct from old.grade
       or new.super_awakening is distinct from old.super_awakening then
      v_old := old.grade::text ||
        case when old.super_awakening > 0 then '+覺' || old.super_awakening else '' end;
      v_new := new.grade::text ||
        case when new.super_awakening > 0 then '+覺' || new.super_awakening else '' end;
      insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
      values (new.gym_id, new.member_id, auth.uid(), 'pair', new.pair_label, new.pair_id, v_old, v_new);
    end if;
    return new;
  else
    -- 成員已經被移出 (cascade 刪除中) → 不是「把練度歸 0」, 不記
    if not exists (select 1 from public.gym_members where id = old.member_id) then
      return old;
    end if;
    insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
    values (old.gym_id, old.member_id, auth.uid(), 'pair', old.pair_label, old.pair_id, old.grade::text, null);
    return old;
  end if;
end;
$$;

create or replace function public.log_candy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.gym_members where id = old.member_id) then
      return old;
    end if;
    perform public.log_activity(old.gym_id, old.member_id, 'candy', old.candy_type, old.count::text, null);
    return old;
  end if;
  if tg_op = 'INSERT' or new.count is distinct from old.count then
    perform public.log_activity(
      new.gym_id, new.member_id, 'candy', new.candy_type,
      case when tg_op = 'INSERT' then null else old.count::text end, new.count::text
    );
  end if;
  return new;
end;
$$;

create or replace function public.log_battle_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_round text;
begin
  if tg_op = 'INSERT' then
    v_round := case
      when new.round is null then ''
      when new.round <= 3 then 'R' || new.round
      else 'Ex' || (new.round - 3)
    end;
    perform public.log_activity(new.gym_id, new.member_id, 'battle_log',
      v_round, null, new.tickets_used::text);
    return new;
  else
    if not exists (select 1 from public.gym_members where id = old.member_id) then
      return old;
    end if;
    v_round := case
      when old.round is null then ''
      when old.round <= 3 then 'R' || old.round
      else 'Ex' || (old.round - 3)
    end;
    perform public.log_activity(old.gym_id, old.member_id, 'battle_log',
      v_round, old.tickets_used::text, null);
    return old;
  end if;
end;
$$;
-- (log_ticket_change 只掛 insert / update, cascade 刪除碰不到它)

-- ── B. 把自己帳號的拍組同步進某一館的鏡像 ──
--
-- 帳號那一列 → 鏡像的值, 換算與 syncMemberPair (/pairs 每次寫入都傳整份帳號值) 逐欄相同:
--   grade = 超覺醒N ? 5+N : 寶數 (0-10 那條軸); 拍檔石盤上限 = 寶數 (超覺醒視為寶5)。
-- user_collection 這幾欄全是 not null, 所以不會踩到 least()/greatest() 忽略 NULL 的坑 (0069)。
-- 只看「帳號持有而且寶數 > 0」的列 —— 寶0 不留幽靈列 (AGENTS); 帳號不持有的鏡像列**不刪**。

create or replace function public.backfill_my_member_pairs(p_member uuid, p_labels jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_gym uuid;
  v_updated int;
  v_inserted int;
begin
  -- 只能同步**自己**的那一列, 而且要算道館的一員 (顧問 / 待確認不算, 見 0072)
  select gym_id into v_gym from public.gym_members
   where id = p_member and user_id = auth.uid();
  if v_gym is null or not public.member_counts_in_gym(p_member) then
    return 0;
  end if;

  perform set_config('pm.mirror_backfill', 'on', true);

  -- 1. 既有的列對齊帳號 (只動真的不一樣的列)
  with acct as (
    select c.pair_id,
           case when c.super_awakening > 0 then 5 + least(5, c.super_awakening)
                else greatest(0, least(5, c.potential)) end as grade,
           greatest(0, least(5, c.super_awakening)) as super_awakening,
           c.ex_style_worn,
           greatest(1, least(200, c.level)) as level,
           c.promotion,
           least(c.sync_grid, case when c.super_awakening > 0 then 5
                                   else greatest(0, least(5, c.potential)) end) as sync_grid,
           c.ex_role_unlocked,
           coalesce(c.lucky_skills[1:5], '{}') as lucky_skills,
           nullif(left(btrim(coalesce(c.notes, '')), 500), '') as notes
      from public.user_collection c
     where c.user_id = auth.uid()
       and c.owned
       and (c.potential > 0 or c.super_awakening > 0)
  )
  update public.member_pairs mp
     set grade = a.grade,
         super_awakening = a.super_awakening,
         ex_style_worn = a.ex_style_worn,
         level = a.level,
         promotion = a.promotion,
         sync_grid = a.sync_grid,
         ex_role_unlocked = a.ex_role_unlocked,
         lucky_skills = a.lucky_skills,
         notes = a.notes,
         updated_at = now()
    from acct a
   where mp.member_id = p_member
     and mp.pair_id = a.pair_id
     and (mp.grade, mp.super_awakening, mp.ex_style_worn, mp.level, mp.promotion, mp.sync_grid,
          mp.ex_role_unlocked, mp.lucky_skills, mp.notes)
         is distinct from
         (a.grade, a.super_awakening, a.ex_style_worn, a.level, a.promotion, a.sync_grid,
          a.ex_role_unlocked, a.lucky_skills, a.notes);
  get diagnostics v_updated = row_count;

  -- 2. 缺的補上。label 以 pair_id 去重 (同一個 pair_id 帶兩個 label 會長出兩列);
  --    p_labels 不是陣列就當沒有 (jsonb_to_recordset 遇到非陣列會丟例外)。
  insert into public.member_pairs (
    gym_id, member_id, pair_label, pair_id, grade, super_awakening, ex_style_worn,
    level, promotion, sync_grid, ex_role_unlocked, lucky_skills, notes
  )
  select
    v_gym, p_member, l.label, c.pair_id,
    case when c.super_awakening > 0 then 5 + least(5, c.super_awakening)
         else greatest(0, least(5, c.potential)) end,
    greatest(0, least(5, c.super_awakening)),
    c.ex_style_worn,
    greatest(1, least(200, c.level)),
    c.promotion,
    least(c.sync_grid, case when c.super_awakening > 0 then 5 else greatest(0, least(5, c.potential)) end),
    c.ex_role_unlocked,
    coalesce(c.lucky_skills[1:5], '{}'),
    nullif(left(btrim(coalesce(c.notes, '')), 500), '')
  from public.user_collection c
  join (
    select distinct on (x.pair_id) x.pair_id, btrim(x.label) as label
      from jsonb_to_recordset(
             case when jsonb_typeof(p_labels) = 'array' then p_labels else '[]'::jsonb end
           ) as x(pair_id text, label text)
     where nullif(btrim(x.label), '') is not null
     order by x.pair_id
  ) l on l.pair_id = c.pair_id
  where c.user_id = auth.uid()
    and c.owned
    and (c.potential > 0 or c.super_awakening > 0)
    and not exists (
      select 1 from public.member_pairs mp where mp.member_id = p_member and mp.pair_id = c.pair_id
    )
  on conflict (member_id, pair_label) do nothing;
  get diagnostics v_inserted = row_count;

  perform set_config('pm.mirror_backfill', '', true);
  return v_updated + v_inserted;
end;
$$;

revoke all on function public.backfill_my_member_pairs(uuid, jsonb) from public, anon;
grant execute on function public.backfill_my_member_pairs(uuid, jsonb) to authenticated;
