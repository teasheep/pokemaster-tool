-- 0034 一人一條分享連結
-- UI 的心智模型就是「你的分享連結」(重新產生 = 先刪再建), 但 shares 沒有唯一鍵,
-- 之前 select policy 缺失期間每次點都插一筆 → 同一個人有多組仍然有效的 token。
-- 先留最新的一筆, 其餘刪除, 再加唯一索引把這件事鎖住。
delete from public.shares s
where exists (
  select 1 from public.shares s2
  where s2.user_id = s.user_id and s2.created_at > s.created_at
);

create unique index if not exists shares_user_unique on public.shares (user_id);
