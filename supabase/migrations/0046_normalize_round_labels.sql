-- 0046: battle_logs.round_label 正規化為統一用詞 (R1-R3 / Ex1…)
--
-- 匯入的舊紀錄存的是「基本對戰 N」「額外 N」, 與全站統一的 roundLabel (R/Ex) 不一致。
-- round_label 本來就是 round 的派生欄 — 依 round 重算一次, 之後顯示層也一律派生。

update public.battle_logs
set round_label = case when round <= 3 then 'R' || round else 'Ex' || (round - 3) end
where round is not null
  and round_label is distinct from
    (case when round <= 3 then 'R' || round else 'Ex' || (round - 3) end);
