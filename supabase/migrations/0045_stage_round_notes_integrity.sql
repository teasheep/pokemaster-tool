-- 0045: stage_round_notes 寫入時驗證 stage/battle 確實屬於該 gym
--
-- 0044 的 insert/update 只驗 is_gym_admin(gym_id), 沒驗 stage_id 是不是自己道館的關卡 —
-- 別館管理員可以拿自己的 gym_id 配上別人的 stage_id 佔住 unique(stage_id, round),
-- 讓正牌管理員的 upsert 永遠撞鎖。加上關聯檢查 (battle_stages 的 RLS 只讓成員看到
-- 自己道館的關卡, 對外館列 exists 必然 false)。

drop policy if exists "stage_round_notes_insert" on public.stage_round_notes;
drop policy if exists "stage_round_notes_update" on public.stage_round_notes;

create policy "stage_round_notes_insert" on public.stage_round_notes
  for insert with check (
    public.is_gym_admin(gym_id)
    and exists (
      select 1 from public.battle_stages s
      where s.id = stage_round_notes.stage_id
        and s.gym_id = stage_round_notes.gym_id
        and s.battle_id = stage_round_notes.battle_id
    )
  );

create policy "stage_round_notes_update" on public.stage_round_notes
  for update using (public.is_gym_admin(gym_id))
  with check (
    public.is_gym_admin(gym_id)
    and exists (
      select 1 from public.battle_stages s
      where s.id = stage_round_notes.stage_id
        and s.gym_id = stage_round_notes.gym_id
        and s.battle_id = stage_round_notes.battle_id
    )
  );
