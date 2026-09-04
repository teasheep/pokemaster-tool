-- 撤掉 0054 的即時廣播 —— 道館戰看板不再用 Supabase Realtime。
--
-- 為什麼拆 (2026-09-04, 量出來的不是嫌它複雜):
--   線上 `battle_logs` 的 291 筆**全部**建立在 2026-08-13 06:19:53–06:20:06 那 13 秒內,
--   那是 ref 試算表的匯入, 不是有人在看板上回報。真正透過 UI 回報過的次數,
--   看 `gym_activity` 的 `battle_log` 只有 **5 次**, 而且橫跨 3 天 (8/18–8/21)。
--   同期 `pair` 78 次、`candy` 87 次 —— 工具有人在用, 但**用的是 /pairs 與 /resources**,
--   道館戰看板還沒經歷過一場真正的道館戰。
--
--   也就是說即時推播推給了零個觀眾, 換來的卻是:
--     - 一條硬性的同時連線上限 (Free 200 / Pro 500), 全站唯一的擴展硬牆;
--     - 一個掛在**出刀回報**這條最關鍵寫入路徑上的 trigger (就算包了 exception handler,
--       它仍然在那條路徑上);
--     - 全站唯一**無法在正式環境驗證**的程式碼路徑 (要有人真的出刀才看得到)。
--
-- 取代它的是 client 端兩件無聊但夠用的事 (見 battle-client.tsx):
--   回到分頁就重抓 + 賽事進行中且分頁看得見時每 45 秒抓一次「出戰紀錄與券數」。
--
-- 要加回來的話: 0054 還在版本庫裡, 原封不動重跑就行 (那份的註解也還有效)。
-- 判準寫在 ROADMAP —— 先看下一場真正的道館戰之後, `gym_activity` 的 `battle_log`
-- 是不是成群出現 (幾分鐘內好幾筆、不同人)。不是的話就不要加。

drop trigger if exists broadcast_battle_logs on public.battle_logs;
drop trigger if exists broadcast_member_tickets on public.member_tickets;
drop trigger if exists broadcast_battle_stages on public.battle_stages;
drop trigger if exists broadcast_gym_battles on public.gym_battles;

drop function if exists public.broadcast_battle_change();

-- 這條 policy 是「誰可以訂閱 battle:<id>」。沒有東西再往那個 topic 發訊息了,
-- 留著等於留一個沒人用的授權面 —— 一起收掉。
-- (`realtime.messages` 的 RLS 本來就是開的且沒有其他 policy, 收掉之後回到「誰都訂不到私有頻道」。)
drop policy if exists "battle broadcast: gym members only" on realtime.messages;

-- 註: 這四張表仍留在 `supabase_realtime` publication 裡 —— 那是 0054 之前就有的狀態
-- (postgres_changes 時代留下的), 不是這一輪加的, 所以不在這個 migration 的範圍。
-- 現在**沒有任何訂閱者**, 所以它只剩下 WAL 邏輯解碼的一點固定成本。
-- 真的要清乾淨是 `alter publication supabase_realtime drop table ...`, 可以隨時加回來,
-- 但那是另一個決定 (而且 gym_teams / gym_team_pairs / stage_teams 也在裡面, 同樣沒有消費者)。
