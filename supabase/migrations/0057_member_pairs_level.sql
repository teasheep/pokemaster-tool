-- 0057: member_pairs 補 level 欄位 + 等級值收斂成 1/140/150/180/200
--
-- 使用者 2026-09-07:「多一個 LV1 的選項好了, 預設 LV1, 然後其他不是選項內的數字不留,
--  都改回 LV1。然後道館看得到, 只是要點進去才看得到, 這樣就可以了 ——
--  因為其實自己也是要點進去才看得到。」
--
-- 兩件事:
--
-- 1) **道館要看得到成員的等級**, 而 `user_collection` 的 RLS 是「只能讀自己的」
--    (0002), 所以道館端全站讀不到別人的等級。解法與 0023 (super_awakening) 完全一樣:
--    在 member_pairs 補一欄鏡像, 由 `syncMemberPair` 在成員自己改練度時一併寫入。
--    **代改路徑 (set_member_pair) 刻意不動** —— 它的簽章不收 level, 而改簽章會產生
--    一個全新的函式物件, 舊的那支還在 (0040 的前科), revoke 也要跟著重套。
--    等級是個人資料, 讓本人在 /pairs 自己設就好, 道館端唯讀。
--
-- 2) **等級只留 1 / 140 / 150 / 180 / 200**, 其餘一律改回 1。
--    Lv1 = 「還沒設定」, 它同時是 user_collection.level 的 DB 預設 (0002)、
--    set_member_pair 建列時吃到的值, 以及網站上 defaultEntry 的預設 ——
--    三邊對齊之後, 線上那 167 列 Lv1 不再是「壞掉的資料」而是「沒設定過」。
--    (執行前線上實測 2077 列: Lv1 167 / Lv100 1 / Lv130 1 / Lv140 2 / Lv200 1906,
--     所以這一步實際只動到 2 列。)
--
-- check 條件維持 1..200 不收緊: set_member_pair 的 insert 不帶 level, 收緊到列舉值
-- 會讓那條 RPC 在建新列時直接失敗, 而它失敗會讓管理員的代改整個 rollback。

-- 1) 鏡像欄位 (預設 1 = 還沒設定, 與 user_collection 同一個預設)
alter table public.member_pairs
  add column if not exists level int not null default 1
  check (level between 1 and 200);

-- 2) 回填: 已綁帳號的成員從 user_collection 取真實等級 (與 0023 同一個做法)
update public.member_pairs mp
set level = uc.level
from public.gym_members gm
join public.user_collection uc on uc.user_id = gm.user_id
where mp.member_id = gm.id
  and mp.pair_id is not null
  and uc.pair_id = mp.pair_id;

-- 3) 不在選項裡的一律改回 1 (兩張表都要, 不然兩邊會對不起來)
update public.user_collection
set level = 1
where level not in (1, 140, 150, 180, 200);

update public.member_pairs
set level = 1
where level not in (1, 140, 150, 180, 200);
