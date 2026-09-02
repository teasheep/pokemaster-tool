-- 0027: 變化紀錄帶 pair_id — 紀錄列要顯示拍組圖片 (label 對圖鑑可能對不到, 用 id 準)
alter table public.gym_activity
  add column if not exists target_id text;

create or replace function public.log_member_pair_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.grade, 0) > 0 then
      insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
      values (new.gym_id, new.member_id, auth.uid(), 'pair', new.pair_label, new.pair_id, null, new.grade::text);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
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
    insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
    values (old.gym_id, old.member_id, auth.uid(), 'pair', old.pair_label, old.pair_id, old.grade::text, null);
    return old;
  end if;
end;
$$;

create or replace function public.log_gym_pair_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
    values (new.gym_id, null, auth.uid(), 'gym_pair', new.pair_label, new.pair_id, null, '加入名單');
    return new;
  else
    insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
    values (old.gym_id, null, auth.uid(), 'gym_pair', old.pair_label, old.pair_id, '在名單', null);
    return old;
  end if;
end;
$$;

-- 既有紀錄回填 pair_id (用 label 對 member_pairs/gym_pairs)
update public.gym_activity a
set target_id = mp.pair_id
from public.member_pairs mp
where a.target_id is null and a.kind = 'pair'
  and mp.member_id = a.member_id and mp.pair_label = a.target and mp.pair_id is not null;
