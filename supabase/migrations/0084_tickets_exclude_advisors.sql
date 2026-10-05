-- 0084: 顧問 / 待確認的人不能被發挑戰券 (2026-10-05)
--
-- 0028 定義顧問「不佔名額、排刀/券數/統計都不算」, 0072 把這條收進 member_counts_in_gym(),
-- 但 member_tickets 的 insert 一直只看 member_in_gym —— 管理員按「全員發放挑戰券」時,
-- 看板的挑戰券側板又把顧問也列成「尚未發放」, 一按就每位顧問各 30 張 (線上就有一筆:
-- 小鳴 9/28 還是正式成員時領的券, 9/30 轉顧問後留著, 讓「剩 / 上限」多算 30 張)。
--
-- 使用者的兩個條件 (2026-10-05):
--   1.「舊道館戰的紀錄要保留」—— 只擋**新發**的券, 既有的列 (轉顧問之前領的) 一律不動、照樣調得動。
--   2.「不能影響顧問在自己道館的正確票券數」—— 判斷用的是 member_id = gym_members 那一列,
--      一個人在 A 館是顧問、在 B 館是正式成員是兩列, B 館的券完全不受影響。
--
-- ⚠ 不能只改 insert policy: adjust_member_ticket 是 `insert … on conflict do update`, 而 Postgres 對
--   upsert **一律先檢查 insert policy 的 with check** (就算最後走的是 update) —— 只改 policy 的話,
--   管理員就再也調不動「轉成顧問的人在舊賽事的券」, 違反條件 1。所以 RPC 改成「先 update, 沒有才 insert」,
--   新條件只落在真的要新建一列的那條路上。

drop policy if exists "member_tickets_insert" on public.member_tickets;
create policy "member_tickets_insert" on public.member_tickets
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and public.member_counts_in_gym(member_id)
    and public.is_gym_editor(gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

-- 簽章不變 (create or replace 保留既有權限, 不會重新套 default privileges —— 見 AGENTS「改 RPC 簽章」那條)
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
  -- 已經有這一列: 直接調 (update policy 照舊, 轉成顧問的人在舊賽事的券也調得動)
  update public.member_tickets
     set cap = greatest(0, least(99, cap + p_cap_delta)),
         remaining = greatest(0, least(greatest(0, least(99, cap + p_cap_delta)), remaining + p_delta))
   where battle_id = p_battle and member_id = p_member
  returning remaining into v_remaining;
  if found then
    return v_remaining;
  end if;

  -- 還沒有: 新建 (insert policy 擋顧問 / 待確認); 兩個人同時建時第二個走 on conflict
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
