-- 0038: 練度軸統一成 0-10 (0=無持有, 1-5=寶1-5, 6-10=超覺醒1-5)
--
-- 之前 grade/min_grade 的 6 是「超覺醒 (不分級)」, 隊伍需求點寶數會從寶5 直接跳「超覺醒」,
-- 使用者指正: 應該是 寶5 → 超覺醒1 → … → 超覺醒5。member_pairs 本來就另存 super_awakening,
-- 只是 grade 軸被壓平 — 這裡把三張表的 check 放寬並回填, 全站同一條軸。

-- 1) 放寬 check
alter table public.member_pairs drop constraint if exists member_pairs_grade_check;
alter table public.member_pairs add constraint member_pairs_grade_check check (grade between 0 and 10);

alter table public.gym_team_pairs drop constraint if exists gym_team_pairs_min_grade_check;
alter table public.gym_team_pairs add constraint gym_team_pairs_min_grade_check check (min_grade between 0 and 10);

alter table public.stage_plan_pairs drop constraint if exists stage_plan_pairs_min_grade_check;
alter table public.stage_plan_pairs add constraint stage_plan_pairs_min_grade_check check (min_grade between 0 and 10);

-- 2) 回填 member_pairs: 等級未知的 grade=6 是舊表單匯入的「超覺醒」,
--    表單慣例 = 超覺醒5 (使用者 2026-08-17 確認); 有等級的用自己的等級
update public.member_pairs set super_awakening = 5 where grade = 6 and super_awakening = 0;
update public.member_pairs set grade = 5 + super_awakening where grade = 6 and super_awakening > 0;

-- (gym_team_pairs.min_grade 既有的 6 = 「至少超覺醒」→ 新軸的 6 = 至少超覺醒1, 語意不變, 不動)

-- 3) set_member_pair 改寫 grade 的映射 (其餘與 0031 相同)
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

  if v_sa > 0 then
    v_pot := 5;
    v_grade := 5 + v_sa; -- 超覺醒 N = 6..10 (排序即強度)
  else
    v_grade := v_pot;
  end if;

  if v_grade = 0 then
    delete from public.member_pairs
    where member_id = p_member
      and (pair_id = p_pair_id or (p_pair_id is null and pair_label = p_pair_label));
  else
    insert into public.member_pairs (gym_id, member_id, pair_label, pair_id, grade, super_awakening, updated_at)
    values (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, now())
    on conflict (member_id, pair_label) do update
      set grade = excluded.grade,
          super_awakening = excluded.super_awakening,
          pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
          updated_at = now();
  end if;

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
