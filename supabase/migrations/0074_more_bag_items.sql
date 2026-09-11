-- 0074: 背包再加五種道具
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-11 使用者指定:「極致之證 超越之證 不變別針 體系蛋糕捲獎牌兌換券 每日券」。
--
-- 名稱與圖示取自神奇寶貝百科 (wiki.52poke.com) 的「道具列表（Masters）」,
-- 繁中/日文/英文三邊都對得上 (官方 zh-TW 的用字):
--   極致之證             極致の証                 Certificate of Excellence  突破界限
--   超越之證             超越の証                 Plaque of Perfection       突破界限
--   不變別針             かわらずのピン           Ever Pin                   鎖住技能裝備的標籤/追加效果
--   體系蛋糕捲獎牌兌換券 ロールケーキのメダル引換券 Roll Cake Coin Voucher   換體系蛋糕捲獎牌
--   每日券               デイリーチケット         Daily Ticket               商店「每月」交換
--
-- ⚠ 這張表的 check 是「值域的全集」不是選單 —— 加值一律 drop + add 重寫整份
--   (0064 檔頭那條)。下面這一份就是目前的全集, 新的五個在最後一段。
--
-- ⚠ **加新道具是三件事同一個 commit** (AGENTS):
--   1. 這支 migration 放寬 check;
--   2. candy.tsx 的 CandyType / CANDY_GROUPS / CANDY_LABELS;
--   3. 圖放進 public/reference/ui/candy/ (png + webp)。
--   少了 1 就是「按 ＋ 只會 toast 更新失敗」, 少了 3 就是破圖 (本機看不出來, 圖還在)。
--   tests/bag-items.test.ts 三件都釘住。
--
-- 0036 那 5 種 (potential_cookie / potential_scroll / champion_spirit / legendary_spirit /
-- skill_feather) 照舊留在值域裡但**仍然沒有圖**, 所以還是不上畫面 —— 這次沒有一起處理。

alter table public.member_candies drop constraint if exists member_candies_candy_type_check;
alter table public.member_candies
  add constraint member_candies_candy_type_check check (
    candy_type in (
      -- 0015: 招式糖 (依角色) + 通用糖 + 棒棒糖
      'universal', 'strike', 'tech', 'support', 'sprint', 'field', 'superawakening',
      -- 0036: 潛能盤 / 6★EX / 技能裝備的素材 (⚠ 至今仍未出現在 UI 上 —— 沒有圖)
      'potential_cookie', 'potential_scroll', 'champion_spirit', 'legendary_spirit', 'skill_feather',
      -- 0064: 體系蛋糕捲 (解鎖 EX 體系) 與 5★ 成長潛力券
      'cake_strike', 'cake_tech', 'cake_support', 'cake_sprint', 'cake_field', 'power_up',
      -- 0074: 突破界限的兩種證明, 與三種兌換/保護類道具
      'proof_excellence', 'proof_perfection', 'ever_pin', 'cake_voucher', 'daily_ticket'
    )
  );
