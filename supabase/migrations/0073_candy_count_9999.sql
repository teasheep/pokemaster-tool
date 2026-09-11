-- 0073: 背包的數量上限 999 → 9999
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-11 使用者指定:「上限 9999」。
-- 0015 當初訂 999 是隨手取的整數, 不是遊戲規則 —— 通用糖這種東西長期玩下來破千很正常,
-- 而撞到上限的症狀是「打了 1200 卻變成 999」, 使用者不會知道是被夾住的。
--
-- **欄位型別不用動**: count 是 smallint (上限 32767), 9999 綽綽有餘。
-- 只放寬 check, 不動任何一列資料 —— 這是純粹的放寬, 現有的值全部仍然合法。
--
-- ⚠ **部署順序: 這一支要先套, 前端後上** (與 0071 那次相反)。
--   這裡放寬的是「資料庫肯收多大的數字」。先套 migration → 前端還夾在 999,
--   什麼事都不會發生; 反過來先上前端 → 使用者打 1200, 資料庫拒收, 他會看到
--   一句 check constraint 的英文錯誤。**放寬要先放資料庫, 收緊才是先收前端。**

alter table public.member_candies drop constraint if exists member_candies_count_check;

alter table public.member_candies
  add constraint member_candies_count_check check (count between 0 and 9999);

comment on column public.member_candies.count is
  '數量 0-9999 (0073 從 999 放寬)。前端的 CountInput 與 +/- 鈕要夾在同一個範圍。';
