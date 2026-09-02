-- 0016: 修正糖果制度 — 對齊遊戲真實規則
--
-- 遊戲的招式糖 (Move Candy, 升寶數) 是按「拍組角色」分, 不是按屬性:
--   攻擊 strike / 技巧 tech / 輔助 support / 衝刺 sprint / 場地 field  五種
--   + 通用 universal (5★ Move Candy, 群內俗稱黃糖)
-- 另有 superawakening 棒棒糖 (超覺醒糖果) — 升超覺醒; 通用糖可兌換棒棒糖。
-- 0015 的 18 屬性分類是錯的, 全部重來。在 0015 之後執行。

delete from public.member_candies
where candy_type not in (
  'universal', 'strike', 'tech', 'support', 'sprint', 'field', 'superawakening'
);

alter table public.member_candies drop constraint if exists member_candies_candy_type_check;
alter table public.member_candies
  add constraint member_candies_candy_type_check check (
    candy_type in ('universal', 'strike', 'tech', 'support', 'sprint', 'field', 'superawakening')
  );
