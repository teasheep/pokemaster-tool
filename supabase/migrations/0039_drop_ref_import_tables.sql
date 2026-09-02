-- 0039: 清掉「ref 匯入才有」的表與欄位 — ref 只是 input, 系統不留它的結構
--
-- 使用者 2026-08-17 指示: 系統不要再存 ref 才有的資訊。程式碼已全部不讀這些:
--   member_debuffs      1573 列 — 舊試算表的降抗數值 (降抗要重做, 見 docs/rebuff-notes.md)
--   member_type_scores   720 列 — 舊試算表的主打手分數 (屬性戰力面板已收掉)
--   gym_pair_tags         51 列 — 從 member_debuffs 搬來的拍組標籤 (使用者根本不知道有這功能)
--   strategy_pairs         0 列 — 死功能 (排刀從未讀過)
--   gym_pairs.source_kind      — 匯入來源分類徽章 (ref 的分類)
--   gym_pairs.tag              — 廢除的三分類 (setGymPair 一律寫 support, 無人讀)
--
-- drop 前已整份備份到 ref/archive-ref-tables-2026-08-17.json (ref/ 不進 git)。

drop table if exists public.member_debuffs;
drop table if exists public.member_type_scores;
drop table if exists public.gym_pair_tags;
drop table if exists public.strategy_pairs;

alter table public.gym_pairs drop column if exists source_kind;
alter table public.gym_pairs drop column if exists tag;
