-- 0087: 排刀表的「試排」(2026-11-07 使用者:「先做一個我看看 不要可以套用成正式 自己才看的到 可以儲存下載圖片就好」)
--
-- 試排 = 同一場道館戰另開幾份排刀表, 各自改、各自存, 正式那張 (0083) 完全不受影響。
--
-- 設計判斷:
--   * **自己才看得到**: 讀寫一律 `user_id = auth.uid()`, 而且要是這一館的正式成員 (is_gym_editor) ——
--     顧問看得到正式排刀表但不能改, 也就不給他開試排。被移出 / 降成顧問之後試排還在, 只是讀不到;
--     改回成員就回來了 (與「降級不刪資料」同一個判斷)。
--   * **不沿用正式那三張表**: 線上前端撈正式排刀表是「這場的全部列」(eq battle_id), 試排的列混進去
--     就會出現在每個人的正式排刀表上 —— 而且是在新前端部署之前就會發生。
--   * **一份一列、整份內容存一欄 jsonb** (欄位 / 每格的人與備註 / 敘述 = 畫面用的 Plan 形狀):
--     正式那張「一人一列」是為了多人同時改不互相蓋掉; 試排只有建立的人在改, 用不到。
--     格子裡的成員 id 不設外鍵: 人被移出之後畫面顯示「（已離開）」, 跟正式那張一樣。
--   * **沒有「套用成正式」** (使用者明講不要), 所以這裡沒有任何會寫到 0083 那三張表的東西。
--   * 刪除照樣進 0082 的封存 (有 gym_id 的道館資料表都要)。

create table public.battle_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 20),
  plan jsonb not null default '{"rows": [], "note": ""}'::jsonb
    check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index battle_plan_drafts_battle_user_idx on public.battle_plan_drafts (battle_id, user_id);

create trigger battle_plan_drafts_set_updated_at
  before update on public.battle_plan_drafts
  for each row execute function public.set_updated_at();

alter table public.battle_plan_drafts enable row level security;

drop policy if exists "battle_plan_drafts_select" on public.battle_plan_drafts;
create policy "battle_plan_drafts_select" on public.battle_plan_drafts
  for select using (user_id = auth.uid() and public.is_gym_editor(gym_id));
drop policy if exists "battle_plan_drafts_insert" on public.battle_plan_drafts;
create policy "battle_plan_drafts_insert" on public.battle_plan_drafts
  for insert with check (
    user_id = auth.uid()
    and public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plan_drafts.gym_id)
  );
drop policy if exists "battle_plan_drafts_update" on public.battle_plan_drafts;
create policy "battle_plan_drafts_update" on public.battle_plan_drafts
  for update using (user_id = auth.uid() and public.is_gym_editor(gym_id))
  with check (
    user_id = auth.uid()
    and public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plan_drafts.gym_id)
  );
drop policy if exists "battle_plan_drafts_delete" on public.battle_plan_drafts;
create policy "battle_plan_drafts_delete" on public.battle_plan_drafts
  for delete using (user_id = auth.uid() and public.is_gym_editor(gym_id));

grant select, insert, update, delete on public.battle_plan_drafts to authenticated, service_role;

-- ── 刪除封存 (0082 的同一支函式) ──
-- ⚠ 不要加進 0082 的清單 (重建時 0082 先跑, 這張表還不存在); tests/deleted-rows-archive.test.ts 會一起算。
do $$
declare
  t text;
begin
  foreach t in array array['battle_plan_drafts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archive_deleted', t);
    execute format(
      'create trigger %I after delete on public.%I referencing old table as old_rows '
      'for each statement execute function public.archive_deleted_rows()',
      t || '_archive_deleted', t
    );
  end loop;
end;
$$;
