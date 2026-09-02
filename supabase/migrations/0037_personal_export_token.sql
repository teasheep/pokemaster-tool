-- 0037 匯出金鑰改跟著「人」走, 不跟道館走
--
-- 舊設計 (0035) 是一館一把金鑰, 由管理員發放 — 但一個人可能是 A 館成員、B/C/D 館顧問,
-- 他的 AI 應該就讀得到那四館, 不用拿四把鑰匙; 反過來也不該因為拿到館鑰就讀得到
-- 「這個人本來看不到的東西」。所以金鑰掛在 profiles, 端點依這個人的身分決定回傳範圍。
alter table public.profiles
  add column if not exists export_token text unique default replace(gen_random_uuid()::text, '-', '');

update public.profiles
set export_token = replace(gen_random_uuid()::text, '-', '')
where export_token is null;

create or replace function public.get_my_export_token()
returns text
language sql
security definer
set search_path = public
as $$
  select export_token from public.profiles where id = auth.uid();
$$;

create or replace function public.rotate_my_export_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if auth.uid() is null then
    raise exception '請先登入';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  update public.profiles set export_token = v_token where id = auth.uid();
  return v_token;
end;
$$;

revoke all on function public.get_my_export_token() from public;
revoke all on function public.rotate_my_export_token() from public;
grant execute on function public.get_my_export_token() to authenticated;
grant execute on function public.rotate_my_export_token() to authenticated;

-- 道館層級的舊金鑰整組退役 (只有開發者手上那把, 未發放)
drop function if exists public.get_gym_export_token(uuid);
drop function if exists public.rotate_gym_export_token(uuid);
alter table public.gyms drop column if exists export_token;
