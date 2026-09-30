-- 0079: 人員異動記進道館紀錄 —— 誰放行了誰、誰把誰升成管理員 / 改成顧問 / 移出道館
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-09-30 使用者:「人員, 例如哪個管理員放行、把人升級成管理、移成顧問, 這些資訊需要放在道館紀錄內」。
-- 以前 gym_members 的變動完全沒有紀錄 —— 名冊只看得到「現在」, 查不到是誰、什麼時候做的。
--
-- **記在 trigger 不記在前端**: 放行 / 拒絕 / 改角色 / 移出 走的是不同畫面甚至不同 RPC
-- (join_gym、create_gym、名冊的勾勾叉叉、編輯成員、自己離開), 只有 trigger 保證每一條路都記得到。
--
-- 一列的格式 (kind = 'member'):
--   member_id  = 那位成員的 gym_members.id —— 被移出 / 拒絕之後那一列就不在了, 所以
--   target     = 當下的顯示名快照 (「社群名(遊戲名)」, 與 memberLabel() 同一個順序)
--   target_id  = 同 member_id (文字), 畫面用它回查頭像
--   old_value / new_value = 'status:role' (例: 'pending:advisor' → 'active:advisor');
--                           不存在 = null。**刪除時 new_value 若是 'self'** = 他自己刪的
--                           (取消申請 / 離開道館), null = 被別人刪的 (拒絕 / 移出) ——
--                           那一列已經不在, 事後沒辦法再回查「操作者是不是他本人」。
--   actor_id   = auth.uid() (誰按的; service role 腳本為 null)
--
-- 只在 **status 或 role 變了** 才記: 改名字、改圓圈文字、改出沒時段不是人員異動,
-- 記了只會把真正的異動洗掉 (與 0056 屬性偏好不記同一個判斷)。
--
-- 可見性: member_id 不是 null → 0026 的 policy = 管理員看全館 + **本人看得到自己的** ——
-- 「誰把我升成管理員」讓本人看到沒有問題; 待確認的人本來就讀不到任何東西 (0071)。
--
-- 整館刪除時 cascade 會一列一列刪 gym_members → 那時道館本體已經不在, 不要記
-- (與 0042 的 protect_last_admin 同一個判斷), 否則留一堆沒有道館的孤兒紀錄。

create or replace function public.log_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.gym_members;
  v_old text;
  v_new text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- 整館刪除的 cascade: 道館本體已經不在
  if not exists (select 1 from public.gyms where id = v_row.gym_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status and old.role is not distinct from new.role then
      return new;
    end if;
    v_old := old.status || ':' || old.role;
    v_new := new.status || ':' || new.role;
  elsif tg_op = 'INSERT' then
    v_old := null;
    v_new := new.status || ':' || new.role;
  else
    v_old := old.status || ':' || old.role;
    v_new := case when old.user_id is not null and old.user_id = auth.uid() then 'self' end;
  end if;

  insert into public.gym_activity (gym_id, member_id, actor_id, kind, target, target_id, old_value, new_value)
  values (
    v_row.gym_id,
    v_row.id,
    auth.uid(),
    'member',
    case
      when nullif(btrim(v_row.line_name), '') is not null then v_row.line_name || '(' || v_row.display_name || ')'
      else v_row.display_name
    end,
    v_row.id::text,
    v_old,
    v_new
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists gym_members_activity on public.gym_members;
create trigger gym_members_activity
  after insert or update or delete on public.gym_members
  for each row execute function public.log_member_change();

-- returns trigger 的函式 PostgREST 不會當 RPC 曝出來, 但照 0050 的一般原則還是收一次
revoke all on function public.log_member_change() from public, anon, authenticated;
