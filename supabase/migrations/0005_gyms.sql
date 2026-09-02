-- 0005: 道館賽 (帕希歐道館對戰) 功能
--
-- 背景: 遊戲內「訓練家道館」是 20 人公會, 官方不定期舉辦「帕希歐道館對戰」——
-- 全館共同挑戰 8 位館主, 每關有官方指定弱點屬性, 消耗「道館對戰挑戰券」計分。
-- 本 migration 建立多租戶的道館空間: 道館/成員/成員戰力資料 (持有拍組、主打手
-- 分數、降抗值)/屬性攻略庫/賽事與關卡/派遣/挑戰券。
--
-- 設計重點:
--   - 多道館互不干擾: 所有表都帶 gym_id, RLS 以 security definer helper
--     (is_gym_member / is_gym_admin / is_self_member) 判定, 避免遞迴 policy。
--   - 邀請碼入館走 join_gym() RPC (security definer), gyms 表對非成員不可讀,
--     避免 0004 修掉的 shares 那種枚舉洩漏。
--   - pair_id 沿用 user_collection 慣例: brybry 11 碼字串, 不設 FK,
--     由 app 層用 JSON catalog (loadPairsById) 驗證。
--   - member_tickets / stage_assignments / battle_stages 加入 realtime
--     publication, 前端訂閱 postgres_changes 做即時看板 (RLS 同樣管事件可見性)。
-- 在 0004 之後執行。

-- ====================================================================
-- 1. 資料表
-- ====================================================================

-- 道館 (公會)。邀請碼放在 gym_invites (只有管理員可讀), 不放這裡 —
-- gyms 對全體成員可讀, 邀請碼放這裡會把入館憑證洩漏給所有成員。
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 50),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 邀請碼 (1:1 於 gyms, 由 handle_new_gym trigger 自動建立)。
-- 只有管理員可讀/可輪替 (update code); join_gym RPC (security definer) 負責比對。
create table public.gym_invites (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  code text not null unique
    default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 道館成員。user_id 可為 null: 匯入名單的成員尚未綁定帳號,
-- 之後用 join_gym() 以相同暱稱入館即自動認領綁定。
create table public.gym_members (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 30),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, display_name)
);

create unique index gym_members_gym_user_uniq
  on public.gym_members (gym_id, user_id) where user_id is not null;
create index gym_members_gym_idx on public.gym_members (gym_id);

-- 成員拍組持有 (來源: 主打手查詢頁 + 手動維護)。
-- grade: 0=無持有, 1..5=寶1..寶5, 6=超覺醒 (排序即強度順序)。
-- pair_label 為正規化後的「訓練家&寶可夢」顯示名; pair_id 對到 catalog 時才有值。
create table public.member_pairs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  pair_label text not null,
  pair_id text,
  grade smallint not null default 0 check (grade between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, pair_label)
);

create index member_pairs_gym_idx on public.member_pairs (gym_id);
create index member_pairs_member_idx on public.member_pairs (member_id);

-- 成員主打手分數快照 (來源: 主打手查詢頁; 計算公式在來源端, 這裡只存值)。
create table public.member_type_scores (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  type public.sync_pair_type not null,
  category text not null check (category in ('physical', 'special')),
  score numeric(6, 2) not null check (score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, type, category)
);

create index member_type_scores_gym_idx on public.member_type_scores (gym_id);

-- 成員降抗/輔助數值 (來源: 降抗查詢頁)。
-- kind: debuff=降抗, sp_atk=特攻, ph_atk=物攻, field=場域。value 為來源頁 0-7 刻度。
-- 紅黃綠燈 (>=9 綠 / 6-8 黃 / <6 紅) 是衍生值, 由查詢端加總計算, 不落庫。
create table public.member_debuffs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  type public.sync_pair_type not null,
  kind text not null check (kind in ('debuff', 'sp_atk', 'ph_atk', 'field')),
  pair_label text not null,
  pair_id text,
  value smallint not null default 0 check (value between 0 and 9),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, type, kind, pair_label)
);

create index member_debuffs_gym_idx on public.member_debuffs (gym_id);
create index member_debuffs_member_idx on public.member_debuffs (member_id);

