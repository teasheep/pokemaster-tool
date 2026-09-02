-- 0013: 放寬單筆出戰的用券上限 0-3 → 0-9
-- 實戰紀錄顯示同一人同一輪同一關可能連打多次 (第三次道館戰有單筆 6 券),
-- 統計是事後彙整的, 不該被 UI 的 1/2/3 快捷鈕限制。在 0012 之後執行。

alter table public.battle_logs
  drop constraint if exists battle_logs_tickets_used_check;
alter table public.battle_logs
  add constraint battle_logs_tickets_used_check check (tickets_used between 0 and 9);
