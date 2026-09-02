-- 0030 變化紀錄去雜訊 + 成員拍組單一寫入路徑
--
-- 1. gym_pairs / gym_teams 的 activity trigger 是「管理員設定動作」, 不是成員的練度變化。
--    它們 member_id 一律 null, 只有管理員看得到, 而且在紀錄牆上會畫成
--    「道館拍組 … 在名單 → 移除」這種讀不懂的卡 → 直接停止記錄並清掉舊資料。
--
-- 2. 管理員代改成員寶數時, 舊路徑只寫 member_pairs; 若該成員已綁定帳號,
--    他下次自己在「我的拍組」一改就會把管理員填的值蓋掉 (user_collection → member_pairs 是單向同步)。
--    改用 set_member_pair(): 一次寫 member_pairs, 並在成員已綁定時同步他的 user_collection。

-- ── 1. 停止記錄道館層級的設定動作 ──
drop trigger if exists gym_pairs_activity on public.gym_pairs;
drop trigger if exists gym_teams_activity on public.gym_teams;
drop function if exists public.log_gym_pair_change();
drop function if exists public.log_team_change();

delete from public.gym_activity where kind in ('gym_pair', 'team');

-- ── 2. 成員拍組寫入 (成員自己 or 該館管理員) ──
-- p_potential 0-5 (0 = 未持有), p_super_awakening 0-5; grade 由這兩者推導 (6 = 超覺醒)。
create or replace function public.set_member_pair(
  p_member uuid,
  p_pair_id text,
  p_pair_label text,
  p_potential int,
  p_super_awakening int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
  v_user uuid;
  v_grade smallint;
  v_pot int := least(greatest(coalesce(p_potential, 0), 0), 5);
  v_sa int := least(greatest(coalesce(p_super_awakening, 0), 0), 5);
begin
  select gym_id, user_id into v_gym, v_user
  from public.gym_members where id = p_member;
  if v_gym is null then
    raise exception '找不到這位成員';
  end if;
  if not (public.is_gym_admin(v_gym) or v_user = auth.uid()) then
    raise exception '沒有權限修改這位成員的拍組';
  end if;

  -- 超覺醒必然是寶5 之後的事
  if v_sa > 0 then
    v_pot := 5;
    v_grade := 6;
  else
    v_grade := v_pot;
  end if;

  insert into public.member_pairs (gym_id, member_id, pair_label, pair_id, grade, super_awakening, updated_at)
  values (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, now())
  on conflict (member_id, pair_label) do update
    set grade = excluded.grade,
        super_awakening = excluded.super_awakening,
        pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
        updated_at = now();

  -- 已綁定帳號的成員: 個人收藏才是真實來源, 一併更新才不會被下次同步蓋回去
  if v_user is not null and p_pair_id is not null then
    insert into public.user_collection (user_id, pair_id, owned, potential, super_awakening, updated_at)
    values (v_user, p_pair_id, v_pot > 0, v_pot, v_sa, now())
    on conflict (user_id, pair_id) do update
      set owned = excluded.owned,
          potential = excluded.potential,
          super_awakening = excluded.super_awakening,
          updated_at = now();
  end if;
end;
$$;

revoke all on function public.set_member_pair(uuid, text, text, int, int) from public;
grant execute on function public.set_member_pair(uuid, text, text, int, int) to authenticated;
