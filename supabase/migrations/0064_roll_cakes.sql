-- 體系蛋糕捲 (解鎖 EX 體系用) 與 5★ 潛能之光 —— member_candies 再放寬一次。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- ✅ 2026-09-10 已套用到線上 (使用者交代「先套」)。
--     UI 已於同一天接上 (candy.tsx 的 CANDY_GROUPS/CANDY_LABELS 各 6 種);
--     tests/bag-items.test.ts 釘住「UI 的種類都在這份 check 的值域裡」。
--
-- 背景: 0015 建表時只有 7 種糖; 0036 放寬到 12 種 (加潛能餅乾/卷軸/冠軍之魂/傳說之魂/技能之羽,
-- 但那 5 種到今天為止**從來沒有出現在畫面上** —— 約束加了, UI 的 CANDY_TYPES 沒跟著加)。
-- 這一份再加 6 種, 來源是 pomasters 背包分頁的道具清單 (2026-09-09 使用者指定要抄那個版面)。
--
-- 命名 (使用者提供的繁中官方譯名):「體系蛋糕捲(紅)」等, 依顏色區分, 用來解鎖 EX 體系。
-- 顏色 → 角色的對應是從官方圖取樣出來的, 與既有的角色糖配色完全一致:
--   紅 #ff2b4f = 攻擊 / 綠 #05b294 = 技術 / 藍 #0096ea = 輔助 / 橙 #ef7a12 = 速戰 / 紫 #a72bee = 場地
--
-- ⚠ 這張表的 check 是「值域的全集」不是選單 —— 加值一律用 drop + add, 不要用 alter constraint
--   (Postgres 沒有那個語法), 而且要把**全部**既有的值原樣抄回去, 少抄一個就是那種糖從此寫不進去。


alter table public.member_candies drop constraint if exists member_candies_candy_type_check;
alter table public.member_candies
  add constraint member_candies_candy_type_check check (
    candy_type in (
      -- 0015: 招式糖 (依角色) + 通用糖 + 棒棒糖
      'universal', 'strike', 'tech', 'support', 'sprint', 'field', 'superawakening',
      -- 0036: 潛能盤 / 6★EX / 技能裝備的素材 (⚠ 至今仍未出現在 UI 上)
      'potential_cookie', 'potential_scroll', 'champion_spirit', 'legendary_spirit', 'skill_feather',
      -- 0064: 體系蛋糕捲 (解鎖 EX 體系) 與 5★ 潛能之光
      'cake_strike', 'cake_tech', 'cake_support', 'cake_sprint', 'cake_field', 'power_up'
    )
  );


-- 套用之後要一起做的事 (同一個 commit, 否則畫面與資料會對不起來):
--   1. src/components/gym/candy.tsx: CandyType 加這 6 個 key、CANDY_TYPES 加進顯示順序、
--      CANDY_LABELS 補繁中名。圖已經備好在 public/reference/ui/candy/
--      (cake_strike / cake_tech / cake_support / cake_sprint / cake_field / power_up 的 .webp)。
--   2. 順手把 0036 那 5 種也一起上 —— 它們的約束早就在了, 只是沒人接 UI。
--      但要先有圖: public/reference/ui/candy/ 底下目前沒有它們的圖檔。
--   3. 名稱都已確認 (使用者 2026-09-09 提供): 體系蛋糕捲(紅/綠/藍/橙/紫) 與「5★ 成長潛力券」,
--      放在 src/components/gym/candy.tsx 的 PENDING_ITEM_LABELS。
