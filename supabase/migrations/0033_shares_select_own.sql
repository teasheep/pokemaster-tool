-- 0033 分享連結建立失敗: "new row violates row-level security policy for table shares"
--
-- 0004 為了防止用 anon key 枚舉全平台 token, 把 shares 的 select policy (using(true)) 拿掉了,
-- 但沒有補「自己看自己的」— 於是:
--   1. `insert(...).select()` 的 RETURNING 需要 SELECT 權限 → 直接 42501 (就是那個錯誤訊息)
--   2. 「有沒有既有連結」的查詢永遠回 0 筆 → 每次都想新增, 也顯示不出目前的連結
-- 補一條「只有本人讀得到自己的列」即可; 公開頁解 token 仍走 get_shared_collection
-- (security definer), anon 依舊讀不到這張表。
create policy "shares_select_own" on public.shares
  for select using (auth.uid() = user_id);
