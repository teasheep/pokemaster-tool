-- 0062: 頭像圓圈的自訂文字
--
-- 2026-09-09 成員的意見 (使用者轉述):
--   「圓圈醒目文字可以替每一位會友選定特別的文字～ 這樣網頁有些內容設計看到圈圈
--     就可以馬上知道是哪一位會友」
--
-- 為什麼放 `gym_members` 而不是 `profiles`:
--   AGENTS 的「名字跟人走」講的是**身分** (遊戲名/社群名, 跨道館一致)。
--   這個欄位不是身分, 是**這個道館裡怎麼認他** —— 而且提出的情境就是管理員替全館的人
--   各挑一個好認的字 (「替每一位會友選定」)。同一個人在別的道館可以是別的字, 那沒問題。
--   維護方式也因此與 display_name / line_name 一致: 管理員在「編輯成員」裡改,
--   本人也能改自己那一列 (RLS 的 gym_members_update_self 早就允許)。
--
-- 沒設 = null → 畫面退回「社群名的第一個字」(社群名沒有才用遊戲名),
-- 與 memberLabel 改成「社群名(遊戲名)」是同一個判斷 (components/gym/member-card.tsx)。
--
-- 3 個字是版面決定的: 圓圈最小是 28px (排刀那種密集列), 超過 3 個字一定糊掉。
-- 在資料庫擋而不是只靠前端 —— 這種上限漏掉的症狀是「某一列的圓圈長得跟別人不一樣」,
-- 而那不會有人回報。

alter table public.gym_members
  add column if not exists badge_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gym_members_badge_text_len'
  ) then
    alter table public.gym_members
      add constraint gym_members_badge_text_len
      check (badge_text is null or char_length(badge_text) between 1 and 3);
  end if;
end;
$$;

comment on column public.gym_members.badge_text is
  '頭像圓圈的自訂文字 (1-3 字)。null = 從社群名取字。這是「這一館怎麼認他」, 不是身分。';
