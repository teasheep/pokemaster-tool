-- 0048: battle_logs.score 移除 (2026-08-18 使用者: 分數不需要了, 也不用記錄)
-- 線上 290 筆 score 全為 null (稽核確認), drop 不損失資料。
-- 對戰紀錄從此只記 誰/哪關/哪輪/角色/幾券。

alter table public.battle_logs drop column if exists score;