-- 屬性攻略庫: 每館自訂「這個弱點屬性推薦帶哪些拍組」。
-- tag: main=主打, debuff=降抗, support=輔助。priority 越大越優先。
create table public.strategy_pairs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  type public.sync_pair_type not null,
  pair_id text not null,
  priority smallint not null default 0,
  tag text check (tag in ('main', 'debuff', 'support')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, type, pair_id)
);

create index strategy_pairs_gym_type_idx on public.strategy_pairs (gym_id, type);

-- 賽事 (一回帕希歐道館對戰)。
create table public.gym_battles (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 50),
  status text not null default 'planning' check (status in ('planning', 'active', 'finished')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_battles_gym_idx on public.gym_battles (gym_id);

-- 賽事關卡 (通常 8 關, 每關一位館主 + 官方指定弱點屬性)。
-- rule 是特殊規則的自由描述; rule_block 是給派遣演算法用的機器可讀欄位
-- (physical=物理無效 → 只派特殊打手, special 反之)。
create table public.battle_stages (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  seq smallint not null check (seq between 1 and 20),
  leader_name text,
  weak_type public.sync_pair_type not null,
  rule text,
  rule_block text check (rule_block in ('physical', 'special')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (battle_id, seq)
);

create index battle_stages_battle_idx on public.battle_stages (battle_id);
create index battle_stages_gym_idx on public.battle_stages (gym_id);

-- 派遣: 誰・用什麼隊伍 (pair_ids)・打哪一關。
-- source: auto=自動派遣建議, manual=管理員手動指定/調整過。
create table public.stage_assignments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  stage_id uuid not null references public.battle_stages(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  pair_ids text[] not null default '{}',
  reason text,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  status text not null default 'assigned' check (status in ('assigned', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, member_id)
);

create index stage_assignments_battle_idx on public.stage_assignments (battle_id);
create index stage_assignments_gym_idx on public.stage_assignments (gym_id);
create index stage_assignments_member_idx on public.stage_assignments (member_id);

-- 挑戰券 (票數): 每人每回賽事的剩餘張數。官方規則: 開賽 9 張、每日 +3、上限 30。
create table public.member_tickets (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  remaining smallint not null default 9 check (remaining between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (battle_id, member_id)
);

create index member_tickets_battle_idx on public.member_tickets (battle_id);
create index member_tickets_gym_idx on public.member_tickets (gym_id);

-- ====================================================================
-- 2. updated_at triggers (set_updated_at 已在 0001 建立)
-- ====================================================================

create trigger gyms_set_updated_at
  before update on public.gyms
  for each row execute function public.set_updated_at();
create trigger gym_invites_set_updated_at
  before update on public.gym_invites
  for each row execute function public.set_updated_at();
create trigger gym_members_set_updated_at
  before update on public.gym_members
  for each row execute function public.set_updated_at();
create trigger member_pairs_set_updated_at
  before update on public.member_pairs
  for each row execute function public.set_updated_at();
create trigger member_type_scores_set_updated_at
  before update on public.member_type_scores
  for each row execute function public.set_updated_at();
create trigger member_debuffs_set_updated_at
  before update on public.member_debuffs
  for each row execute function public.set_updated_at();
create trigger strategy_pairs_set_updated_at
  before update on public.strategy_pairs
  for each row execute function public.set_updated_at();
create trigger gym_battles_set_updated_at
  before update on public.gym_battles
  for each row execute function public.set_updated_at();
create trigger battle_stages_set_updated_at
  before update on public.battle_stages
  for each row execute function public.set_updated_at();
create trigger stage_assignments_set_updated_at
  before update on public.stage_assignments
  for each row execute function public.set_updated_at();
create trigger member_tickets_set_updated_at
  before update on public.member_tickets
  for each row execute function public.set_updated_at();

-- 建館時自動建立邀請碼
create or replace function public.handle_new_gym()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.gym_invites (gym_id) values (new.id);
  return new;
end;
$$;

create trigger on_gym_created
  after insert on public.gyms
  for each row execute function public.handle_new_gym();

-- 保護 owner_id: RLS 沒有欄位粒度, gyms_update_admin 會讓「非館主的 admin」
-- 有機會把 owner_id 改成自己 (admin→owner 提權 + 鎖出原館主)。
-- 只有現任館主本人能轉移館主; auth.uid() 為 null (service role / 腳本) 不受限。
create or replace function public.protect_gym_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and auth.uid() is not null
     and auth.uid() <> old.owner_id then
    raise exception 'OWNER_ONLY';
  end if;
  return new;
end;
$$;

create trigger gyms_protect_owner
  before update on public.gyms
  for each row execute function public.protect_gym_owner();

-- ====================================================================
-- 3. RLS helpers (security definer → 讀 gym_members/gyms 時繞過 RLS,
--    避免「gym_members 的 policy 查 gym_members」的遞迴)
-- ====================================================================

create or replace function public.is_gym_member(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid()
  ) or exists (
    select 1 from public.gyms
    where id = p_gym and owner_id = auth.uid()
  );
$$;

create or replace function public.is_gym_admin(p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gyms
    where id = p_gym and owner_id = auth.uid()
  ) or exists (
    select 1 from public.gym_members
    where gym_id = p_gym and user_id = auth.uid() and role = 'admin'
  );
$$;

-- 這個 member row 是否綁定目前登入者
create or replace function public.is_self_member(p_member uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where id = p_member and user_id = auth.uid()
  );
$$;

-- 資料完整性: member 是否屬於該 gym (寫入 policy 用, 防止跨館塞資料)
create or replace function public.member_in_gym(p_member uuid, p_gym uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_members
    where id = p_member and gym_id = p_gym
  );
$$;

grant execute on function public.is_gym_member(uuid) to anon, authenticated;
grant execute on function public.is_gym_admin(uuid) to anon, authenticated;
grant execute on function public.is_self_member(uuid) to anon, authenticated;
grant execute on function public.member_in_gym(uuid, uuid) to anon, authenticated;

-- ====================================================================
-- 4. RLS policies
-- ====================================================================

alter table public.gyms enable row level security;

create policy "gyms_select_member" on public.gyms
  for select using (public.is_gym_member(id));
create policy "gyms_insert_own" on public.gyms
  for insert with check (auth.uid() = owner_id);
create policy "gyms_update_admin" on public.gyms
  for update using (public.is_gym_admin(id)) with check (public.is_gym_admin(id));
create policy "gyms_delete_owner" on public.gyms
  for delete using (auth.uid() = owner_id);

-- 邀請碼: 只有管理員可讀與輪替 (一般成員拿不到, 減少外流面)
alter table public.gym_invites enable row level security;

create policy "gym_invites_select_admin" on public.gym_invites
  for select using (public.is_gym_admin(gym_id));
create policy "gym_invites_update_admin" on public.gym_invites
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));

alter table public.gym_members enable row level security;

create policy "gym_members_select_member" on public.gym_members
  for select using (public.is_gym_member(gym_id));
-- 新增成員: 管理員 (含館主)。一般使用者入館走 join_gym() RPC。
create policy "gym_members_insert_admin" on public.gym_members
  for insert with check (public.is_gym_admin(gym_id));
create policy "gym_members_update_admin" on public.gym_members
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
-- 成員可改自己的暱稱; with check 擋住自我升權與把 row 搬去別館
create policy "gym_members_update_self" on public.gym_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = 'member' and public.is_gym_member(gym_id));
create policy "gym_members_delete" on public.gym_members
  for delete using (public.is_gym_admin(gym_id) or user_id = auth.uid());

-- 成員資料表 (持有/分數/降抗) 共用同一套 policy 形狀:
-- 全館可讀; 寫入 = 管理員或本人, 且 member 必須屬於該 gym。

alter table public.member_pairs enable row level security;

create policy "member_pairs_select" on public.member_pairs
  for select using (public.is_gym_member(gym_id));
create policy "member_pairs_insert" on public.member_pairs
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_pairs_update" on public.member_pairs
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_pairs_delete" on public.member_pairs
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

alter table public.member_type_scores enable row level security;

create policy "member_type_scores_select" on public.member_type_scores
  for select using (public.is_gym_member(gym_id));
create policy "member_type_scores_insert" on public.member_type_scores
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_type_scores_update" on public.member_type_scores
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_type_scores_delete" on public.member_type_scores
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

alter table public.member_debuffs enable row level security;

create policy "member_debuffs_select" on public.member_debuffs
  for select using (public.is_gym_member(gym_id));
create policy "member_debuffs_insert" on public.member_debuffs
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_debuffs_update" on public.member_debuffs
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_debuffs_delete" on public.member_debuffs
  for delete using (public.is_gym_admin(gym_id) or public.is_self_member(member_id));

-- 攻略庫/賽事/關卡: 全館可讀, 管理員可寫。

alter table public.strategy_pairs enable row level security;

create policy "strategy_pairs_select" on public.strategy_pairs
  for select using (public.is_gym_member(gym_id));
create policy "strategy_pairs_write" on public.strategy_pairs
  for insert with check (public.is_gym_admin(gym_id));
create policy "strategy_pairs_update" on public.strategy_pairs
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "strategy_pairs_delete" on public.strategy_pairs
  for delete using (public.is_gym_admin(gym_id));

alter table public.gym_battles enable row level security;

create policy "gym_battles_select" on public.gym_battles
  for select using (public.is_gym_member(gym_id));
create policy "gym_battles_insert" on public.gym_battles
  for insert with check (public.is_gym_admin(gym_id));
create policy "gym_battles_update" on public.gym_battles
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "gym_battles_delete" on public.gym_battles
  for delete using (public.is_gym_admin(gym_id));

alter table public.battle_stages enable row level security;

create policy "battle_stages_select" on public.battle_stages
  for select using (public.is_gym_member(gym_id));
create policy "battle_stages_insert" on public.battle_stages
  for insert with check (public.is_gym_admin(gym_id));
create policy "battle_stages_update" on public.battle_stages
  for update using (public.is_gym_admin(gym_id)) with check (public.is_gym_admin(gym_id));
create policy "battle_stages_delete" on public.battle_stages
  for delete using (public.is_gym_admin(gym_id));

-- 派遣: 管理員建立/刪除; 成員可更新自己的派遣 (標記完成、調整隊伍)。

alter table public.stage_assignments enable row level security;

create policy "stage_assignments_select" on public.stage_assignments
  for select using (public.is_gym_member(gym_id));
create policy "stage_assignments_insert" on public.stage_assignments
  for insert with check (
    public.member_in_gym(member_id, gym_id) and public.is_gym_admin(gym_id)
  );
create policy "stage_assignments_update" on public.stage_assignments
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "stage_assignments_delete" on public.stage_assignments
  for delete using (public.is_gym_admin(gym_id));

-- 挑戰券: 全館可讀; 本人或管理員可更新。

alter table public.member_tickets enable row level security;

create policy "member_tickets_select" on public.member_tickets
  for select using (public.is_gym_member(gym_id));
create policy "member_tickets_insert" on public.member_tickets
  for insert with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_tickets_update" on public.member_tickets
  for update using (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  with check (
    public.member_in_gym(member_id, gym_id)
    and (public.is_gym_admin(gym_id) or public.is_self_member(member_id))
  );
create policy "member_tickets_delete" on public.member_tickets
  for delete using (public.is_gym_admin(gym_id));

-- ====================================================================
-- 5. 邀請碼入館 RPC (security definer; gyms 對非成員不可讀, 防枚舉)
--    錯誤以代碼字串丟出, client 對應成中文訊息:
--    AUTH_REQUIRED / INVALID_CODE / NAME_REQUIRED / NAME_TAKEN
-- ====================================================================

create or replace function public.join_gym(p_code text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_name text := trim(coalesce(p_display_name, ''));
  v_claimed uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select gym_id into v_gym from public.gym_invites
  where code = upper(trim(coalesce(p_code, '')));
  if v_gym is null then
    raise exception 'INVALID_CODE';
  end if;

  -- 已是成員 → 直接回傳 (冪等)
  if exists (
    select 1 from public.gym_members where gym_id = v_gym and user_id = v_uid
  ) then
    return v_gym;
  end if;

  if char_length(v_name) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  -- 名單上已有同名的未綁定成員 (匯入資料) → 認領綁定。
  -- 只允許認領 role='member' 的列: 未綁定的 admin 列不可被自助認領 (防持碼者直接取得 admin)。
  -- 注意: 認領只憑「邀請碼 + 同名」, 名字對全體成員可見 — 邀請碼務必只給信任的人,
  -- 外流時管理員應立即輪替邀請碼 (gym_invites.code)。
  update public.gym_members
     set user_id = v_uid
   where gym_id = v_gym and user_id is null and display_name = v_name and role = 'member'
   returning id into v_claimed;

  if v_claimed is null then
    insert into public.gym_members (gym_id, user_id, display_name)
    values (v_gym, v_uid, v_name);
  end if;

  return v_gym;
exception
  when unique_violation then
    raise exception 'NAME_TAKEN';
end;
$$;

revoke execute on function public.join_gym(text, text) from public, anon;
grant execute on function public.join_gym(text, text) to authenticated;

-- ====================================================================
-- 5c. 券數增減 RPC (security INVOKER → RLS 照常把關「本人或管理員」)。
--     用 DB 端的 remaining + delta 原子運算, 避免 client 拿過期值寫絕對值
--     (連點/多人同時操作會互相蓋掉)。row 不存在時以官方開賽 9 張為基底建立。
-- ====================================================================

create or replace function public.adjust_member_ticket(
  p_gym uuid, p_battle uuid, p_member uuid, p_delta int
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_remaining int;
begin
  insert into public.member_tickets (gym_id, battle_id, member_id, remaining)
  values (p_gym, p_battle, p_member, greatest(0, least(30, 9 + p_delta)))
  on conflict (battle_id, member_id)
  do update set remaining = greatest(0, least(30, member_tickets.remaining + p_delta))
  returning remaining into v_remaining;
  return v_remaining;
end;
$$;

grant execute on function public.adjust_member_ticket(uuid, uuid, uuid, int) to authenticated, service_role;

-- ====================================================================
-- 5b. 明確 table grants
--     雲端 SQL Editor 以 postgres 執行會繼承 default privileges, 但本地 CLI
--     以 supabase_admin 套用 migration 時不會 → 一律明寫。RLS 才是真正的門檻;
--     anon 不需要碰道館表, 僅 grant 給 authenticated + service_role。
--     舊表 (0001-0004 建立) 在全新環境同樣缺 grants, 這裡一併補齊 (冪等)。
-- ====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.gyms, public.gym_members, public.member_pairs, public.member_type_scores,
  public.member_debuffs, public.strategy_pairs, public.gym_battles, public.battle_stages,
  public.stage_assignments, public.member_tickets
to authenticated, service_role;

-- 邀請碼: authenticated 只需要讀與輪替 (建立/刪除由 trigger 與 cascade 處理)
grant select, update on public.gym_invites to authenticated;
grant select, insert, update, delete on public.gym_invites to service_role;

grant select, insert, update, delete on
  public.profiles, public.user_collection, public.shares
to authenticated, service_role;

-- 分享頁 RPC 走 security definer, 但 anon 需要基本 schema usage (上面已給);
-- shares 本身維持不給 anon (0004 的防枚舉決定)。

-- ====================================================================
-- 6. Realtime publication (即時看板: 券數/派遣/關卡)
--    RLS 同樣套用在 realtime 事件: 只有能 SELECT 該 row 的成員收得到。
-- ====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_tickets'
  ) then
    alter publication supabase_realtime add table public.member_tickets;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stage_assignments'
  ) then
    alter publication supabase_realtime add table public.stage_assignments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'battle_stages'
  ) then
    alter publication supabase_realtime add table public.battle_stages;
  end if;
  -- 賽事本身 (狀態變更) 也要即時: 其他人看的 status 不能永遠停在載入當下
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gym_battles'
  ) then
    alter publication supabase_realtime add table public.gym_battles;
  end if;
end $$;
