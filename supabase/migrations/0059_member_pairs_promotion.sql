-- 0059: member_pairs 補 promotion 鏡像 + set_member_pair 收 p_promotion
--
-- 使用者 2026-09-07:「之前的規則指的是長相, 但跟數值可以先分開。我們可以記錄每個人幾星,
--  但只顯示在內頁, 不影響拍組的圖鑑畫面。」
--
-- 也就是說 AGENTS 那條「圖鑑星級一律 basePotential / 個人升星只在我的拍組呈現」
-- **管的是卡面的長相, 不是能不能記錄這個值**。拆開之後:
--   - **卡牆 (圖鑑畫面)**: 道館頁照舊一律用原始星級, 這一版一個字都沒動;
--   - **側板 (內頁)**: 顯示並且可以改這位成員真正的星數。
-- 資料照 0023 (super_awakening) / 0057 (level) 的老路: 補一欄鏡像 + 從 user_collection 回填。
--
-- **promotion 是 nullable**, 與 level 那欄刻意不同:
-- null = 「沒設定過」→ 畫面退回這隻拍組的原始星級。給 not null default 5 的話,
-- 一隻 3★ 拍組會被標成 5★ (那正是 user_collection 那欄留下的老問題, 見下面第 3 段)。
--
-- ⚠ 簽章又換了 → 一樣要 drop 舊的再建, 建完重收權限 (0040 的前科, 與 0058 同一條)。

-- 1) 鏡像欄位 (null = 沒設定過)
alter table public.member_pairs
  add column if not exists promotion int
  check (promotion is null or promotion between 1 and 6);

-- 2) 回填: 已綁帳號的成員從 user_collection 取真實星數
update public.member_pairs mp
set promotion = uc.promotion
from public.gym_members gm
join public.user_collection uc on uc.user_id = gm.user_id
where mp.member_id = gm.id
  and mp.pair_id is not null
  and uc.pair_id = mp.pair_id;

-- 3) set_member_pair 收 p_promotion (null = 不要動, 與 p_level 同一個約定)
--
--    順便修掉 AGENTS 記著的那個老問題: 這支函式替「還沒有收藏列」的成員新增
--    user_collection 時, promotion 吃的是 DB 預設 5 —— 於是 3★ 拍組會被標成 5★。
--    現在呼叫端一律把「這位成員目前的星數, 沒有就用這隻拍組的原始星級」傳進來,
--    所以新列拿到的是對的值; coalesce 的 5 只留給沒傳的舊呼叫。
drop function if exists public.set_member_pair(uuid, text, text, int, int, int);

create or replace function public.set_member_pair(
  p_member uuid,
  p_pair_id text,
  p_pair_label text,
  p_potential int,
  p_super_awakening int,
  p_level int default null,
  p_promotion int default null
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
    insert into public.member_pairs
      (gym_id, member_id, pair_label, pair_id, grade, super_awakening, level, promotion, updated_at)
    values
      (v_gym, p_member, p_pair_label, p_pair_id, v_grade, v_sa, coalesce(v_level, 1), v_promo, now())
    on conflict (member_id, pair_label) do update
      set grade = excluded.grade,
          super_awakening = excluded.super_awakening,
          pair_id = coalesce(excluded.pair_id, public.member_pairs.pair_id),
          -- 沒傳就保留原值 (左下角的寶數循環走的就是這條)
          level = coalesce(v_level, public.member_pairs.level),
          promotion = coalesce(v_promo, public.member_pairs.promotion),
          updated_at = now();
  end if;

  if v_user is not null and p_pair_id is not null then
    insert into public.user_collection
      (user_id, pair_id, owned, potential, super_awakening, level, promotion, ex_unlocked, updated_at)
    values
      (v_user, p_pair_id, v_pot > 0, v_pot, v_sa, coalesce(v_level, 1),
       coalesce(v_promo, 5), coalesce(v_promo, 5) >= 6, now())
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
          updated_at = now();
  end if;
end;
$$;

-- 新簽章 = 新物件 = 重新套用了 default privileges → 照 0051 再收一次
revoke all on function public.set_member_pair(uuid, text, text, int, int, int, int) from public, anon;
grant execute on function public.set_member_pair(uuid, text, text, int, int, int, int) to authenticated;
