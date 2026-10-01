-- 0082: 道館資料「刪了就沒了」—— 加一層刪除封存, 每一列被刪 (含 cascade) 都原封不動留一份
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-10-01 使用者:「救不回來? 你應該要有之前的紀錄才對 這個問題得修」
-- 前科: 哲爸被移出時 21 筆出刀紀錄跟著 cascade 刪掉 (0081 之前), 資料庫裡只剩道館紀錄的
--   「輪次 + 張數」, 少了關卡 —— 最後是從群組裡的舊儀表板網頁把原始資料撈回來才補齊的。
--   那一次是運氣好 (網頁還在); 下一次不會這麼剛好。
--
-- 做法: deleted_rows 存「哪張表、哪一列、整列內容 (jsonb)、誰刪的、什麼時候」。
--   每張道館資料表掛一支 AFTER DELETE 的 statement 級 trigger (transition table, 一次寫一批 ——
--   整館刪除會 cascade 幾千列, 逐列 trigger 會慢很多)。cascade 刪除也會觸發, 所以「移出成員」
--   「刪除賽事」「刪除道館」連帶刪掉的東西全部都在。
--   還原 = 從 data 欄位照原樣 insert 回去 (jsonb_populate_record), 欄位名就是原本那張表的。
--
-- **刻意不封存個人帳號資料** (profiles / user_collection / shares): 使用者刪帳號是隱私權,
--   刪了就該真的不見。道館資料是「這一館共同的紀錄」, 不是單一個人的。
-- gym_activity 不封存: 它本身就是紀錄, 而且沒有任何東西會刪它 (除了人工清理)。
--
-- 沒有任何 RLS policy → 一般使用者 (anon / authenticated) 讀寫都不行; 只有 service role 與
-- 資料庫管理端看得到。它是救資料用的保險, 不是功能。

create table if not exists public.deleted_rows (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,              -- 原本那一列的 id (方便查; 完整內容在 data)
  gym_id uuid,              -- 原本那一列的 gym_id (gyms 本身就是 id); 刻意沒有外鍵 —— 整館刪掉也要留著
  data jsonb not null,
  deleted_by uuid,          -- auth.uid(); service role / 資料庫管理端刪的是 null
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_rows_lookup_idx on public.deleted_rows (table_name, gym_id, deleted_at desc);
create index if not exists deleted_rows_row_idx on public.deleted_rows (row_id);

alter table public.deleted_rows enable row level security;
revoke all on public.deleted_rows from anon, authenticated;

create or replace function public.archive_deleted_rows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.deleted_rows (table_name, row_id, gym_id, data, deleted_by)
  select tg_table_name,
         o.j ->> 'id',
         coalesce(nullif(o.j ->> 'gym_id', ''), case when tg_table_name = 'gyms' then o.j ->> 'id' end)::uuid,
         o.j,
         auth.uid()
    from (select to_jsonb(r) as j from old_rows r) o;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'gyms', 'gym_members', 'departed_members',
    'gym_battles', 'battle_stages', 'battle_logs', 'member_tickets', 'stage_teams', 'stage_round_notes',
    'gym_teams', 'gym_team_pairs', 'gym_pairs', 'gym_guides',
    'member_pairs', 'member_candies', 'member_type_focus'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archive_deleted', t);
    execute format(
      'create trigger %I after delete on public.%I referencing old table as old_rows '
      'for each statement execute function public.archive_deleted_rows()',
      t || '_archive_deleted', t
    );
  end loop;
end;
$$;
