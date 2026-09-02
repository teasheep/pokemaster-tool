-- 0051: 把「本來就打算 revoke 卻沒 revoke 成功」的 RPC 補齊 (anon 不該叫得動寫入 RPC)
--
-- 為什麼要有這支 (兩個各自獨立的前科, 現況都用線上 DB 的 pg_proc.proacl 查證過):
--
--   (a) revoke 寫法無效 —— `revoke ... from public` 只拿掉 ACL 裡的 `=X`, Supabase 的
--       default privileges 另外給了 anon / authenticated 明確的 EXECUTE。所以 0030 的
--       `revoke all on function public.set_member_pair(...) from public` 跑完之後,
--       ACL 仍然是 {postgres=X, anon=X, authenticated=X, service_role=X} —— anon 照樣叫得動。
--       0037 的兩支 export token 函式同理。
--
--   (b) 函式簽章換掉時 revoke 沒跟著搬 —— 0005/0025/0029 都寫了
--       `revoke execute on function public.join_gym(text, text) from public, anon`,
--       但 0040 把它 drop 掉改成 `join_gym(text)` (只填邀請碼), 新簽章 = 全新物件 =
--       重新套用 default privileges, 只補了 grant 沒補 revoke。create_gym(text) (0041) 與
--       adjust_member_ticket(...) (0043) 是新建的函式, 從來沒 revoke 過, 情況一樣。
--
-- 目前不是可直接利用的漏洞 (這些函式體內第一件事就是檢查 auth.uid(), anon 會拿到
-- AUTH_REQUIRED / 沒有權限; adjust_member_ticket 不是 security definer, RLS 仍然管得到),
-- 但「未登入者叫得動寫入 RPC」本身就不該存在 —— 只要哪天有人在函式頭上少寫一行檢查,
-- 這就直接變成洞。這裡把 0030/0037/0005 原本的意圖真正落實。
--
-- 套用後會不會影響現有功能: 不會。
--   這六支全部只在登入後的畫面呼叫 (JWT 帶著 → PostgREST 用 authenticated 角色):
--     join_gym       → /welcome、加入道館 (登入後才看得到)
--     create_gym     → 建立道館
--     set_member_pair→ 管理員代改成員練度 (成員與拍組頁)
--     adjust_member_ticket → 看板加減挑戰券
--     get_/rotate_my_export_token → 頭像選單「資料連線」
--   authenticated 與 service_role 的 EXECUTE 都保留, 只有 PUBLIC 與 anon 被收回。
--
-- 明確**不動**的函式 (動了會壞):
--   is_gym_member / is_gym_admin / is_gym_editor / is_gym_advisor / is_self_member /
--   member_in_gym / my_gym_role —— 這些出現在 RLS policy 的條件式裡, policy 是以
--     **呼叫端角色**評估的, anon / authenticated 都必須有 EXECUTE, 收掉會讓整站讀不到資料。
--   get_share_meta / get_shared_collection —— 分享連結給未登入者看的, anon 本來就該叫得動。
--   rls_auto_enable —— event trigger 函式, 不是 RPC。

do $$
declare
  v_fn text;
  v_signatures text[] := array[
    'public.join_gym(text)',
    'public.create_gym(text)',
    'public.set_member_pair(uuid, text, text, int, int)',
    'public.adjust_member_ticket(uuid, uuid, uuid, int, int)',
    'public.get_my_export_token()',
    'public.rotate_my_export_token()'
  ];
begin
  foreach v_fn in array v_signatures loop
    -- 函式不存在就跳過 (重跑冪等; 也讓這支 migration 在未來簽章又變時不會整包爆掉)
    if to_regprocedure(v_fn) is null then
      raise notice '0051: 找不到 %, 跳過', v_fn;
      continue;
    end if;
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
