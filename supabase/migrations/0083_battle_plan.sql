-- 0083: 排刀表 (2026-10-02 使用者:「把排刀表那個格式長進系統內」)
--
-- 群組原本用一張截圖在排: 欄 = 8 關, 列 = 物攻 / 特攻 / 降抗…, 底下幾行敘述。
-- 長進看板之後是三張表:
--   battle_plan_fields  欄位 (名稱自己填, 可增刪; wide = 全場一格, 例如降抗)
--   battle_plan_slots   一列 = 「某欄位 × 某關 (全場是 null) 的一個人」, 或那一格的備註 (member_id 為 null)
--   battle_plans        這場排刀表的敘述 (一場一列)
--
-- 設計判斷:
--   * **全館成員都能改, 顧問唯讀** (使用者:「道館成員都共同看的到且可以編輯」) → 寫入一律 is_gym_editor,
--     與看板其他部分同一條規矩 (待確認的人 0071 本來就過不了 is_gym_*)。
--   * **一人一列, 不是一格一個陣列** —— 多人同時在排時, 各自點的人互不覆蓋
--     (陣列的話後存的會把先存的整格蓋掉, 跟 2026-09-09 道館拍組名單那次是同一種問題)。
--     加人 = insert … on conflict do nothing, 拿掉 = delete, 兩個都冪等。
--   * member_id 對 gym_members on delete cascade: 排刀是「這一場現在的安排」不是歷史,
--     人被移出就從表上消失 (刪掉的列照樣進 0082 的封存)。
--   * 唯一鍵用 `nulls not distinct` (PG15+): 全場那一格 stage_id 是 null、備註那一列 member_id 是 null,
--     一般的 unique 會把 null 當成互不相等 → 同一格可以長出兩列備註。PostgREST 的 onConflict
--     也能直接指這個欄位組合 (不是 expression index, 見 AGENTS「onConflict 不能引用 expression unique index」)。
--   * 新賽事自動帶三個預設欄位 (每關的物攻 / 特攻 + 全場的降抗), 既有的賽事在這裡補上。

