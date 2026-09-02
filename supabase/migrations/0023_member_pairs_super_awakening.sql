-- 0023: member_pairs 超覺醒等級 (0-5)
-- grade 0-6 把超覺醒壓成一級 (表單時代圖方便: 超覺醒一律當覺5) —
-- 系統要能停在覺1-4, 補獨立欄位。grade=6 仍代表「已超覺醒」(媒合門檻不變),
-- super_awakening 記實際等級; 0 且 grade>=6 = 舊資料未知級數 (顯示時當覺5)。

alter table public.member_pairs
  add column if not exists super_awakening int not null default 0
  check (super_awakening between 0 and 5);

-- 回填: 已綁帳號的成員從 user_collection 取真實超覺醒等級
update public.member_pairs mp
set super_awakening = uc.super_awakening
from public.gym_members gm
join public.user_collection uc on uc.user_id = gm.user_id
where mp.member_id = gm.id
  and mp.pair_id = uc.pair_id
  and mp.grade >= 6
  and uc.super_awakening > 0;
