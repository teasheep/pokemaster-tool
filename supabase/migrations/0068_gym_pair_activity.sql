-- 道館拍組名單重新記錄進編輯紀錄 (0030 停掉的那一半)。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-10 使用者:「編輯記錄是不是沒有記錄誰把什麼拍組設成道館拍組?」—— 對, 0030 拔掉了。
--
-- **0030 當初拔掉的理由是畫面, 不是資料**: 它在紀錄牆上會畫成「道館拍組 … 在名單 → 移除」
-- 這種讀不懂的卡。那條理由現在不成立了 —— 編輯紀錄改版之後每種 kind 各自造句
-- (AGENTS「文案每種 kind 各自造句」), 而且卡片吃 target_id 就能畫出真正的官方卡面。
--
-- **只加回 gym_pair, 不加回 team**: 隊伍是「這一館現在的設定」, 改了就是改了,
-- 沒有人會回頭查誰在哪一天改過隊名; 道館拍組名單則是多人同時在改的東西
-- (見 AGENTS 那條「三個機制缺一不可」), 誰加了誰取消是真的會有人問的。
--
-- 這一列的 member_id 一律 null = 道館層級 → RLS 只有管理員看得到 (0026 的 policy),
-- 這是刻意的: 名單是管理員在改的, 一般成員的紀錄頁不該混進來。
-- actor_id 照舊記 auth.uid(), 所以「誰改的」查得到。
--
-- 直接 insert 不走 log_activity: 與 0027 的寫法一致 (要帶 target_id), 也順便繞開
-- 0050 對 log_activity 的 revoke —— 這支是 security definer 且 owner 是 postgres,
-- 但少一層呼叫就少一個會壞的地方。

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

drop trigger if exists gym_pairs_activity on public.gym_pairs;
create trigger gym_pairs_activity
  after insert or delete on public.gym_pairs
  for each row execute function public.log_gym_pair_change();

-- returns trigger 的函式 PostgREST 不會當 RPC 曝出來, 但照 0050 的一般原則還是收一次
revoke all on function public.log_gym_pair_change() from public, anon, authenticated;
