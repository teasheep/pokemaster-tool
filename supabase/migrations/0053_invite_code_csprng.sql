-- 0053: 邀請碼 / 顧問碼改用密碼學安全亂數產生
--
-- 為什麼要有這支:
--   0005 的 gym_invites.code 與 0029 的 advisor_code 預設值都是
--     upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12))
--   (已用線上 DB 的 information_schema.columns 查證, 兩欄現在確實還是這個 default)。
--   `random()` 是 PRNG 不是 CSPRNG —— 它的內部狀態只有 48 bits, 同一個連線裡看得到
--   一個輸出就能往前往後推算其他輸出; clock_timestamp() 也只是微秒級時間, 對知道
--   道館建立時間的人來說猜測空間非常小。邀請碼是**唯一的入館憑證** (0040 起 join_gym
--   只吃碼, 不再比對名字), 猜中就等於拿到全館資料的讀取權。
--
-- 改成什麼:
--   gen_random_uuid() —— PostgreSQL 13+ 內建 (pg_catalog), 底層走 pg_strong_random(),
--   也就是作業系統的 CSPRNG。取十六進位前 12 碼 = 48 bits 的真亂數。
--   刻意**不用** pgcrypto 的 gen_random_bytes(): 這個專案的 pgcrypto 裝在 `extensions`
--   schema (查證過), 要嘛得寫死 `extensions.` 前綴、要嘛得靠 search_path, 兩者都比
--   pg_catalog 內建的脆弱。
--   格式維持「12 碼大寫十六進位」與現況完全一致 —— UI 的等寬字型欄位、複製按鈕、
--   join_gym 的 upper(trim(...)) 正規化都不用動。
--
-- 套用後會不會影響現有功能: 不會, 而且**現有的碼一律不變**。
--   這裡只改欄位 DEFAULT, 沒有 update 任何一列 —— 20 位成員手上、LINE 群裡貼過的碼
--   繼續有效。只有「之後新建的道館」會拿到新亂數。
--   (若哪天要輪替既有的碼, 那是另一件事, 需要 UI 一起做, 見下方註解。)
--
-- 誰會實際評估這個 DEFAULT:
--   gym_invites 沒有任何 INSERT policy, 唯一的寫入路徑是 gyms 上的 AFTER INSERT trigger
--   `on_gym_created` → handle_new_gym() (security definer, owner = postgres),
--   DEFAULT 會在那個 security context 下求值。這裡仍把 EXECUTE 給 authenticated,
--   是為了讓日後若有人在別的 context 插 gym_invites 不會莫名其妙失敗
--   (回傳一串亂數的函式本身沒有任何提權價值)。

create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  -- 12 碼大寫十六進位 (48 bits), 來源是 OS CSPRNG
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

comment on function public.new_invite_code() is
  '產生入館邀請碼 (12 碼大寫十六進位, CSPRNG)。gym_invites.code / advisor_code 的 DEFAULT。';

revoke all on function public.new_invite_code() from public, anon;
grant execute on function public.new_invite_code() to authenticated;

alter table public.gym_invites
  alter column code set default public.new_invite_code();

alter table public.gym_invites
  alter column advisor_code set default public.new_invite_code();

-- 注意: 這裡**故意沒有**重新產生既有的碼。
--   update gym_invites set code = public.new_invite_code();   ← 絕對不要跑
-- 那會讓 20 個人手上的碼當場失效。輪替應該是管理員在 UI 上主動按的動作
-- (gym_invites 已經有 gym_invites_update_admin policy, DB 這一側是通的,
--  缺的是一支 rotate RPC + 成員與拍組頁的入口)。
