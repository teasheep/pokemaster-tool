-- 0076: 拍組的潛能 (最多 5 個) 與備註 —— 道館看得到, 管理員也能代改
--
-- 2026-09-29 使用者:「找到每個拍組對應可以使用的所有特殊潛能, 分類讓使用者選擇」、
-- 「一個拍組可以有至多五個潛能, 要可以多選」、「每個拍組可以加備註」, 並指定兩者道館都看得到。
--
-- user_collection 早就有 lucky_skills (text[]) 與 notes, 只是一直沒有 UI。這一支做三件事:
--   1. member_pairs 補兩個**鏡像**欄位 (與 0057 level / 0059 promotion 同一條老路) + 從收藏回填;
--   2. set_member_pair 多兩個參數 —— **null = 不要動** (這支函式最重要的性質, 見 0058);
--      左下角的寶數循環不知道也不該知道潛能與備註, 一律不傳, 傳 null 當成「清空」的話
--      管理員每點一次左下角就把人家的潛能洗掉。清空備註要傳空字串 '', 清空潛能要傳 '{}'。
--   3. 兩張表都加上限: 潛能最多 5 個、備註最多 500 字 (前端也夾同樣的數字, tests/potentials.test.ts 釘住)。
--
-- 部署順序: **先套這支, 再上前端** —— 這支向下相容 (欄位可空、新參數有預設值, 舊前端照常呼叫);
-- 反過來的話新前端送 p_lucky_skills 給舊函式會 404 (PGRST202), syncMemberPair 寫新欄位會 400。
--
-- 道館紀錄 (gym_activity) 不受影響: log_member_pair_change 只在 grade / super_awakening 變動時記一筆,
-- 改潛能與備註不會洗版 (刻意的 —— 那是「成員練度的事件」, 不是每一次編輯)。

-- ── 1. 鏡像欄位 + 上限 ──
alter table public.member_pairs
  add column if not exists lucky_skills text[] not null default '{}',
  add column if not exists notes text;

alter table public.member_pairs drop constraint if exists member_pairs_lucky_skills_max5;
alter table public.member_pairs add constraint member_pairs_lucky_skills_max5
  check (cardinality(lucky_skills) <= 5);
alter table public.member_pairs drop constraint if exists member_pairs_notes_len;
alter table public.member_pairs add constraint member_pairs_notes_len
  check (notes is null or char_length(notes) <= 500);

alter table public.user_collection drop constraint if exists user_collection_lucky_skills_max5;
alter table public.user_collection add constraint user_collection_lucky_skills_max5
  check (cardinality(lucky_skills) <= 5);
alter table public.user_collection drop constraint if exists user_collection_notes_len;
alter table public.user_collection add constraint user_collection_notes_len
  check (notes is null or char_length(notes) <= 500);

-- 回填: 已綁帳號的成員, 從他的收藏抄過來 (與 0057 同一個寫法)
update public.member_pairs mp
   set lucky_skills = coalesce(uc.lucky_skills, '{}'),
       notes = uc.notes
  from public.gym_members gm, public.user_collection uc
 where gm.id = mp.member_id
   and gm.user_id is not null
   and uc.user_id = gm.user_id
   and uc.pair_id = mp.pair_id
   and (mp.lucky_skills is distinct from coalesce(uc.lucky_skills, '{}') or mp.notes is distinct from uc.notes);

-- ── 2. set_member_pair: 多兩個參數 ──
-- ⚠ 簽章換掉 = 全新的函式物件, 舊的那支**會留著** (PostgREST 挑得到舊的 = 新參數靜靜不生效),
--   而且新那支會重新套用 default privileges → anon 又拿得到 EXECUTE (0040 / 0058 的前科)。
--   所以: 先 drop 舊簽章, 建完再重收一次權限。
drop function if exists public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean);

