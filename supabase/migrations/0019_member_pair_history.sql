-- 0019: 成員拍組更新紀錄
-- member_pairs 的所有變動 (點亮/調寶數/移除) 由 DB trigger 自動寫入 history —
-- 不管走哪條寫入路徑 (我的拍組同步/成員頁編輯/匯入腳本) 都會被記到, app 端零負擔。

create table if not exists public.member_pair_history (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null,
  member_id uuid not null,
  pair_id text,
  pair_label text not null,
  old_grade int,
  new_grade int,
  changed_at timestamptz not null default now()
);

create index if not exists member_pair_history_member_time
  on public.member_pair_history (member_id, changed_at desc);
create index if not exists member_pair_history_gym_time
  on public.member_pair_history (gym_id, changed_at desc);

alter table public.member_pair_history enable row level security;

-- 同館成員可查; 寫入只走 security definer trigger (不開放直接 insert)
drop policy if exists member_pair_history_select on public.member_pair_history;
create policy member_pair_history_select on public.member_pair_history
  for select using (public.is_gym_member(gym_id));

grant select on public.member_pair_history to authenticated;

create or replace function public.log_member_pair_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.grade, 0) > 0 then
      insert into public.member_pair_history (gym_id, member_id, pair_id, pair_label, old_grade, new_grade)
      values (new.gym_id, new.member_id, new.pair_id, new.pair_label, null, new.grade);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    -- 只記「寶數/超覺醒等級」真的變了的更新 (ex_style_worn 等外觀變動不進紀錄)
    if new.grade is distinct from old.grade then
      insert into public.member_pair_history (gym_id, member_id, pair_id, pair_label, old_grade, new_grade)
      values (new.gym_id, new.member_id, new.pair_id, new.pair_label, old.grade, new.grade);
    end if;
    return new;
  else
    insert into public.member_pair_history (gym_id, member_id, pair_id, pair_label, old_grade, new_grade)
    values (old.gym_id, old.member_id, old.pair_id, old.pair_label, old.grade, null);
    return old;
  end if;
end;
$$;

drop trigger if exists member_pairs_history on public.member_pairs;
create trigger member_pairs_history
  after insert or update or delete on public.member_pairs
  for each row execute function public.log_member_pair_change();
