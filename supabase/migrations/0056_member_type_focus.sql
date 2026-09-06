-- 0056: 成員的屬性資源方向 — 「想投入」與「已投入較多」
--
-- 使用者要的是: /resources 這頁除了糖果之外, 再讓每個人複選兩組屬性,
--   want     想投入資源的屬性 (接下來想練的方向)
--   invested 已投入較多資源的屬性 (裝備 / 等級 / 潛能盤)
-- 用途是「之後方便安排」—— 排道館戰時看得到誰在練哪一路。
--
-- 為什麼不塞進 member_candies (0036 那張已經放寬成「不只糖果」的表):
--   那張表的語意是「有幾顆」(數量), 這裡是「哪些屬性」(集合) —— 沒有數量,
--   count 欄位永遠是雜訊, 而且排刀的「吃糖可達」演算法會讀到不該讀的列。
--
-- 為什麼掛在 gym_members 而不是 profiles:
--   讀取端是道館 (管理員看成員、/api/export 帶全館), 與 member_candies 同一條路徑。
--   資源本來就是「這個人的遊戲帳號狀態」但全站已經把它放在成員身上, 這裡跟著走。
--
-- 刻意**不記進 gym_activity**: 那份紀錄是「成員身上發生的事」(練度/糖果/券/出刀),
-- 這兩塊是隨時會改的偏好, 記了只會把真正的異動洗掉。
--
-- 一個屬性可以同時在兩塊裡 (已經練得深、還想再練) —— 不要做成互斥。
-- 在 0055 之後執行。

create table if not exists public.member_type_focus (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  kind text not null check (kind in ('want', 'invested')),
  -- 18 屬性, 與 src/data/sync-pairs.ts 的 ALL_TYPES 同一份 (tests/type-focus.test.ts 釘住)
  type text not null check (
    type in (
      'normal', 'fire', 'water', 'electric', 'grass', 'ice',
      'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
      'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
    )
  ),
  created_at timestamptz not null default now(),
  unique (member_id, kind, type)
);

create index if not exists member_type_focus_gym_idx on public.member_type_focus (gym_id);

alter table public.member_type_focus enable row level security;

-- RLS 與 member_candies 完全一致: 同館看得到, 只有本人或管理員能改。
drop policy if exists member_type_focus_select on public.member_type_focus;
create policy member_type_focus_select on public.member_type_focus
  for select using (public.is_gym_member(gym_id));

drop policy if exists member_type_focus_insert on public.member_type_focus;
create policy member_type_focus_insert on public.member_type_focus
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );

drop policy if exists member_type_focus_delete on public.member_type_focus;
create policy member_type_focus_delete on public.member_type_focus
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

-- 沒有 update policy: 這張表只有「有這一列 / 沒這一列」兩種狀態, 切換 = insert 或 delete。
-- 因此前端也不能用 upsert (PostgREST 的 upsert 會走 UPDATE, 會被 RLS 擋), 一律 insert,
-- 並把 23505 (unique_violation, 連點兩下的競態) 當成成功 —— 結果與預期一致。
--
-- ⚠ 底下這行 grant **不代表只有這三種權限**: Supabase 對 public schema 的 default privileges
-- 早就把七種權限 (含 UPDATE / TRUNCATE) 都授給 anon 與 authenticated 了, 全站每張表都一樣
-- (實測 member_candies / member_pairs / member_tickets / gym_activity 全是七種全開,
--  0026 對 gym_activity 只寫了 grant select 也一樣)。真正擋住的是 RLS。
grant select, insert, delete on public.member_type_focus to authenticated, service_role;
