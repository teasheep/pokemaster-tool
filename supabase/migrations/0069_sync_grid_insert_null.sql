-- ⚠ 新增 member_pairs 列時拍檔石盤被自動塞到上限 —— Postgres 的 least() 會忽略 NULL。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 使用者 2026-09-10 回報:「我不知道怎麼點出傑瑞的拍檔石盤變成62?? 我也改不回60」。
-- 查到的那一列: 小青（2026週年慶）&太樂巴戈斯, grade 4, sync_grid 1, 而 user_collection 那邊是 0。
--
-- 根因: 0063 起 member_pairs 的 insert 分支寫的是 `least(v_grid, v_grid_cap)`,
-- 而 `p_sync_grid` 沒傳時 v_grid 是 **null**。**Postgres 的 least()/greatest() 會直接忽略 NULL**
-- (與 Oracle 相反, 那邊是回 NULL) → `least(null, 1)` = **1**, 不是 null。
-- 於是「左下角寶數循環把一張卡從寶0 點回寶1」= 刪列再新增列, 那一列的石盤就被塞成當下的上限。
-- 完全沒有徵兆: 沒有錯誤、activity 也不會記 (trigger 只在 grade/super_awakening 變動時記),
-- 只有卡牆上悄悄多一顆「62」的徽章。
--
-- 同一支函式的另外三處都寫對了 (`coalesce(v_grid, 0)` / `coalesce(v_grid, 既有值)`),
-- 只有 member_pairs 的 insert 漏掉 —— 這正是「同一條規則在四個地方各寫一次」的代價。
--
-- 修法: insert 也走 `coalesce(v_grid, 0)`, 語意 = 沒傳就是「還沒升」。
-- 順手把已經被寫壞的列清掉 (只清「這一列的 sync_grid 等於上限而且 user_collection 那邊是 0/不存在」
-- 這種明顯是被自動塞進去的; 使用者真的自己升過的不會動到 —— 判準見下面那句 update 的 where)。

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

  v_grid_cap := v_pot;  -- 上限索引 = 寶數 (0067 更正)

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
       -- ⚠ coalesce 一定要在裡面: Postgres 的 least() **會忽略 NULL** (見檔頭)
       least(coalesce(v_grid, 0), v_grid_cap), p_ex_role_unlocked, now())
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

-- ── 修既有資料 ──
-- 只有 member_pairs 會被塞 (user_collection 那三處本來就有 coalesce), 所以拿 user_collection 當對照:
-- 成員已綁帳號、他自己的收藏那一列石盤是 0 (或根本沒有那一列), 但道館這邊卻不是 0
-- → 那個值不是他設的, 是 insert 塞進去的。兩邊都非 0 的 (真的自己升過) 一列都不動。
update public.member_pairs mp
   set sync_grid = 0
  from public.gym_members gm
 where gm.id = mp.member_id
   and coalesce(mp.sync_grid, 0) <> 0
   and coalesce((
         select uc.sync_grid from public.user_collection uc
          where uc.user_id = gm.user_id and uc.pair_id = mp.pair_id
       ), 0) = 0;

revoke all on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) to authenticated;
