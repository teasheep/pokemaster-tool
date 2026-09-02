-- 0020: 賽事結算摘要 (歷史賽事的總分/排名等, 來自 LINE 統計或人工填寫)
alter table public.gym_battles
  add column if not exists summary text;
