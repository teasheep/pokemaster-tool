-- 0072: 顧問的練度不屬於這一館
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-10 使用者:「理論上是看不到顧問的拍組的才對吧? 顧問互相也不應該看得到對吧?」
-- —— 對, 而且**現在擋不住**。0028 定義顧問是「唯讀觀察者, 不佔 20 人名額,
-- 排刀/券數/統計都不算」, 但那一版只把 is_gym_editor 加到 battle_logs / member_tickets /
-- stage_assignments, **member_pairs / member_candies / member_type_focus 三張漏了**。
--
-- 實際後果 (線上查過, 目前三位顧問都是 0 列, 所以還沒有人踩到):
--   1. 顧問只要用 /pairs 記自己的練度, 而目前道館 (cookie) 剛好是那一館,
--      syncMemberPair 就會把他的收藏鏡射進 member_pairs —— 全館看得到, 顧問之間也看得到。
--   2. 那些列會被算進「持有 N / M 人」的**分子**, 而分母 (members) 不含顧問 →
--      有機會出現「持有 20 / 19 人」, 而且側板的持有者清單會冒出一顆
--      沒有頭像、名字是「?」的晶片 (memberById 查不到他)。
--   3. 同一條路也適用**被降級的成員**: 管理員把一位成員改成顧問, 他原本的 member_pairs
--      還在, 於是分子照算 —— 這條今天就按得到 (編輯成員的角色下拉)。
--
-- ── 這支做什麼 ──────────────────────────────────────────────────────────────
--   一句話: **「這一列成員算不算道館的一員」變成一個明確的判斷** (member_counts_in_gym),
--   三張成員資料表的寫入與 set_member_pair 都吃它。顧問 (0028) 與待確認 (0071) 都不算。
--
-- ── 刻意**不刪**任何既有資料 ────────────────────────────────────────────────
--   降級成顧問再改回成員時, 他原本的練度要回得來 —— 與 AGENTS 那條
--   「未持有只是不給編, 不要清掉已經存的值」是同一個判斷。所以這裡只擋寫入,
--   統計與畫面那一半在前端排除 (members/page.tsx 的 grades 只收正式成員)。
--   線上現在是 0 列, 這段話是為了將來降級的人寫的。
--
-- ── 沒有動到的 ──────────────────────────────────────────────────────────────
--   顧問**照舊看得到全館成員的練度、看板、道館紀錄** —— 那是顧問這個角色的用途,
--   使用者問的是「顧問自己的拍組」, 不是「顧問看別人」。
--   member_tickets / battle_logs 也沒動: 0028 已經有 is_gym_editor (顧問寫不進去),
--   而「發券給顧問」沒有任何入口, 線上也是 0 列。

/**
 * 這一列 gym_members 算不算「道館的一員」——
 * 顧問 (唯讀觀察者, 不佔名額) 與待確認的人 (0071) 都不算。
 * 名字用 member_ 開頭是跟著 member_in_gym 的命名走: 參數是**那一列**, 不是呼叫者。
 */
create or replace function public.member_counts_in_gym(p_member uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where id = p_member and role in ('admin', 'member') and status = 'active'
  );
$$;

grant execute on function public.member_counts_in_gym(uuid) to anon, authenticated;

-- ── 三張成員資料表: 寫入要「呼叫者是編輯者」且「那一列算道館的一員」 ──
--
-- 兩個條件缺一不可, 擋的是兩件不同的事:
--   is_gym_editor(gym_id)        → 顧問拿自己的帳號寫別人 (0028 對其他表做過的)
--   member_counts_in_gym(...)    → 寫到顧問/待確認那一列上 (包含他寫自己)

drop policy if exists "member_pairs_insert" on public.member_pairs;
create policy "member_pairs_insert" on public.member_pairs
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "member_pairs_update" on public.member_pairs;
create policy "member_pairs_update" on public.member_pairs
  for update using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  ) with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

-- ⚠ delete **不加限制**: 降級成顧問之後管理員仍要清得掉舊列, 而且
--   syncMemberPair 在寶0 時就是走 delete —— 擋掉會讓「點回未持有」變成靜默失敗。

drop policy if exists "member_candies_insert" on public.member_candies;
create policy "member_candies_insert" on public.member_candies
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists "member_candies_update" on public.member_candies;
create policy "member_candies_update" on public.member_candies
  for update using (
    public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  ) with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

-- member_type_focus (0056) 只有 insert / delete (切換 = 有列或沒列, 沒有 update)
drop policy if exists "member_type_focus_insert" on public.member_type_focus;
create policy "member_type_focus_insert" on public.member_type_focus
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

-- ── set_member_pair 也要自己擋一次 ──
--
-- 這支是 security definer (以 owner 身分跑), **RLS 對它無效** —— 上面那幾條 policy
-- 一條都攔不到它。同一條規則在兩個地方各寫一次是這張表的常態
-- (拍檔石盤上限也是 syncMemberPair 與這支各夾一次)。
--
-- 以下是 0069 的原文, **只多了權限檢查後面那一句 guard**, 其餘一個字都沒動。

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
  -- 0072: 顧問與待確認的人在這一館沒有練度資料 (見 0072 檔頭)。
  -- 這支是 security definer, **RLS 對它無效** —— member_pairs 那條 policy 擋不到這裡,
  -- 所以同一條規則在函式裡要自己再寫一次 (與拍檔石盤上限那條同一個道理)。
  if not public.member_counts_in_gym(p_member) then
    raise exception '這一位不在名單上 (顧問或還在等確認)';
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
-- 這支簽章沒變 (create or replace 不會重置 ACL), 照 0066 再收一次只是保險。
revoke all on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean) to authenticated;
