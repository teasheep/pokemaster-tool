-- 0017: 派遣唯一鍵補上輪次 — 同成員同關「每輪」可各有一筆派遣
-- 0005 的 unique(stage_id, member_id) 與逐輪排刀矛盾: 強力成員每輪打同關是常態,
-- 自動排刀的 upsert 會靜默丟棄 R2 之後的建議。在 0016 之後執行。

alter table public.stage_assignments
  drop constraint if exists stage_assignments_stage_id_member_id_key;

-- round 可為 null (整場通用), unique 需用 coalesce 表達 → 改用 unique index
create unique index if not exists stage_assignments_stage_member_round_key
  on public.stage_assignments (stage_id, member_id, coalesce(round, -1));
