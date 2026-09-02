-- 0047: 2026-08-18 稽核後的 schema 清理 — 「存了沒人讀 / 寫了沒人看」一律移除
--
-- 依據: 稽核 workflow wf_0a10bc22 confirmed findings。被 drop 的資料已備份在
-- ref/archive-legacy-fix-2026-08-18.json (leader_name 24 筆、stage_assignments 4 筆)。
-- 排刀/特規重做時需要的表屆時重建 — 空表留著只會讓人誤信它是活的。

-- 1) battle_logs: round_label 與 round 100% 冗餘 (0046 起顯示一律派生); notes 從未讀寫
alter table public.battle_logs drop column if exists round_label;
alter table public.battle_logs drop column if exists notes;

-- 2) battle_stages: leader_name 只剩 export 在輸出 (UI 不顯示不可編, 「道館只有屬性」);
--    rule / rule_block / team_id 是 0005/0010 時代被繞過的設計, 全為 null
alter table public.battle_stages drop column if exists leader_name;
alter table public.battle_stages drop column if exists rule;
alter table public.battle_stages drop column if exists rule_block;
alter table public.battle_stages drop column if exists team_id;

-- 3) gym_battles: status 由賽期日期推導 (battleStatusFromDates), current_round 由
--    battle_logs 的最大輪推導 — 兩欄都不再讀, 留著會有人誤信
alter table public.gym_battles drop column if exists status;
alter table public.gym_battles drop column if exists current_round;

-- 4) user_collection: 招式/同步等級不存在於本站 (AGENTS 明訂已刪), 匯入殘值無人讀
--    get_shared_collection 回傳型別含這兩欄 — 先重建函式再 drop (return type 變更要先 drop)
drop function if exists public.get_shared_collection(text);

alter table public.user_collection drop column if exists move_level;
alter table public.user_collection drop column if exists sync_level;

create function public.get_shared_collection(p_token text)
returns table (
  pair_id text,
  owned boolean,
  level int,
  promotion int,
  potential int,
  super_awakening int,
  ex_unlocked boolean
)
language sql
security definer
set search_path = public
as $$
  select c.pair_id, c.owned, c.level, c.promotion, c.potential,
         c.super_awakening, c.ex_unlocked
  from public.shares s
  join public.user_collection c on c.user_id = s.user_id
  where s.token = p_token
    and c.owned = true
    and (s.expires_at is null or s.expires_at > now());
$$;

grant execute on function public.get_shared_collection(text) to anon, authenticated;

-- 5) gym_members.avatar_pair_id: 無任何寫入路徑, 讀取 fallback 永遠走不到
alter table public.gym_members drop column if exists avatar_pair_id;

-- 6) 排刀時代的表: stage_plan_pairs 從未被寫入過; stage_assignments 已無新增入口
--    (殘餘 4 列已備份); battle_round_rules 0 列且編輯入口已拔 — 重做時重建
drop table if exists public.stage_plan_pairs;
drop table if exists public.stage_assignments;
drop table if exists public.battle_round_rules;

-- 7) 出戰紀錄 activity trigger: 「關N R{round}」→ 統一 roundLabel 用詞
--    (關卡沒有順序概念不標第幾關; R1-3 / Ex1… 與全站一致)
create or replace function public.log_battle_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_round text;
begin
  if tg_op = 'INSERT' then
    v_round := case
      when new.round is null then ''
      when new.round <= 3 then 'R' || new.round
      else 'Ex' || (new.round - 3)
    end;
    perform public.log_activity(new.gym_id, new.member_id, 'battle_log',
      v_round, null, new.tickets_used::text || '券');
    return new;
  else
    v_round := case
      when old.round is null then ''
      when old.round <= 3 then 'R' || old.round
      else 'Ex' || (old.round - 3)
    end;
    perform public.log_activity(old.gym_id, old.member_id, 'battle_log',
      v_round, old.tickets_used::text || '券', null);
    return old;
  end if;
end;
$$;
