-- 0035 道館資料匯出金鑰 — 給外部 AI (MCP / 自動化) 唯讀取用
--
-- 用途: 讓別的 AI 讀道館現況 (成員練度/糖果/券數/道館拍組/賽事) 去算排刀或資源分配。
-- 設計:
--   * 一館一把 token, 只能讀、只給彙整後的資料 (不含 email / auth uid)
--   * 管理員可以隨時重新產生 (舊 token 立即失效)
--   * token 存在 gyms 表, 只有管理員讀得到 (RLS: 一般成員 select 不到這欄 → 用 RPC 給)
alter table public.gyms
  add column if not exists export_token text unique default replace(gen_random_uuid()::text, '-', '');

update public.gyms
set export_token = replace(gen_random_uuid()::text, '-', '')
where export_token is null;

-- 管理員取得 / 重設 token
create or replace function public.get_gym_export_token(p_gym uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if not public.is_gym_admin(p_gym) then
    raise exception '只有管理員可以取得匯出金鑰';
  end if;
  select export_token into v_token from public.gyms where id = p_gym;
  return v_token;
end;
$$;

create or replace function public.rotate_gym_export_token(p_gym uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if not public.is_gym_admin(p_gym) then
    raise exception '只有管理員可以重設匯出金鑰';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  update public.gyms set export_token = v_token where id = p_gym;
  return v_token;
end;
$$;

revoke all on function public.get_gym_export_token(uuid) from public;
revoke all on function public.rotate_gym_export_token(uuid) from public;
grant execute on function public.get_gym_export_token(uuid) to authenticated;
grant execute on function public.rotate_gym_export_token(uuid) to authenticated;
