-- 0060: 建館碼 (封測) + 試碼節流
--
-- 使用者 2026-09-09 指定: 「創建道館這件事要經過作者的審核」「現在建立道館要有我發的建館碼,
-- 然後只能使用一次」「已經建了就不管他」。
--
-- 為什麼是「碼」不是「申請 → 核准」:
--   申請制要長一個 pending 狀態、一個審核畫面、一條通知路徑, 而且**作者變成瓶頸**
--   (他出門三天, 想用的人就等三天)。碼制把審核挪到作者本來就在用的管道 (賴群):
--   發碼 = 核准, 不發 = 拒絕, 沒有人被卡在「申請中」。
--
-- 這支**完全不影響現有的兩個道館與 20 位成員**: 只擋建館, 不動 gyms / gym_members 任何一列,
-- 加入道館照舊走邀請碼 (join_gym 的節流在 0061)。
--
-- ⚠ 這裡有兩個一定會踩到的坑, 兩個都寫在下面對應的位置:
--   1. 改簽章 = 全新的函式物件 → 舊的 create_gym(text) 會留著 (PostgREST 挑得到舊的),
--      而且新的那支會重新套用 Supabase 的 default privileges (anon 又拿得到 EXECUTE)。
--      → 一定要 drop 舊簽章, 建完再重收一次權限 (0040 的前科, 0058 照做過)。
--   2. **失敗紀錄不能靠 raise exception 之後還存在** —— 例外會讓整個交易回滾, 那筆
--      「他試錯了」也會一起消失, 節流等於完全沒有作用 (而且測起來會像有效, 因為錯誤訊息照樣出現)。
--      Postgres 沒有 autonomous transaction, Supabase 也沒有可靠的 dblink/pg_background。
--      → 使用者輸入類的錯誤 (未登入 / 館名空白 / 碼無效 / 被節流) 一律**回傳** jsonb 而不是丟例外,
--        交易正常提交, 那筆失敗才留得下來。真正的內部錯誤照舊丟例外。

-- ── 建館碼 ────────────────────────────────────────────────────────────────
create table if not exists public.gym_create_codes (
  -- 格式與邀請碼完全一樣 (12 碼大寫十六進位, CSPRNG) —— 0053 那支
  code text primary key default public.new_invite_code(),
  /** 作者自己記「這組發給誰」 */
  note text,
  created_at timestamptz not null default now(),
  /** 以下三欄有值 = 這組已經用掉了 (一組只能用一次) */
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  used_gym uuid references public.gyms(id) on delete set null
);

comment on table public.gym_create_codes is
  '建館碼 (封測)。一組只能用一次; 唯一的存取路徑是 create_gym(), 沒有任何 RLS policy。';

alter table public.gym_create_codes enable row level security;
-- **刻意一條 policy 都不給**: 沒有人 (含已登入者) 讀得到「有哪些碼、還剩幾組」。
-- create_gym 是 security definer, 以 owner 身分繞過 RLS —— 那是唯一的入口。
-- revoke 也要寫: Supabase 對 public schema 的 default privileges 會把七種權限都授給
-- anon/authenticated (AGENTS 那條), 「沒寫 grant」不等於「沒有權限」。
revoke all on table public.gym_create_codes from anon, authenticated;

-- ── 試碼紀錄 (節流用) ──────────────────────────────────────────────────────
--
-- 先講清楚這張表**不是**在防猜中: 碼是 48 bits 的 CSPRNG, 每秒 10 次要猜幾十萬年。
-- 它擋的是「有人寫腳本狂打這支 RPC」造成的負載與噪音, 以及一組外流的碼被反覆試。
-- 判斷對象是 auth.uid() —— 打這支 RPC 一定要先有 Google 帳號, 這本身就是成本。
create table if not exists public.code_attempts (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null check (kind in ('create', 'join')),
  ok boolean not null,
  at timestamptz not null default now()
);

