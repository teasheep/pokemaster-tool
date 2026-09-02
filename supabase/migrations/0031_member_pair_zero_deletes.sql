-- 0031 set_member_pair: 寶0 = 不持有 → 刪列 (與 collection-sync.ts 同一套語意)
-- grade=0 的幽靈列會被「持有 N 組」「全館持有率」算進去, 所以歸零一律刪列。
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
    v_grade := 6;
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
