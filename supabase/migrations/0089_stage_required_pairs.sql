-- 0089: 關卡的「必要拍組」(2026-11-08 使用者:「可以在道館戰那邊設定關卡的必要拍組吧 跟隊伍庫放一起
--        因為有時候 其實會有很多隊 但共用拍組 所以可以選幾組拍組好像更好用一點
--        然後排刀的時候可以切換顯示屬性拍組跟必要拍組」)
--
-- 一關挑幾組拍組 (不是一套隊伍): 同一關常常有好幾套隊伍、但其實共用那幾隻,
-- 排刀時要看的就是「每個人那幾隻幾寶」。
--
-- 設計判斷:
--   * **跟挑戰隊伍 (stage_teams, 0011) 同一套權限**: 全館讀得到 (is_gym_member, 含顧問),
--     只有管理員改得動 —— 它是「這一關的設定」, 跟綁哪幾套隊伍放在同一區、同一個人在管。
--   * **只記拍組, 不記練度門檻**: 排刀只看「誰幾寶」(畫面上直接列每個人的寶數),
--     要門檻的話那是一套隊伍 (gym_team_pairs.min_grade), 不是這個。
--   * **一組一列**, 加 = insert、拿掉 = delete; 兩個管理員同時加同一組撞 unique 時前端用
--     upsert ignoreDuplicates (道館拍組名單 2026-09-09 那個坑: 結果才是重點, 不是動作)。
--   * pair_id 是圖鑑的字串 id, 資料庫沒有圖鑑 → 不設外鍵 (與 gym_team_pairs 一樣)。
--   * 刪除照樣進 0082 的封存 (有 gym_id 的道館資料表都要)。

create table public.stage_required_pairs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  stage_id uuid not null references public.battle_stages(id) on delete cascade,
  pair_id text not null check (char_length(pair_id) between 1 and 64),
  created_at timestamptz not null default now(),
  unique (stage_id, pair_id)
);
create index stage_required_pairs_battle_idx on public.stage_required_pairs (battle_id);

alter table public.stage_required_pairs enable row level security;

drop policy if exists "stage_required_pairs_select" on public.stage_required_pairs;
create policy "stage_required_pairs_select" on public.stage_required_pairs
  for select using (public.is_gym_member(gym_id));
drop policy if exists "stage_required_pairs_insert" on public.stage_required_pairs;
create policy "stage_required_pairs_insert" on public.stage_required_pairs
  for insert with check (
    public.is_gym_admin(gym_id)
    -- 關卡、賽事、道館三個 id 要對得上 (不然能把列掛到別館的關卡上, 那一館的人讀得到)
    and exists (
      select 1 from public.battle_stages s
      where s.id = stage_id
        and s.battle_id = stage_required_pairs.battle_id
        and s.gym_id = stage_required_pairs.gym_id
    )
  );
drop policy if exists "stage_required_pairs_delete" on public.stage_required_pairs;
create policy "stage_required_pairs_delete" on public.stage_required_pairs
  for delete using (public.is_gym_admin(gym_id));
-- 沒有 update policy = 改不了 (一列只有一組拍組, 換一組就是刪掉再加)

grant select, insert, delete on public.stage_required_pairs to authenticated, service_role;

-- ── 刪除封存 (0082 的同一支函式) ──
-- ⚠ 不要加進 0082 的清單 (重建時 0082 先跑, 這張表還不存在); tests/deleted-rows-archive.test.ts 會一起算。
do $$
declare
  t text;
begin
  foreach t in array array['stage_required_pairs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archive_deleted', t);
    execute format(
      'create trigger %I after delete on public.%I referencing old table as old_rows '
      'for each statement execute function public.archive_deleted_rows()',
      t || '_archive_deleted', t
    );
  end loop;
end;
$$;
