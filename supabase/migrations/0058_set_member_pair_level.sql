-- 0058: set_member_pair 收 p_level —— 管理員在道館頁也能設成員的等級
--
-- 使用者 2026-09-07:「那是不是就把道館變成管理員也可以設就好, 盡可能統一阿」。
-- 0057 只做到「看得到」(member_pairs 補了 level 鏡像), 這一支補上「改得動」。
--
-- ⚠ **簽章換掉要 drop 舊的, 不是 create or replace** (0040 的前科, 0051 檔頭記著):
-- 多一個參數 = 全新的函式物件, 舊的那支 5 參數版**會留著**, 於是同時存在兩支
-- (PostgREST 挑得到舊的 = 等級靜靜不生效), 而且新那支會重新套用 Supabase 的
-- default privileges (anon 又拿得到 EXECUTE)。所以: 先 drop, 建完再照 0051 重收一次權限。
--
-- **`p_level` 是 null 就不要動等級** —— 這是這支函式最重要的性質:
-- 卡片左下角的寶數循環不知道 (也不該知道) 使用者的等級, 它一律不傳這個參數。
-- 如果 null 被當成「設成 1」, 管理員每點一次左下角就把那位成員辛苦設的 Lv200 洗成 Lv1。
-- 有 default 值所以舊的五參數呼叫照樣叫得動 (PostgREST 用具名參數解析)。

drop function if exists public.set_member_pair(uuid, text, text, int, int);

create or replace function public.set_member_pair(
  p_member uuid,
  p_pair_id text,
  p_pair_label text,
  p_potential int,
  p_super_awakening int,
  p_level int default null
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
  -- 落在合法值上 (lib/collection-entry.ts 的 LEVEL_OPTIONS); 其餘一律 1 = 還沒設定。
  -- null 一路保持 null, 由下面的 coalesce 決定「不要動」。
  v_level int := case
    when p_level is null then null
    when p_level in (1, 140, 150, 180, 200) then p_level
    else 1
  end;
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
    insert into public.member_pairs (gym_id, member_id, pair_label, pair_id, grade, super_awakening, level, updated_at)
    values (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, coalesce(v_level, 1), now())
    on conflict (member_id, pair_label) do update
      set grade = excluded.grade,
          super_awakening = excluded.super_awakening,
          pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
          -- 沒傳等級就保留原值 (左下角循環走的就是這條)
          level = coalesce(v_level, public.member_pairs.level),
          updated_at = now();
  end if;

  if v_user is not null and p_pair_id is not null then
    insert into public.user_collection (user_id, pair_id, owned, potential, super_awakening, level, updated_at)
    values (v_user, p_pair_id, v_pot > 0, v_pot, v_sa, coalesce(v_level, 1), now())
    on conflict (user_id, pair_id) do update
      set owned = excluded.owned,
          potential = excluded.potential,
          super_awakening = excluded.super_awakening,
          level = coalesce(v_level, public.user_collection.level),
          updated_at = now();
  end if;
end;
$$;

-- 權限照 0051 重收一次 —— 新簽章 = 新物件 = 重新套用了 default privileges (anon 會拿到 EXECUTE)。
-- 一律寫 `from public, anon`: 只 revoke public 是無效的 (0050 檔頭寫的那個坑)。
revoke all on function public.set_member_pair(uuid, text, text, int, int, int) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int) to authenticated;