create table public.battle_plan_fields (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  label text not null default '' check (char_length(label) <= 20),
  wide boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index battle_plan_fields_battle_idx on public.battle_plan_fields (battle_id);

create table public.battle_plan_slots (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  battle_id uuid not null references public.gym_battles(id) on delete cascade,
  field_id uuid not null references public.battle_plan_fields(id) on delete cascade,
  stage_id uuid references public.battle_stages(id) on delete cascade,
  member_id uuid references public.gym_members(id) on delete cascade,
  note text check (note is null or char_length(note) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 一列不是「一個人」就是「這一格的備註」
  check ((member_id is null) = (note is not null)),
  constraint battle_plan_slots_cell_member_key unique nulls not distinct (field_id, stage_id, member_id)
);
create index battle_plan_slots_battle_idx on public.battle_plan_slots (battle_id);

create table public.battle_plans (
  battle_id uuid primary key references public.gym_battles(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger battle_plan_fields_set_updated_at
  before update on public.battle_plan_fields
  for each row execute function public.set_updated_at();
create trigger battle_plan_slots_set_updated_at
  before update on public.battle_plan_slots
  for each row execute function public.set_updated_at();
create trigger battle_plans_set_updated_at
  before update on public.battle_plans
  for each row execute function public.set_updated_at();

-- ── RLS: 讀 = 道館成員 (含顧問), 寫 = 正式成員與管理員; 每一列的 gym / battle / 關卡 / 成員都要對得上 ──
alter table public.battle_plan_fields enable row level security;
alter table public.battle_plan_slots enable row level security;
alter table public.battle_plans enable row level security;

create policy "battle_plan_fields_select" on public.battle_plan_fields
  for select using (public.is_gym_member(gym_id));
create policy "battle_plan_fields_insert" on public.battle_plan_fields
  for insert with check (
    public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plan_fields.gym_id)
  );
create policy "battle_plan_fields_update" on public.battle_plan_fields
  for update using (public.is_gym_editor(gym_id))
  with check (
    public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plan_fields.gym_id)
  );
create policy "battle_plan_fields_delete" on public.battle_plan_fields
  for delete using (public.is_gym_editor(gym_id));

-- 欄位 / 關卡 / 成員都要是同一館同一場的; 全場一格 (stage_id null) 只能掛在 wide 欄位上, 反之亦然
create or replace function public.battle_plan_slot_ok(
  p_gym uuid, p_battle uuid, p_field uuid, p_stage uuid, p_member uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.battle_plan_fields f
       where f.id = p_field and f.gym_id = p_gym and f.battle_id = p_battle
         and f.wide = (p_stage is null)
    )
    and (p_stage is null or exists (
      select 1 from public.battle_stages s where s.id = p_stage and s.gym_id = p_gym and s.battle_id = p_battle
    ))
    and (p_member is null or exists (
      select 1 from public.gym_members m
       where m.id = p_member and m.gym_id = p_gym and m.status = 'active' and m.role <> 'advisor'
    ));
$$;
revoke execute on function public.battle_plan_slot_ok(uuid, uuid, uuid, uuid, uuid) from public, anon;

create policy "battle_plan_slots_select" on public.battle_plan_slots
  for select using (public.is_gym_member(gym_id));
create policy "battle_plan_slots_insert" on public.battle_plan_slots
  for insert with check (
    public.is_gym_editor(gym_id)
    and public.battle_plan_slot_ok(gym_id, battle_id, field_id, stage_id, member_id)
  );
create policy "battle_plan_slots_update" on public.battle_plan_slots
  for update using (public.is_gym_editor(gym_id))
  with check (
    public.is_gym_editor(gym_id)
    and public.battle_plan_slot_ok(gym_id, battle_id, field_id, stage_id, member_id)
  );
create policy "battle_plan_slots_delete" on public.battle_plan_slots
  for delete using (public.is_gym_editor(gym_id));

create policy "battle_plans_select" on public.battle_plans
  for select using (public.is_gym_member(gym_id));
create policy "battle_plans_insert" on public.battle_plans
  for insert with check (
    public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plans.gym_id)
  );
create policy "battle_plans_update" on public.battle_plans
  for update using (public.is_gym_editor(gym_id))
  with check (
    public.is_gym_editor(gym_id)
    and exists (select 1 from public.gym_battles b where b.id = battle_id and b.gym_id = battle_plans.gym_id)
  );
create policy "battle_plans_delete" on public.battle_plans
  for delete using (public.is_gym_editor(gym_id));

grant select, insert, update, delete on public.battle_plan_fields to authenticated, service_role;
grant select, insert, update, delete on public.battle_plan_slots to authenticated, service_role;
grant select, insert, update, delete on public.battle_plans to authenticated, service_role;

-- ── 預設欄位: 新賽事建立時帶上, 既有賽事補上 ──
create or replace function public.handle_new_battle_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.battle_plan_fields (gym_id, battle_id, label, wide, sort_order)
  values (new.gym_id, new.id, '物攻', false, 1),
         (new.gym_id, new.id, '特攻', false, 2),
         (new.gym_id, new.id, '降抗', true, 3);
  return new;
end;
$$;
revoke execute on function public.handle_new_battle_plan() from public, anon, authenticated;

drop trigger if exists on_battle_created_plan on public.gym_battles;
create trigger on_battle_created_plan
  after insert on public.gym_battles
  for each row execute function public.handle_new_battle_plan();

insert into public.battle_plan_fields (gym_id, battle_id, label, wide, sort_order)
select b.gym_id, b.id, v.label, v.wide, v.sort_order
  from public.gym_battles b
 cross join (values ('物攻', false, 1), ('特攻', false, 2), ('降抗', true, 3)) as v(label, wide, sort_order)
 where not exists (select 1 from public.battle_plan_fields f where f.battle_id = b.id);

-- ── 刪除封存 (0082 的同一支函式): 三張都是道館資料, 誤刪要救得回來 ──
-- ⚠ 不要把這三張加進 0082 的清單: 新專案從頭重建時 0082 先跑, 那時候這三張還不存在, 會直接失敗。
--   tests/deleted-rows-archive.test.ts 會把之後每一支 migration 裡的封存清單一起算進去。
do $$
declare
  t text;
begin
  foreach t in array array['battle_plan_fields', 'battle_plan_slots', 'battle_plans'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_archive_deleted', t);
    execute format(
      'create trigger %I after delete on public.%I referencing old table as old_rows '
      'for each statement execute function public.archive_deleted_rows()',
      t || '_archive_deleted', t
    );
  end loop;
end;
$$;
