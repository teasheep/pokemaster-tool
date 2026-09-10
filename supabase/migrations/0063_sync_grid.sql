-- 能量盤 (同步能力盤的能量上限) —— 第四條個人練度軸。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- ✅ 2026-09-10 已套用到線上 (使用者交代「先套」)。
--     套用前照 AGENTS.md 的規矩: 先在交易裡乾跑 (BEGIN → 套 → 用自己的成員列試各種呼叫 → ROLLBACK),
--     確認筆數與行為都對再 commit。
--
-- 遊戲規則 (使用者確認):
--   六段 60 / 62 / 64 / 66 / 68 / 70, 存的是**索引 0-5** 不是數值本身
--   (數值對照表在 src/lib/collection-entry.ts 的 SYNC_GRID_CAPS —— 只有一份)。
--   **能升到第幾段受寶數限制**: 上限 = min(4, 寶數) + 1。寶數退回去時能量盤要跟著降。
--
-- 為什麼存索引不存數值:
--   數值是遊戲的呈現, 之後改版多一段 (72?) 就要動 check 約束與既有資料;
--   索引只要在程式端的對照表加一格。與 grade 那條軸 (0-10 而不是「寶5/超覺3」) 同一個道理。
--
-- 為什麼兩張表都要加 (與 0057 level / 0059 promotion 同一條路):
--   user_collection 是 own-rows only, 道館端讀不到 → member_pairs 要有鏡像,
--   否則道館的成員頁看不到別人的能量盤。兩條寫入路徑都要維持:
--   本人自己改走 syncMemberPair, 管理員代改走 set_member_pair。


-- ── 1. 個人收藏 ────────────────────────────────────────────────────────
alter table public.user_collection
  add column if not exists sync_grid smallint not null default 0;

comment on column public.user_collection.sync_grid is
  '能量盤段數索引 0-5 → 60/62/64/66/68/70 (對照表在 src/lib/collection-entry.ts)。上限受寶數限制: min(4, potential) + 1。';

-- 0-5 之外的值一律不合法。**刻意不在 DB 端檢查「上限受寶數限制」** ——
-- 那條規則要同時看 potential, 寫成 check 之後改寶數的順序會影響能不能寫進去
-- (先降寶數再降能量盤就會卡住), 那種約束在應用程式端夾比較好處理。
alter table public.user_collection
  drop constraint if exists user_collection_sync_grid_range;
alter table public.user_collection
  add constraint user_collection_sync_grid_range check (sync_grid between 0 and 5);

-- ── 2. 道館端鏡像 ──────────────────────────────────────────────────────
-- nullable = 「沒設定過」, 與 0059 的 promotion 同一個取捨:
-- 給 not null default 0 的話, 畫面分不出「他真的是 60」與「他沒填過」。
alter table public.member_pairs
  add column if not exists sync_grid smallint;

comment on column public.member_pairs.sync_grid is
  'user_collection.sync_grid 的鏡像 (null = 沒設定過)。道館端要看得到成員的能量盤, 而 user_collection 是 own-rows only。';

alter table public.member_pairs
  drop constraint if exists member_pairs_sync_grid_range;
alter table public.member_pairs
  add constraint member_pairs_sync_grid_range check (sync_grid is null or sync_grid between 0 and 5);

-- ── 3. 從既有的個人收藏回填鏡像 (照 0057 / 0059 的做法) ──────────────────
update public.member_pairs mp
   set sync_grid = uc.sync_grid
  from public.gym_members gm
       join public.profiles p on p.id = gm.user_id
       join public.user_collection uc on uc.user_id = p.id
 where mp.member_id = gm.id
   and uc.pair_id = mp.pair_id
   and mp.sync_grid is null
   and uc.sync_grid > 0;


-- ── 4. set_member_pair 要多收一個參數 ────────────────────────────────────
--
-- ⚠ **還沒寫**, 而且它是這份 migration 最危險的一段, 刻意分開:
--   多一個參數 = **全新的函式物件**, 舊簽章那支會留著 (PostgREST 挑得到舊的 = 新參數靜靜不生效),
--   而且新那支會重新套用 Supabase 的 default privileges → anon 又拿得到 EXECUTE。
--   所以一定要:
--     1. 先 `drop function public.set_member_pair(<舊簽章逐一列出>);`
--     2. 再 create or replace 新的八參數版, `p_sync_grid` 同樣「null = 不要動」
--        (與 p_level / p_promotion 同一個約定 —— 卡片上的手勢不知道也不該知道其他軸的值)
--     3. 建完 `revoke execute on function ... from public, anon, authenticated;`
--        —— 三個角色都要寫, 只 revoke public 是無效的 (0050 已驗證)
--   前科在 0040。等使用者決定要套用時, 連同上面三步一起寫成 0064。