create or replace function public.set_member_pair(
  p_member uuid,
  p_pair_id text,
  p_pair_label text,
  p_potential int,
  p_super_awakening int,
  p_level int default null,
  p_promotion int default null,
  p_sync_grid int default null,
  p_ex_role_unlocked boolean default null,
  p_lucky_skills text[] default null,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gym uuid;
  v_user uuid;
  v_grade smallint;
  v_pot int := least(greatest(coalesce(p_potential, 0), 0), 5);
  v_sa int := least(greatest(coalesce(p_super_awakening, 0), 0), 5);
  -- 落在合法值上 (lib/collection-entry.ts 的 LEVEL_OPTIONS); null 保持 null = 不要動
  v_level int := case
    when p_level is null then null
    when p_level in (1, 140, 150, 180, 200) then p_level
    else 1
  end;
  -- 1..6 (6 = 6★EX); null 保持 null = 不要動
  v_promo int := case
    when p_promotion is null then null
    else least(greatest(p_promotion, 1), 6)
  end;
  -- 0..5 (索引, 對應 60/62/64/66/68/70); null 保持 null = 不要動
  v_grid int := case
    when p_sync_grid is null then null
    else least(greatest(p_sync_grid, 0), 5)
  end;
  -- 這次寫入之後的能量盤上限 (見 0067)
  v_grid_cap int;
  -- 潛能: null = 不要動; 否則去重 (保留順序)、只收數字 id、最多 5 個
  v_lucky text[] := case
    when p_lucky_skills is null then null
    else array(
      select x from unnest(p_lucky_skills) with ordinality u(x, o)
       where x ~ '^[0-9]{6,10}$'
       group by x order by min(o) limit 5
    )
  end;
  -- 備註: null = 不要動; '' (或只有空白) = 清空; 最多 500 字
  v_notes text := case when p_notes is null then null else left(btrim(p_notes), 500) end;
begin
  select gym_id, user_id into v_gym, v_user
  from public.gym_members where id = p_member;
  if v_gym is null then
    raise exception '找不到這位成員';
  end if;
  if not (public.is_gym_admin(v_gym) or v_user = auth.uid()) then
    raise exception '沒有權限修改這位成員的拍組';
  end if;
  -- 0072: 顧問與待確認的人在這一館沒有練度資料。security definer → RLS 攔不到, 要自己擋。
  if not public.member_counts_in_gym(p_member) then
    raise exception '這一位不在名單上 (顧問或還在等確認)';
  end if;

  if v_sa > 0 then
    v_pot := 5;
    v_grade := 5 + v_sa; -- 超覺醒 N = 6..10 (排序即強度)
  else
    v_grade := v_pot;
  end if;

  v_grid_cap := v_pot;  -- 上限索引 = 寶數 (0067 更正)

  if v_grade = 0 then
    delete from public.member_pairs
    where member_id = p_member
      and (pair_id = p_pair_id or (p_pair_id is null and pair_label = p_pair_label));
  else
    insert into public.member_pairs
      (gym_id, member_id, pair_label, pair_id, grade, super_awakening, level, promotion,
       sync_grid, ex_role_unlocked, lucky_skills, notes, updated_at)
    values
      (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, coalesce(v_level, 1), v_promo,
       -- ⚠ coalesce 一定要在裡面: Postgres 的 least() **會忽略 NULL** (見 0069)
       least(coalesce(v_grid, 0), v_grid_cap), p_ex_role_unlocked,
       coalesce(v_lucky, '{}'), nullif(v_notes, ''), now())
    on conflict (member_id, pair_label) do update
      set grade = excluded.grade,
          super_awakening = excluded.super_awakening,
          pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
          -- 沒傳就保留原值 (左下角的寶數循環走的就是這條)
          level = coalesce(v_level, public.member_pairs.level),
          promotion = coalesce(v_promo, public.member_pairs.promotion),
          sync_grid = case
            when coalesce(v_grid, public.member_pairs.sync_grid) is null then null
            else least(coalesce(v_grid, public.member_pairs.sync_grid), v_grid_cap)
          end,
          ex_role_unlocked = coalesce(p_ex_role_unlocked, public.member_pairs.ex_role_unlocked),
          lucky_skills = coalesce(v_lucky, public.member_pairs.lucky_skills),
          notes = case when v_notes is null then public.member_pairs.notes else nullif(v_notes, '') end,
          updated_at = now();
  end if;

  if v_user is not null and p_pair_id is not null then
    insert into public.user_collection
      (user_id, pair_id, owned, potential, super_awakening, level, promotion, ex_unlocked,
       sync_grid, ex_role_unlocked, lucky_skills, notes, updated_at)
    values
      (v_user, p_pair_id, v_pot > 0, v_pot, v_sa, coalesce(v_level, 1),
       coalesce(v_promo, 5), coalesce(v_promo, 5) >= 6,
       least(coalesce(v_grid, 0), v_grid_cap), coalesce(p_ex_role_unlocked, false),
       coalesce(v_lucky, '{}'), nullif(v_notes, ''), now())
    on conflict (user_id, pair_id) do update
      set owned = excluded.owned,
          potential = excluded.potential,
          super_awakening = excluded.super_awakening,
          level = coalesce(v_level, public.user_collection.level),
          promotion = coalesce(v_promo, public.user_collection.promotion),
          -- 6★EX 就是星數 6 (全站同一條規矩); 沒動星數就不要動它
          ex_unlocked = case
            when v_promo is null then public.user_collection.ex_unlocked
            else v_promo >= 6
          end,
          sync_grid = least(coalesce(v_grid, public.user_collection.sync_grid), v_grid_cap),
          ex_role_unlocked = coalesce(p_ex_role_unlocked, public.user_collection.ex_role_unlocked),
          lucky_skills = coalesce(v_lucky, public.user_collection.lucky_skills),
          notes = case when v_notes is null then public.user_collection.notes else nullif(v_notes, '') end,
          updated_at = now();
  end if;
end;
$$;

-- 一律寫 `from public, anon`: 只 revoke public 是無效的 (0050 檔頭寫的那個坑)。
revoke all on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean, text[], text) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int, int, int, boolean, text[], text) to authenticated;
