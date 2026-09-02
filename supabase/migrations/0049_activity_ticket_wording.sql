-- 0049: 變化紀錄的挑戰券用詞正式化 (2026-08-19 使用者: 一律用正式說法)
--
-- trigger 原本把單位寫進值裡 (「3券」), 顯示端只能原樣印。改成只存數字,
-- 單位由顯示層加 (「使用 3 張」) — 與拍組/糖果紀錄同樣「值就是值」的做法。

create or replace function public.log_battle_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_round text;
begin
  if tg_op = 'INSERT' then
    v_round := case
      when new.round is null then ''
      when new.round <= 3 then 'R' || new.round
      else 'Ex' || (new.round - 3)
    end;
    perform public.log_activity(new.gym_id, new.member_id, 'battle_log',
      v_round, null, new.tickets_used::text);
    return new;
  else
    v_round := case
      when old.round is null then ''
      when old.round <= 3 then 'R' || old.round
      else 'Ex' || (old.round - 3)
    end;
    perform public.log_activity(old.gym_id, old.member_id, 'battle_log',
      v_round, old.tickets_used::text, null);
    return old;
  end if;
end;
$$;

-- 既有紀錄去掉值裡的單位字
update public.gym_activity
set old_value = replace(old_value, '券', ''),
    new_value = replace(new_value, '券', '')
where kind = 'battle_log'
  and (old_value like '%券%' or new_value like '%券%');
