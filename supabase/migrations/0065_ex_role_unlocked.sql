-- EX 體系解鎖 —— 第五條個人練度軸。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- ✅ 2026-09-10 已套用到線上 (使用者交代「先套」)。
--     套用前照 AGENTS.md: 先在交易裡乾跑 (BEGIN → 套 → 用自己的成員列試各種呼叫 → ROLLBACK)。
--
-- 這是什麼 (使用者 2026-09-09:「EX體系解鎖就做吧, 目前我們系統還完全沒有」):
--   拍組練到一定程度可以解鎖「EX 體系」, 解鎖後多一組 EX 角色定位, 6★EX 時拍組招式再加效果。
--   解鎖的素材是「體系蛋糕捲」(見 0064)。
--
-- ⚠ **不要跟既有的 `ex_unlocked` 搞混, 那是完全不同的東西**:
--     `ex_unlocked`      = 6★EX (星數 6)。AGENTS 明訂「6★EX 就是星數 6」, 它由 promotion 推導,
--                          側板的星數下拉就是寫 `exUnlocked: n >= 6`。
--     `ex_role_unlocked` = 這一份。EX 體系有沒有解鎖, 與星數無關。
--   兩個名字太像, 所以這裡刻意用完整的 `ex_role_` 前綴, 不要縮寫成 `ex_r` 之類。
--
-- catalog 端已經有的東西 (不必重複存): `hasExRole` 這個拍組**能不能**有 EX 體系,
-- `exRole` / `exRoleName` 是解鎖後的定位。這裡存的是「這個人解鎖了沒有」。


-- ── 1. 個人收藏 ────────────────────────────────────────────────────────
alter table public.user_collection
  add column if not exists ex_role_unlocked boolean not null default false;

comment on column public.user_collection.ex_role_unlocked is
  'EX 體系有沒有解鎖 (與 ex_unlocked = 6★EX 是兩件事)。拍組能不能解鎖看 catalog 的 hasExRole。';

-- ── 2. 道館端鏡像 ──────────────────────────────────────────────────────
-- nullable = 「沒設定過」, 與 0059 的 promotion 同一個取捨: 給 not null default false 的話,
-- 畫面分不出「他確實沒解鎖」與「他沒填過」。
alter table public.member_pairs
  add column if not exists ex_role_unlocked boolean;

comment on column public.member_pairs.ex_role_unlocked is
  'user_collection.ex_role_unlocked 的鏡像 (null = 沒設定過)。道館端要看得到成員的 EX 體系狀態, 而 user_collection 是 own-rows only。';

-- ── 3. 從既有的個人收藏回填鏡像 (照 0057 / 0059 的做法) ──────────────────
update public.member_pairs mp
   set ex_role_unlocked = uc.ex_role_unlocked
  from public.gym_members gm
       join public.profiles p on p.id = gm.user_id
       join public.user_collection uc on uc.user_id = p.id
 where mp.member_id = gm.id
   and uc.pair_id = mp.pair_id
   and mp.ex_role_unlocked is null
   and uc.ex_role_unlocked = true;


-- ── 4. set_member_pair 換簽章 (與 0063 的 sync_grid 一起做, 不要換兩次) ────
--
-- ⚠ **還沒寫**, 而且這是最危險的一段。0063 也要加一個參數, 兩份**合併成同一次換簽章** ——
--   換兩次就是兩次重收權限、兩次踩 0040 那個坑的機會。
--   步驟固定三步, 少一步就會出事:
--     1. `drop function public.set_member_pair(<舊簽章逐一列出>);`
--        —— 多一個參數 = 全新的函式物件, 舊的**會留著**, PostgREST 挑得到舊的 = 新參數靜靜不生效。
--     2. create or replace 新版, `p_sync_grid` 與 `p_ex_role_unlocked` 同樣「null = 不要動」
--        (與 p_level / p_promotion 同一個約定 —— 卡片上的手勢不知道也不該知道其他軸的值)。
--     3. `revoke execute on function ... from public, anon, authenticated;`
--        —— **三個角色都要寫**, 只 revoke public 是無效的 (0050 已驗證);
--        而且 create 完會重新套用 Supabase 的 default privileges, 所以順序不能顛倒。
--
-- 套用之後 UI 要一起接的地方:
--   - src/lib/collection.ts 的 select 與 CollectionEntry 加這一欄
--   - src/lib/collection-entry.ts 的 defaultEntry
--   - src/lib/collection-sync.ts 的 syncMemberPair (雙表同步, AGENTS「新增欄位時三處都要接」)
--   - src/components/pair-edit-panel.tsx 加一個開關 (只有 pair.hasExRole 的拍組才顯示)
--   - 兩個 client 的 upsert
