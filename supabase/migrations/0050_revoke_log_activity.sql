-- 0050: 收回 log_activity 的公開 EXECUTE 權限 (提權洞)
--
-- 為什麼要有這支:
--   public.log_activity(...) 是 0026 建的 `security definer` 函式, 而 Postgres 對函式的
--   EXECUTE **預設就 grant 給 PUBLIC**; Supabase 又在 public schema 掛了 default privileges,
--   把 EXECUTE 額外明授給 anon / authenticated。實際查到的 ACL 是:
--     {=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}
--   `=X` 就是 PUBLIC。加上 0005 對 anon 開了 schema usage, 於是任何拿得到 anon key 的人
--   (anon key 本來就印在瀏覽器裡) 都能透過 PostgREST 直接 `rpc/log_activity`, 對**任意 gym_id**
--   插一列 gym_activity —— 一個完全繞過 RLS 的寫入原語 (gym_activity 只有 select policy,
--   直接 insert 會被 RLS 擋, 但這支 security definer 函式是以 postgres 身分寫的, 擋不到)。
--
-- 為什麼要寫三個角色:
--   既有 migration 的 `revoke ... from public` 在 Supabase 上是**無效的**——
--   revoke PUBLIC 只拿掉 `=X` 那一條, anon / authenticated 各自還有 default privileges 給的
--   明確授權。實例: 0030 對 set_member_pair 寫了 `revoke all ... from public`, 今天查 ACL
--   仍然是 `anon=X`。所以一律要寫 `from public, anon, authenticated`。
--
-- 套用後會不會影響現有功能: 不會。
--   log_activity 唯一的呼叫者是同一個 schema 裡的 trigger 函式 —— log_member_pair_change /
--   log_candy_change / log_ticket_change / log_battle_log_change (0026、0047、0049)。
--   它們全部是 `security definer` 且擁有者是 postgres, 函式體內的權限檢查用的是 postgres 的
--   權限 (postgres=X 保留), 不受這裡的 revoke 影響。
--   前端 (src/**) 沒有任何一處呼叫 log_activity —— 全站只有 supabase/migrations/*.sql 提到它。
--   service_role 的授權也保留 (匯入腳本若日後要用得到)。
--
-- 一般原則: 每一支 security definer 函式都要問「PostgREST 會不會把它當 RPC 曝出來」。
--   - returns trigger 的不會 (PostgREST 不列 trigger 函式)
--   - 其餘的一律 `revoke ... from public, anon, authenticated`, 再只 grant 給真的該呼叫它的 role

do $$
begin
  if to_regprocedure('public.log_activity(uuid, uuid, text, text, text, text)') is not null then
    revoke all on function public.log_activity(uuid, uuid, text, text, text, text)
      from public, anon, authenticated;
  end if;
end;
$$;