create index if not exists code_attempts_user_kind_at
  on public.code_attempts (user_id, kind, at desc);

comment on table public.code_attempts is
  '試碼節流用。只有 create_gym / join_gym (security definer) 寫得到, 沒有 RLS policy。';

alter table public.code_attempts enable row level security;
revoke all on table public.code_attempts from anon, authenticated;
revoke all on sequence public.code_attempts_id_seq from anon, authenticated;

-- ── create_gym: 多一個建館碼參數, 並改成回傳 jsonb ────────────────────────
--
-- 節流的門檻**刻意寫在函式裡不做成設定表**: 這是遊戲規則等級的常數, 開一張表等於
-- 多一個沒人會去改、卻要多一次查詢的東西 (與 battle-templates 寫在程式裡同一個判斷)。
--   10 分鐘內失敗 5 次 → 鎖 10 分鐘 (滑動視窗)。手滑打錯兩次的人完全不會遇到。
--
-- 回傳形狀:  { "gym_id": "<uuid>" }  或  { "error": "<代碼>" }
--   AUTH_REQUIRED / NAME_REQUIRED / TOO_MANY_ATTEMPTS / INVALID_CREATE_CODE
drop function if exists public.create_gym(text);

create or replace function public.create_gym(p_name text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_name text;
  v_avatar text;
  v_line text;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_claimed text;
  v_fails int;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'AUTH_REQUIRED');
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then
    return jsonb_build_object('error', 'NAME_REQUIRED');
  end if;

  -- 自己的舊紀錄順手清掉 (帶索引, 只掃自己那幾列) —— 這張表不需要長期保存
  delete from public.code_attempts
   where user_id = v_uid and at < now() - interval '1 day';

  select count(*) into v_fails
    from public.code_attempts
   where user_id = v_uid
     and kind = 'create'
     and not ok
     and at > now() - interval '10 minutes';
  if v_fails >= 5 then
    return jsonb_build_object('error', 'TOO_MANY_ATTEMPTS');
  end if;

  -- **認領要原子**: 一句 update ... where used_by is null returning, 不是先 select 再 update。
  -- 兩個人同時貼同一組碼時, 只有一個人的 update 會命中 (另一個看到 0 列)。
  update public.gym_create_codes
     set used_by = v_uid, used_at = now()
   where code = v_code and used_by is null
  returning code into v_claimed;

  if v_claimed is null then
    insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'create', false);
    return jsonb_build_object('error', 'INVALID_CREATE_CODE');
  end if;

  select display_name, avatar_url, line_name into v_name, v_avatar, v_line
    from public.profiles where id = v_uid;
  if v_name is null or char_length(trim(v_name)) < 1 then
    select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  end if;

  insert into public.gyms (name) values (trim(p_name)) returning id into v_gym;
  insert into public.gym_members (gym_id, user_id, display_name, role, avatar_url, line_name)
  values (v_gym, v_uid, coalesce(v_name, '訓練家'), 'admin', v_avatar, v_line);

  -- 事後追得到「這組碼開出來的是哪一館」。建館若在這之前就失敗, 整筆交易回滾 ——
  -- 碼會自動退回未使用, 不會平白燒掉一組。
  update public.gym_create_codes set used_gym = v_gym where code = v_claimed;
  insert into public.code_attempts (user_id, kind, ok) values (v_uid, 'create', true);

  return jsonb_build_object('gym_id', v_gym);
end;
$$;

comment on function public.create_gym(text, text) is
  '建立道館 (需要一次性的建館碼)。回 {gym_id} 或 {error}; 使用者輸入類的錯誤不丟例外, 否則試碼紀錄會跟著回滾。';

-- 權限照 0051 重收一次 —— 新簽章 = 新物件 = 重新套用了 default privileges。
-- 一律寫 `from public, anon`: 只 revoke public 是無效的 (0050 檔頭那個坑)。
revoke all on function public.create_gym(text, text) from public, anon;
grant execute on function public.create_gym(text, text) to authenticated;
