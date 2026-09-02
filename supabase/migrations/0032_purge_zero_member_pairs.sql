-- 0032 清掉 member_pairs 的 grade=0 幽靈列 (歷史匯入/舊版「歸零但留列」留下的)
--
-- 寶0 = 不持有, 不該有列 (0031 起 set_member_pair 與 collection-sync 都會刪列)。
-- 留著會被「持有 N 組」「全館持有率」這類「數列數」的查詢算進去。
-- 刪除會觸發 member_pairs_activity 寫入幾百筆「→ 未持有」的假紀錄, 所以先停用 trigger。
alter table public.member_pairs disable trigger member_pairs_activity;

delete from public.member_pairs where grade = 0;

alter table public.member_pairs enable trigger member_pairs_activity;
