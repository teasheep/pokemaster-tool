-- 0007: 排刀板強化 + 成員時段/LINE 名對應
--
-- 依三回道館戰的 LINE 協調記錄:
--   - 派遣要能表達「角色 (主打/副打/降抗/收尾)、棒次順序、預計券數」——
--     群內的「1+2+1」記號就是棒次×券數的接力劇本
--   - 成員的可上線時段是排刀關鍵 (夜班降抗手全隊在等), 開發者本人在群內
--     提議「表單加上出沒時間欄位」
--   - LINE 顯示名與遊戲暱稱對不上是長期痛點 (分工表特地改用 LINE 名顯示)
-- 在 0006 之後執行。

alter table public.gym_members
  add column if not exists line_name text
    check (line_name is null or char_length(line_name) between 1 and 30),
  add column if not exists availability text
    check (availability is null or char_length(availability) <= 100);

comment on column public.gym_members.line_name is 'LINE 顯示名 (與遊戲暱稱對應, 找人用)';
comment on column public.gym_members.availability is '出沒時段 (自由填, 例: 平日 12-14, 22-24 / 夜班 00-08)';

alter table public.stage_assignments
  add column if not exists role text
    check (role is null or role in ('main', 'assist', 'debuff', 'closer')),
  add column if not exists slot smallint
    check (slot is null or slot between 1 and 20),
  add column if not exists planned_tickets smallint
    check (planned_tickets is null or planned_tickets between 0 and 3);

comment on column public.stage_assignments.role is '排刀角色: main主打/assist副打/debuff降抗/closer收尾';
comment on column public.stage_assignments.slot is '棒次 (1=第一棒; 同關依此排序, 組成 1+2+1 之類的接力劇本)';
comment on column public.stage_assignments.planned_tickets is '預計使用券數 (0-3)';
