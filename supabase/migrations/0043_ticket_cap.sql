-- 0043: 挑戰券改「剩餘 / 上限」且上限可調 (2026-08-17 使用者要求, 模擬排刀用)
--
-- 之前: remaining 0-30, 發券 9 張 (官方開賽發 9、每日 +3)。館內實際用法是
-- 「這場總共 30 刀」直接從 30 往下扣, 所以發券預設 30/30; 上限可微調
-- (成員中途加入 / 不打滿時模擬)。顯示一律「剩餘 / 上限」。

alter table public.member_tickets
  add column if not exists cap smallint not null default 30;

alter table public.member_tickets
  alter column remaining set default 30;

-- remaining 的舊 check (0-30) 換成「0 ~ 上限」; cap 留餘裕到 99
alter table public.member_tickets
  drop constraint if exists member_tickets_remaining_check;
alter table public.member_tickets
  drop constraint if exists member_tickets_cap_check;
alter table public.member_tickets
  add constraint member_tickets_cap_check check (cap between 0 and 99);
alter table public.member_tickets
  add constraint member_tickets_remaining_check check (remaining between 0 and cap);

-- RPC 改成同時能調剩餘與上限 (各自原子運算, 連點/多人同時操作不互蓋)。
-- row 不存在時以 30/30 為基底建立; 上限往下調會把剩餘一起夾住 (顯示恆為 X ≤ Y)。
drop function if exists public.adjust_member_ticket(uuid, uuid, uuid, int);

create or replace function public.adjust_member_ticket(
  p_gym uuid, p_battle uuid, p_member uuid, p_delta int default 0, p_cap_delta int default 0
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_remaining int;
begin
  insert into public.member_tickets (gym_id, battle_id, member_id, cap, remaining)
  values (
    p_gym, p_battle, p_member,
    greatest(0, least(99, 30 + p_cap_delta)),
    greatest(0, least(greatest(0, least(99, 30 + p_cap_delta)), 30 + p_delta))
  )
  on conflict (battle_id, member_id)
  do update set
    cap = greatest(0, least(99, member_tickets.cap + p_cap_delta)),
    remaining = greatest(0, least(
      greatest(0, least(99, member_tickets.cap + p_cap_delta)),
      member_tickets.remaining + p_delta
    ))
  returning remaining into v_remaining;
  return v_remaining;
end;
$$;

grant execute on function public.adjust_member_ticket(uuid, uuid, uuid, int, int)
  to authenticated, service_role;
