-- 0026: 全站變化紀錄 (取代 0019 的 member_pair_history)
--   由 DB trigger 記錄, 不管從哪條路徑改都跑得掉
--   可見性: 管理員看全館, 一般成員只看自己的
--   涵蓋: 拍組寶數 / 糖果 / 挑戰券 / 出戰紀錄 / 道館拍組名單 / 隊伍

create table if not exists public.gym_activity (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null,
  /** 對象成員 (null = 道館層級的變動, 只有管理員看得到) */
  member_id uuid,
  /** 操作者 (auth.uid; 匯入腳本為 null) */
  actor_id uuid,
  kind text not null,
  target text,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists gym_activity_gym_time on public.gym_activity (gym_id, created_at desc);
create index if not exists gym_activity_member_time on public.gym_activity (member_id, created_at desc);

alter table public.gym_activity enable row level security;

drop policy if exists gym_activity_select on public.gym_activity;
create policy gym_activity_select on public.gym_activity
  for select using (
    public.is_gym_admin(gym_id)
    or (member_id is not null and public.is_self_member(member_id))
  );

grant select on public.gym_activity to authenticated;

-- 舊的拍組紀錄搬過來 (0019 的資料不丟)
insert into public.gym_activity (gym_id, member_id, kind, target, old_value, new_value, created_at)
select gym_id, member_id, 'pair', pair_label,
       case when old_grade is null then null else old_grade::text end,
       case when new_grade is null then null else new_grade::text end,
       changed_at
from public.member_pair_history
on conflict do nothing;

drop trigger if exists member_pairs_history on public.member_pairs;
drop function if exists public.log_member_pair_change();
drop table if exists public.member_pair_history;

-- ── 通用寫入輔助 ──
create or replace function public.log_activity(
  p_gym uuid, p_member uuid, p_kind text, p_target text, p_old text, p_new text
) returns void
language sql security definer set search_path = public as $$
  insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, old_value, new_value)
  values (p_gym, p_member, auth.uid(), p_kind, p_target, p_old, p_new);
$$;

-- 拍組寶數/超覺醒
create or replace function public.log_member_pair_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.grade, 0) > 0 then
      perform public.log_activity(new.gym_id, new.member_id, 'pair', new.pair_label, null, new.grade::text);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.grade is distinct from old.grade
       or new.super_awakening is distinct from old.super_awakening then
      v_old := old.grade::text ||
        case when old.super_awakening > 0 then '+覺' || old.super_awakening else '' end;
      v_new := new.grade::text ||
        case when new.super_awakening > 0 then '+覺' || new.super_awakening else '' end;
      perform public.log_activity(new.gym_id, new.member_id, 'pair', new.pair_label, v_old, v_new);
    end if;
    return new;
  else
    perform public.log_activity(old.gym_id, old.member_id, 'pair', old.pair_label, old.grade::text, null);
    return old;
  end if;
end;
$$;

drop trigger if exists member_pairs_activity on public.member_pairs;
create trigger member_pairs_activity
  after insert or update or delete on public.member_pairs
  for each row execute function public.log_member_pair_change();

-- 糖果
create or replace function public.log_candy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
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

drop trigger if exists member_candies_activity on public.member_candies;
create trigger member_candies_activity
  after insert or update or delete on public.member_candies
  for each row execute function public.log_candy_change();

-- 挑戰券
create or replace function public.log_ticket_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.gym_id, new.member_id, 'ticket', null, null, new.remaining::text);
  elsif new.remaining is distinct from old.remaining then
    perform public.log_activity(new.gym_id, new.member_id, 'ticket', null, old.remaining::text, new.remaining::text);
  end if;
  return new;
end;
$$;

drop trigger if exists member_tickets_activity on public.member_tickets;
create trigger member_tickets_activity
  after insert or update on public.member_tickets
  for each row execute function public.log_ticket_change();

-- 出戰紀錄 (誰打了哪關幾券)
create or replace function public.log_battle_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stage text;
begin
  if tg_op = 'INSERT' then
    select '關' || seq into v_stage from public.battle_stages where id = new.stage_id;
    perform public.log_activity(new.gym_id, new.member_id, 'battle_log',
      coalesce(v_stage, '') || ' R' || coalesce(new.round, 0), null, new.tickets_used::text || '券');
    return new;
  else
    select '關' || seq into v_stage from public.battle_stages where id = old.stage_id;
    perform public.log_activity(old.gym_id, old.member_id, 'battle_log',
      coalesce(v_stage, '') || ' R' || coalesce(old.round, 0), old.tickets_used::text || '券', null);
    return old;
  end if;
end;
$$;

drop trigger if exists battle_logs_activity on public.battle_logs;
create trigger battle_logs_activity
  after insert or delete on public.battle_logs
  for each row execute function public.log_battle_log_change();

-- 道館拍組名單 (道館層級 — member_id null)
create or replace function public.log_gym_pair_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.gym_id, null, 'gym_pair', new.pair_label, null, '加入名單');
    return new;
  else
    perform public.log_activity(old.gym_id, null, 'gym_pair', old.pair_label, '在名單', null);
    return old;
  end if;
end;
$$;

drop trigger if exists gym_pairs_activity on public.gym_pairs;
create trigger gym_pairs_activity
  after insert or delete on public.gym_pairs
  for each row execute function public.log_gym_pair_change();

-- 隊伍 (道館層級)
create or replace function public.log_team_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.gym_id, null, 'team', new.name, null, '新增');
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name or new.tag is distinct from old.tag then
      perform public.log_activity(new.gym_id, null, 'team', new.name, old.name || '/' || old.tag, new.name || '/' || new.tag);
    end if;
    return new;
  else
    perform public.log_activity(old.gym_id, null, 'team', old.name, '存在', null);
    return old;
  end if;
end;
$$;

drop trigger if exists gym_teams_activity on public.gym_teams;
create trigger gym_teams_activity
  after insert or update or delete on public.gym_teams
  for each row execute function public.log_team_change();
