-- 0022: 移除「同關同輪同人唯一」限制 (0017) —
-- 實戰同一人可在同輪同關出多刀 (1+2+2+2 後三刀同人 / 降抗手 1+2+1+2 / 磨隊),
-- 手動排刀要有這個彈性; 自動排刀在程式端維持一人一刀 (不靠 DB 約束)。
drop index if exists public.stage_assignments_stage_member_round_key;
