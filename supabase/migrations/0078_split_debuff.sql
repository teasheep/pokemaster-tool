-- 0078: 降抗分成物降抗 / 特降抗 —— 隊伍庫的分類與出刀紀錄的分工
--
-- 2026-09-29 使用者:「隊伍庫的標籤, 降抗想再分成物降抗和特降抗, 出刀的部分也可以考慮」。
--
-- 只**放寬** check, 不動任何一列:
--   舊的 'debuff' 兩張表都繼續合法 —— 線上 17 支「降抗」隊伍與 81 筆「降抗」出刀紀錄
--   (第三次道館戰匯入) 看不出是物降抗還是特降抗, 不替他們猜。
--   隊伍庫把它們放在「降抗（未分）」一區, 管理員點隊伍卡上的分類改掉;
--   出刀紀錄照原樣顯示「降抗」, 新登記的選項裡沒有它。
--
-- 部署順序: **先套這支再上前端** (放寬值域; 反過來的話新前端一選物降抗就撞 check)。
-- 舊前端在這支套上去之後照常運作 (它只會寫 'debuff', 仍然合法)。

alter table public.gym_teams drop constraint if exists gym_teams_tag_check;
alter table public.gym_teams
  add constraint gym_teams_tag_check
  check (tag in ('debuff', 'debuff_physical', 'debuff_special', 'physical', 'special', 'closer'));

alter table public.battle_logs drop constraint if exists battle_logs_role_check;
alter table public.battle_logs
  add constraint battle_logs_role_check
  check (role in ('main', 'assist', 'debuff', 'debuff_physical', 'debuff_special'));
