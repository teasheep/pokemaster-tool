-- 0042: LAST_ADMIN 防呆放行「整個道館刪除」的 cascade
-- 刪 gyms 列會 cascade 刪 gym_members, 此時父列已不存在 — 不該再擋最後一位管理員。

create or replace function public.protect_last_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- 道館本體已刪 (cascade 進行中) → 放行
  if not exists (select 1 from public.gyms where id = old.gym_id) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.gym_members
       where gym_id = old.gym_id and role = 'admin' and id <> old.id
     )
  then
    raise exception 'LAST_ADMIN';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
