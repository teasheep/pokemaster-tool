-- 0088: 排刀表的分頁 —— 全館都看得到 (2026-11-07 使用者:「改成所有人都可以加排刀表 就是按照現在的邏輯
-- 改成排刀表可以有分頁1 分頁2...的長相 然後標註是誰 在什麼時候加的就好 也可以自己命名」)
--
-- 0087 的「試排」原本只有建立的人看得到; 現在改成排刀表的分頁: 正式那張 (0083) 照舊, 旁邊多幾個分頁,
-- 每個分頁標著是誰、什麼時候加的。表還是 battle_plan_drafts (一份一列、整份存 jsonb), 只改誰讀得到 / 誰刪得掉:
--   * **讀: 這一館的人都讀得到** (is_gym_member —— 含顧問, 跟正式排刀表一樣; 待確認的人照舊讀不到)。
--   * **新增 / 修改: 照舊只有建立的人** (0087 那兩條不動) —— 整份存一格 jsonb, 兩個人同時改就是後存的蓋掉先存的;
--     想改別人的那份, 就在那個分頁按「＋ 分頁」複製一份成自己的。
--   * **刪除: 建立的人, 或這一館的管理員** —— 人離開之後他的分頁還在 (大家都看得到), 要有人收得掉。
--   * 仍然沒有「套用成正式」(使用者 0087 講過不要), 這裡也不碰 0083 那三張表。
-- ⚠ 改 policy 一律 drop 再 create —— permissive policy 是 OR 起來的, 名字打錯 = 舊的那條還在 (AGENTS 0072 第 7 點)。

drop policy if exists "battle_plan_drafts_select" on public.battle_plan_drafts;
create policy "battle_plan_drafts_select" on public.battle_plan_drafts
  for select using (public.is_gym_member(gym_id));

drop policy if exists "battle_plan_drafts_delete" on public.battle_plan_drafts;
create policy "battle_plan_drafts_delete" on public.battle_plan_drafts
  for delete using (
    (user_id = auth.uid() and public.is_gym_editor(gym_id))
    or public.is_gym_admin(gym_id)
  );
