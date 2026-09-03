-- 道館戰看板的即時更新: postgres_changes → broadcast
--
-- 為什麼換 (2026-09-03):
--   `postgres_changes` 的成本結構是 O(訂閱人數): 每一個變更事件, Realtime 伺服器要對
--   **每一個訂閱者各跑一次 RLS 檢查**, 判斷這個人能不能看到這一列。看板是全站唯一會被
--   人數放大的地方 (一場道館戰 = 每個成員一個分頁), 所以那個 O(N) 正好落在最不該落的地方。
--   broadcast 只在**訂閱那一刻**檢查一次授權 (realtime.messages 的 policy), 事件本身是直送。
--
--   而且 broadcast 的 payload 帶著變更後的整列 → client 可以直接套用, 不用回頭查資料庫。
--   舊做法是「收到事件 → 重抓整張表」, 那是第二層的 N 倍放大 (N 個看板 = N 次查詢)。
--
-- ⚠ 安全性上的差異 (查證過才做的):
--   postgres_changes 是**逐列**授權, broadcast 是**逐 topic** 授權。這兩者只有在
--   「同一個 topic 裡有些列某些人不該看到」時才有差別。這四張表的 SELECT policy
--   實測全部都是 `is_gym_member(gym_id)` —— 純道館層級, 沒有任何 row 層的差異,
--   所以 topic 層的「你是不是這場賽事所屬道館的成員」與逐列檢查**等價**。
--   ⚠ 之後若有人在這四張表加上 row 層的可見性條件 (例如「只有自己的紀錄看得到」),
--      **這個等價就不成立了**, 要回頭改這裡, 不然會從看板漏資料出去。
--
-- ⚠ trigger 失敗會讓整個 INSERT/UPDATE rollback (AGENTS.md 的老地雷: log_activity 那條)。
--   出刀回報是全站最關鍵的寫入路徑, 所以廣播整段包在 exception handler 裡 ——
--   **廣播壞掉頂多是看板不即時, 絕對不能讓人出不了刀。**

-- ── 1. trigger 函式 ────────────────────────────────────────────────────────────
-- 一支通用的; 賽事 id 在哪一欄由 trigger 參數指定 (子表是 battle_id, gym_battles 自己是 id)。
create or replace function public.broadcast_battle_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  -- tg_argv[0] = 這張表的「賽事 id」欄位名
  v_col text := coalesce(tg_argv[0], 'battle_id');
  v_battle text;
begin
  -- 走 jsonb 而不是 new.<欄位>: 同一支函式掛在四張欄位不同的表上, 直接取欄位會編不過
  v_battle := (
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  ) ->> v_col;

  if v_battle is null then
    return null;
  end if;

  begin
    perform realtime.broadcast_changes(
      'battle:' || v_battle,  -- topic (與 client 的 channel 名一致)
      tg_op,                  -- event: INSERT / UPDATE / DELETE
      tg_op,                  -- operation
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    -- 這裡**絕對不能**往外丟: 丟出去就是整筆寫入 rollback (出刀回報會直接失敗)。
    raise warning '[broadcast_battle_change] % on %.% 廣播失敗: %',
      tg_op, tg_table_schema, tg_table_name, sqlerrm;
  end;

  return null;  -- AFTER trigger, 回傳值不影響寫入
end;
$$;

comment on function public.broadcast_battle_change() is
  '道館戰看板的即時廣播 (0054)。廣播失敗只 warning 不丟例外 —— trigger 丟例外會讓整筆寫入 rollback。';

-- ── 2. 掛上四張表 ─────────────────────────────────────────────────────────────
drop trigger if exists broadcast_battle_logs on public.battle_logs;
create trigger broadcast_battle_logs
  after insert or update or delete on public.battle_logs
  for each row execute function public.broadcast_battle_change('battle_id');

drop trigger if exists broadcast_member_tickets on public.member_tickets;
create trigger broadcast_member_tickets
  after insert or update or delete on public.member_tickets
  for each row execute function public.broadcast_battle_change('battle_id');

drop trigger if exists broadcast_battle_stages on public.battle_stages;
create trigger broadcast_battle_stages
  after insert or update or delete on public.battle_stages
  for each row execute function public.broadcast_battle_change('battle_id');

-- gym_battles 自己就是賽事 (賽期改動 → 看板的狀態 badge 要跟著換)
drop trigger if exists broadcast_gym_battles on public.gym_battles;
create trigger broadcast_gym_battles
  after update on public.gym_battles
  for each row execute function public.broadcast_battle_change('id');

-- ── 3. 誰可以訂閱 battle:<id> ─────────────────────────────────────────────────
-- realtime.messages 的 RLS 本來就是開的, 但**一條 policy 都沒有** = 私有頻道誰都訂不到。
-- 只給 SELECT (收訊息): 我們的廣播一律由資料庫 trigger 發, client 沒有理由能 INSERT ——
-- 不給 INSERT policy, 就沒有人能從瀏覽器偽造一則「有人出刀了」推給全道館。
drop policy if exists "battle broadcast: gym members only" on realtime.messages;
create policy "battle broadcast: gym members only"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'battle:%'
    and exists (
      select 1
      from public.gym_battles b
      -- 比字串不比 uuid: topic 是外部傳進來的, 轉型失敗會直接噴錯而不是回 false
      where b.id::text = substring(realtime.topic() from 8)
        and public.is_gym_member(b.gym_id)
    )
  );

-- 註: 這四張表仍留在 supabase_realtime publication 裡 (postgres_changes 的來源)。
-- 沒有訂閱者就不會有 fan-out 成本, 而留著讓「要退回舊做法」只需要改 client。
-- 確定不再需要之後可以 `alter publication supabase_realtime drop table ...` 再省一層。
