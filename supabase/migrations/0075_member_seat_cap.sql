-- 0075: 道館正式成員上限 20 人
--
-- 背景: 遊戲內的「訓練家道館」是 20 人公會, 但這個上限**從來沒有被實作過** ——
--   join_gym 沒檢查、gym_members 沒有 constraint 也沒有 trigger、核准那顆勾勾就是
--   一句 update({status:'active'})。2026-09-20 有成員回報「道館可以超過 20 人」,
--   查線上資料: 九彩 9/12 滿 20, 9/19 由管理員放行第 21 人 (資料本身是乾淨的,
--   沒有重複列也沒有孤兒列, 就是單純沒有人在擋)。
--
-- 怎麼算 (與 0028/0072 對顧問的定義一致):
--   佔名額 = status = 'active' 且 role <> 'advisor'。顧問是唯讀觀察者, 不佔名額;
--   管理員算 (他也是公會的一員); pending 不算 (還沒放行)。
--
-- ⚠ **只檢查「這一列變成佔名額」這個動作, 不檢查既有列**。
--   九彩現在就是 21 人 —— 如果寫成「這一館不得超過 20」那種 constraint/trigger,
--   那一館的管理員連改別人的練度、改個圓圈文字都會被擋下來 (每次 update 都重新檢查),
--   整館直接動不了。所以條件是「原本不佔名額 → 現在要佔名額」才擋, 既有超額沿用。
--
-- ⚠ 這是**第二層**。第一層在前端 (members-client 的核准按鈕會先擋並說明原因),
--   但 RLS policy 攔不到 security definer 的函式、前端也繞得過去, 所以資料庫要有保底
--   (與拍檔石盤上限「兩條寫入路徑各夾一次」同一個道理)。

create or replace function public.enforce_member_seat_cap()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_seats int;
begin
  -- 只在「這一列開始佔名額」時檢查:
  --   INSERT 一列 active 的非顧問, 或 UPDATE 讓原本不佔名額的列變成佔名額
  --   (pending → active, 或 advisor → member/admin)。
  if new.status <> 'active' or new.role = 'advisor' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.role <> 'advisor' then
    return new;   -- 本來就佔著名額 (改名字、改練度、admin ↔ member) → 不干涉
  end if;

  select count(*) into v_seats
    from public.gym_members
   where gym_id = new.gym_id
     and status = 'active'
     and role <> 'advisor'
     and id <> new.id;

  if v_seats >= 20 then
    raise exception 'GYM_FULL';
  end if;
  return new;
end;
$$;

comment on function public.enforce_member_seat_cap() is
  '道館正式成員上限 20 (顧問與待確認不計)。只擋「變成佔名額」的動作, 既有超額的道館不受影響。';

drop trigger if exists gym_members_seat_cap on public.gym_members;
create trigger gym_members_seat_cap
  before insert or update on public.gym_members
  for each row execute function public.enforce_member_seat_cap();

-- 與站上其他 security definer 函式同一條規矩 (0050/0051): 不要讓 PostgREST 當成 RPC 曝出來。
-- (trigger 函式由 trigger 以 owner 身分呼叫, 收掉 EXECUTE 不影響它。)
revoke all on function public.enforce_member_seat_cap() from public, anon, authenticated;
