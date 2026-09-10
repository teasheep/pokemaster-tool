-- set_member_pair 換簽章: 補上 p_sync_grid (0063) 與 p_ex_role_unlocked (0065)。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- ⚠ **兩個新參數合併成同一次換簽章** (0063 與 0065 各要一個)。換兩次 = 兩次重收權限 =
--    兩次踩 0040 那個坑的機會。
--
-- 換簽章的三步 (照 0058 / 0059 的既定寫法, 少一步就會出事):
--   1. **先 drop 舊簽章** —— 多一個參數 = 全新的函式物件, 舊的那支會留著,
--      PostgREST 挑得到舊的 = 新參數靜靜不生效。
--   2. create 新版。
--   3. **revoke 只收 `public, anon`, 然後 grant 給 `authenticated`。**
--      ⚠ 這支**不可以**對 authenticated 收權限 —— 前端就是用那個角色呼叫它,
--      收掉就是管理員代改與側板編輯全部當場死掉。
--      (AGENTS「每一支 security definer 都要問 PostgREST 會不會曝出來」那條講的是
--       **不該給人呼叫**的函式; 這支相反, 它本來就是給登入者呼叫的 RPC。)
--      只 revoke public 是無效的, 所以要連 anon 一起寫 (0050 那個坑)。
--
-- 兩個新參數都沿用既有約定: **null = 不要動**。
--   卡片左下角的寶數循環不知道 (也不該知道) 這位成員的能量盤與 EX 體系,
--   一律不傳這兩個參數。null 被當成「設成預設值」的話, 每點一次左下角就把人家練好的洗掉。
--
-- 能量盤的上限規則寫在**這裡**而不是只在前端:
--   上限 = min(4, 寶數) + 1 (使用者確認的遊戲規則)。寶數降下來時能量盤要跟著降,
--   而寶數與能量盤可能在不同的呼叫裡被改 —— 只靠前端夾, 另一條寫入路徑就會漏。
--   `p_sync_grid` 是 null (不動) 時**照樣要夾**既有值, 否則「先滿盤再降寶數」會留下不合法的組合。

drop function if exists public.set_member_pair(uuid, text, text, int, int, int, int);

create or replace function public.set_member_pair(
  p_member uuid,
  p_pair_id text,
  p_pair_label text,
  p_potential int,
  p_super_awakening int,
  p_level int default null,
  p_promotion int default null,
  p_sync_grid int default null,
  p_ex_role_unlocked boolean default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gym uuid;
  v_user uuid;
  v_grade smallint;
  v_pot int := least(greatest(coalesce(p_potential, 0), 0), 5);
  v_sa int := least(greatest(coalesce(p_super_awakening, 0), 0), 5);
  -- 落在合法值上 (lib/collection-entry.ts 的 LEVEL_OPTIONS); null 保持 null = 不要動
  v_level int := case
    when p_level is null then null
    when p_level in (1, 140, 150, 180, 200) then p_level
    else 1
  end;
  -- 1..6 (6 = 6★EX); null 保持 null = 不要動
  v_promo int := case
    when p_promotion is null then null
    else least(greatest(p_promotion, 1), 6)
  end;
  -- 0..5 (索引, 對應 60/62/64/66/68/70); null 保持 null = 不要動
  v_grid int := case
    when p_sync_grid is null then null
    else least(greatest(p_sync_grid, 0), 5)
  end;
  -- 這次寫入之後的能量盤上限 (見檔頭)
  v_grid_cap int;
begin
  select gym_id, user_id into v_gym, v_user
  from public.gym_members where id = p_member;
  if v_gym is null then
    raise exception '找不到這位成員';
  end if;
  if not (public.is_gym_admin(v_gym) or v_user = auth.uid()) then
    raise exception '沒有權限修改這位成員的拍組';
  end if;

  if v_sa > 0 then
    v_pot := 5;
    v_grade := 5 + v_sa; -- 超覺醒 N = 6..10 (排序即強度)
  else
    v_grade := v_pot;
  end if;

  v_grid_cap := least(4, v_pot) + 1;

  if v_grade = 0 then
    delete from public.member_pairs
    where member_id = p_member
      and (pair_id = p_pair_id or (p_pair_id is null and pair_label = p_pair_label));
  else
    insert into public.member_pairs
      (gym_id, member_id, pair_label, pair_id, grade, super_awakening, level, promotion,
       sync_grid, ex_role_unlocked, updated_at)
    values
      (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, coalesce(v_level, 1), v_promo,
       least(v_grid, v_grid_cap), p_ex_role_unlocked, now())
    on conflict (member_id, pair_label) do update
      set grade = excluded.grade,
          super_awakening = excluded.super_awakening,
          pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
          -- 沒傳就保留原值 (左下角的寶數循環走的就是這條)
          level = coalesce(v_level, public.member_pairs.level),
          promotion = coalesce(v_promo, public.member_pairs.promotion),
          -- 能量盤: 沒傳保留原值, 但**一律夾在這次寶數算出來的上限內**
          -- (null 要維持 null = 沒設定過, 所以不能直接用 least —— least 會忽略 null)
          sync_grid = case
            when coalesce(v_grid, public.member_pairs.sync_grid) is null then null
            else least(coalesce(v_grid, public.member_pairs.sync_grid), v_grid_cap)
          end,
          ex_role_unlocked = coalesce(p_ex_role_unlocked, public.member_pairs.ex_role_unlocked),
          updated_at = now();
  end if;

  if v_user is not null and p_pair_id is not null then
    insert into public.user_collection
      (user_id, pair_id, owned, potential, super_awakening, level, promotion, ex_unlocked,
       sync_grid, ex_role_unlocked, updated_at)
    values
      (v_user, p_pair_id, v_pot > 0, v_pot, v_sa, coalesce(v_level, 1),
       coalesce(v_promo, 5), coalesce(v_promo, 5) >= 6,
       least(coalesce(v_grid, 0), v_grid_cap), coalesce(p_ex_role_unlocked, false), now())
    on conflict (user_id, pair_id) do update
      set owned = excluded.owned,
          potential = excluded.potential,
          super_awakening = excluded.super_awakening,
          level = coalesce(v_level, public.user_collection.level),
          promotion = coalesce(v_promo, public.user_collection.promotion),
          -- 6★EX 就是星數 6 (全站同一條規矩); 沒動星數就不要動它
          ex_unlocked = case
            when v_promo is null then public.user_collection.ex_unlocked
            else v_promo >= 6
          end,
          -- 這一欄 not null, 所以不必處理 null 的情況, 直接夾上限
          sync_grid = least(coalesce(v_grid, public.user_collection.sync_grid), v_grid_cap),
          ex_role_unlocked = coalesce(p_ex_role_unlocked, public.user_collection.ex_role_unlocked),
          updated_at = now();
  end if;
end;
$$;

-- 一律寫 `from public, anon`: 只 revoke public 是無效的 (0050 檔頭寫的那個坑)。
-- ⚠ 不要把 authenticated 也收掉 —— 前端就是用那個角色呼叫這支 RPC。
revoke all on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) to authenticated;
