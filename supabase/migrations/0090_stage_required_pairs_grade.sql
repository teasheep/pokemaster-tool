-- 0090: 必要拍組也要設寶數 (2026-11-08 使用者:「必要拍組還是可以設定寶數 然後跟隊伍一樣顯示誰綠燈誰黃燈這樣」)
--
-- 0089 只記拍組; 這裡補「要求練度」, 與隊伍 (gym_team_pairs.min_grade) 同一條軸:
--   1-5 = 寶1-5, 6-10 = 超覺醒1-5 (0038)。0 (未持有) 當要求沒有意義, 所以從 1 開始。
-- 既有的列 (0089 套上到現在只有測試會寫) 一律當寶1 = 「有就好」, 不替任何人提高門檻。
--
-- 改寶數 = 改那一列 → 補一條 update policy, 條件跟 insert 一樣 (管理員 + 三個 id 對得上);
-- 前端整份送 upsert (onConflict stage_id,pair_id), 走的就是這條。

alter table public.stage_required_pairs
  add column if not exists min_grade smallint not null default 1 check (min_grade between 1 and 10);

-- 順序 = 編輯器裡的順序 (第幾格)。只靠 created_at 不夠: 同一次存檔加進去的幾組是同一個交易時間,
-- 重抓回來兩張卡可能對調。前端整份送 upsert 時帶 0..n-1。
alter table public.stage_required_pairs
  add column if not exists sort_order smallint not null default 0 check (sort_order between 0 and 99);

drop policy if exists "stage_required_pairs_update" on public.stage_required_pairs;
create policy "stage_required_pairs_update" on public.stage_required_pairs
  for update using (public.is_gym_admin(gym_id))
  with check (
    public.is_gym_admin(gym_id)
    and exists (
      select 1 from public.battle_stages s
      where s.id = stage_id
        and s.battle_id = stage_required_pairs.battle_id
        and s.gym_id = stage_required_pairs.gym_id
    )
  );

grant update on public.stage_required_pairs to authenticated;
