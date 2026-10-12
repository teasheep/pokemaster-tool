-- 0085: 離開道館的人一律存名字 / 頭像快照 (不再限「有出刀紀錄的人」)
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration 各包一層交易。
--
-- 2026-10-12 使用者:「舊的人就留著紀錄 標已離開就好了啊」
-- 前科: 阿育 10/12 離開後, 她 10/5 改自己練度的紀錄在「道館紀錄」變成
--   「匯入資料 改了 已退出的成員 的 拍組練度」—— 道館紀錄頁只從現役名冊找名字。
--   前端 (activity/page.tsx) 已改成也讀 departed_members; 但 0081 只替「有出刀紀錄的人」存快照,
--   沒出過刀就離開的人, 他留下的拍組 / 糖果 / 人員異動紀錄照樣會掉成「已退出的成員」。
--
-- 做法:
--   1. snapshot_departed_member() 拿掉「沒有出刀紀錄就不存」那一條: 正式成員 (含顧問) 離開一律存。
--      **待確認的申請被拒 / 自己取消不存** —— 他從來沒進來過, 沒有留下任何紀錄 (0071 放行前什麼都寫不進去)。
--      整館刪除照舊不存。
--   2. 補資料: 0082 起刪掉的 gym_members 整列都在 deleted_rows 裡, 從那裡把「已經離開、還沒有快照」的人補上
--      (只補道館還在的、離開時是正式成員的; left_at 用當時的刪除時間)。0082 之前離開的人沒有資料可補。

create or replace function public.snapshot_departed_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 整館刪除 (gyms → gym_members 的 cascade): 那一館已經不在了, 不存
  if not exists (select 1 from public.gyms where id = old.gym_id) then
    return old;
  end if;
  -- 待確認就被拒絕 / 取消申請: 沒進來過, 也沒有紀錄要對名字
  if old.status = 'pending' then
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

-- 補資料: deleted_rows (0082) 裡「已經離開、還沒有快照」的正式成員
insert into public.departed_members (id, gym_id, user_id, display_name, line_name, avatar_url, badge_text, left_at)
select distinct on ((d.data->>'id')::uuid)
       (d.data->>'id')::uuid, (d.data->>'gym_id')::uuid, nullif(d.data->>'user_id', '')::uuid,
       d.data->>'display_name', d.data->>'line_name', d.data->>'avatar_url', d.data->>'badge_text', d.deleted_at
  from public.deleted_rows d
 where d.table_name = 'gym_members'
   and coalesce(d.data->>'status', 'active') <> 'pending'
   and d.data->>'display_name' is not null
   and exists (select 1 from public.gyms g where g.id = (d.data->>'gym_id')::uuid)
   and not exists (select 1 from public.gym_members m where m.id = (d.data->>'id')::uuid)
   and not exists (select 1 from public.departed_members x where x.id = (d.data->>'id')::uuid)
 order by (d.data->>'id')::uuid, d.deleted_at desc
on conflict (id) do nothing;
