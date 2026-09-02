-- 0036 個人資源不只糖果 — 加上升星/6★EX/技能裝備的素材
--
-- 沿用 member_candies (同一張表 = 同一條讀寫路徑, UI 分組呈現即可), 只放寬 check:
--   potential_cookie  潛能餅乾 (社群叫「紫餅」) — 潛能盤
--   potential_scroll  潛能卷軸 — 潛能盤
--   champion_spirit   冠軍之魂 — 6★EX (需 50)
--   legendary_spirit  傳說之魂 — 傳說拍組的 6★EX (需 50)
--   skill_feather     技能之羽 (社群叫「羽毛」) — 技能裝備
alter table public.member_candies drop constraint if exists member_candies_candy_type_check;
alter table public.member_candies
  add constraint member_candies_candy_type_check check (
    candy_type in (
      'universal', 'strike', 'tech', 'support', 'sprint', 'field', 'superawakening',
      'potential_cookie', 'potential_scroll', 'champion_spirit', 'legendary_spirit', 'skill_feather'
    )
  );
