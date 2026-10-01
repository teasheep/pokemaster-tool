-- 0081: 移出成員不再刪掉他的出刀紀錄 —— 紀錄留著, 看板上顯示灰色頭像 + 名字
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-10-01 使用者:「出刀紀錄 隊伍庫那些要留著 因為就是那個人出刀的 不應該跟著成員離開而離開
--   也許可以頭像變灰之類的 但記錄應該要留著」
-- 前科: 泡茶綿羊移出哲爸時, battle_logs.member_id 的 FK 是 on delete cascade ——
--   哲爸在第三次道館戰的 21 筆 / 30 張券跟著被刪, 那一場的統計在賽事結束後被改掉了。
-- (隊伍庫 gym_teams / gym_team_pairs 沒有任何欄位指向成員, 移出成員本來就碰不到。)
--
-- 做法:
--   1. 拿掉 battle_logs.member_id 的 FK —— 成員被移出之後紀錄留著, member_id 照舊是他原本那一列的 id。
--      寫入照樣擋得住亂填的 member_id: insert / update 的 RLS 都要 member_in_gym(member_id, gym_id)。
--      **不改成 on delete set null**: 那樣要動每一個讀 member_id 的地方, 而看板本來就有
--      「名冊上查不到這個人」那條路 (以前畫成「?」或直接不畫)。
--   2. departed_members: 被移出的那一刻存一份名字 / 頭像快照 (id = 原本的 gym_members.id),
--      看板拿它畫灰色頭像。只在他有出刀紀錄時才存 (沒紀錄的人存了也沒有地方用)。
--      整館刪除時不存 (那一館已經不在了, 外鍵也會擋)。
--   挑戰券剩餘數 (member_tickets)、拍組鏡像、糖果、資源屬性照舊跟著成員刪 —— 那些是「這一館的這個人」
--   現在的狀態, 不是歷史紀錄; 拍組本來就在帳號裡 (0080)。

-- ── 1. 出刀紀錄不跟著成員刪 ──
alter table public.battle_logs drop constraint if exists battle_logs_member_id_fkey;

-- ── 2. 離開的成員的快照 ──
create table if not exists public.departed_members (
  id uuid primary key,  -- = 原本的 gym_members.id (battle_logs.member_id 指的就是它)
  gym_id uuid not null references public.gyms(id) on delete cascade,
  user_id uuid,
  display_name text not null,
  line_name text,
  avatar_url text,
  badge_text text,
  left_at timestamptz not null default now()
);
create index if not exists departed_members_gym_idx on public.departed_members (gym_id);

alter table public.departed_members enable row level security;
-- 讀: 跟出刀紀錄同一條 (看得到那一館的紀錄, 就看得到紀錄是誰出的)
drop policy if exists departed_members_select on public.departed_members;
create policy departed_members_select on public.departed_members
  for select using (public.is_gym_member(gym_id));
-- 寫: 沒有任何 policy —— 唯一的入口是下面那支 security definer trigger。
-- (Supabase 的 default privileges 會把寫入權限授給 anon/authenticated, 擋住的是「沒有 policy」;
--  這裡再明寫 revoke, 免得哪天有人加了一條寬鬆的 policy。)
revoke insert, update, delete, truncate on public.departed_members from anon, authenticated;

create or replace function public.snapshot_departed_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 整館刪除 (gyms → gym_members 的 cascade): 那一館已經不在了, 不存
  if not exists (select 1 from public.gyms where id = old.gym_id) then
    return old;
  end if;
  -- 沒有出刀紀錄就沒有地方用得到這份快照
  if not exists (select 1 from public.battle_logs where member_id = old.id) then
    return old;
  end if;
  insert into public.departed_members (id, gym_id, user_id, display_name, line_name, avatar_url, badge_text)
  values (old.id, old.gym_id, old.user_id, old.display_name, old.line_name, old.avatar_url, old.badge_text)
  on conflict (id) do update
    set display_name = excluded.display_name,
        line_name = excluded.line_name,
        avatar_url = excluded.avatar_url,
        badge_text = excluded.badge_text,
        left_at = now();
  return old;
end;
$$;
-- (回傳 trigger 的函式 PostgREST 不會當 RPC 曝出來, 權限維持預設, 與其他紀錄 trigger 一致)

drop trigger if exists gym_members_departed on public.gym_members;
create trigger gym_members_departed
  after delete on public.gym_members
  for each row execute function public.snapshot_departed_member();
