-- 0018: EX 裝穿戴狀態
-- 個人收藏 (user_collection) 記錄玩家是否切到 EX style 換裝立繪;
-- 道館持有表 (member_pairs) 同步一份, 讓其他成員看持有時也能看到換裝。
alter table public.user_collection
  add column if not exists ex_style_worn boolean not null default false;

alter table public.member_pairs
  add column if not exists ex_style_worn boolean not null default false;
