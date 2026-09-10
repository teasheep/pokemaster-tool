-- pair_label 裡的全形英數字改成半形, 跟著 catalog 一起。
--
-- ⚠ 不要自己寫 begin/commit —— scripts/setup-supabase.mjs 已經幫每一份 migration
--    各包一層交易, 多包一層會提早 commit 掉外層, 失敗時就回滾不了。
--
-- 2026-09-10 使用者要求把「琴音（２０２０夏季）」這種全形數字統一成半形,
-- 資料端由 scripts/normalize-pair-names.mjs 處理 (管線 5b3)。
--
-- **這一份非做不可, 不是順手整理**: `member_pairs` 與 `gym_pairs` 的唯一鍵是
-- (member_id, pair_label) / (gym_id, pair_label), 而那兩張表裡的 label 是**當初寫入時**
-- 由 pairName() 產的字串。catalog 改了名字之後:
--   - `set_member_pair` 的 `on conflict (member_id, pair_label)` 會**對不上舊列**
--     → 同一位成員同一張卡默默長出第二列 (兩列都有 grade, 持有率與排刀全部多算)
--   - `setGymPair` 的 upsert 同理, 名單會出現兩張一樣的卡
-- 這種壞法沒有任何徵兆, 所以名字一改就要立刻把 label 一起改。
--
-- 影響範圍 (套用前實查): member_pairs 4902 列中 315 列、gym_pairs 232 列中 18 列。
-- 只轉英數字, **不動全形括號** —— catalog 那 168 筆括號本來就全是全形, 沒有不一致。

-- 先擋一種例外: 轉完之後會與既有列撞唯一鍵 (代表半形那一份已經存在)。
-- 目前實查是 0 筆; 真的有的話就不要默默覆蓋, 讓 migration 失敗、人來看。
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select member_id, translate(pair_label,
      'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') lbl
    from public.member_pairs group by 1, 2 having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise exception '轉半形之後有 % 組 member_pairs 會撞唯一鍵, 先人工處理', v_dup;
  end if;

  select count(*) into v_dup from (
    select gym_id, translate(pair_label,
      'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') lbl
    from public.gym_pairs group by 1, 2 having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise exception '轉半形之後有 % 組 gym_pairs 會撞唯一鍵, 先人工處理', v_dup;
  end if;
end $$;

update public.member_pairs
   set pair_label = translate(pair_label,
     'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
     'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
 where pair_label ~ '[Ａ-Ｚａ-ｚ０-９]';

update public.gym_pairs
   set pair_label = translate(pair_label,
     'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
     'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
 where pair_label ~ '[Ａ-Ｚａ-ｚ０-９]';

-- 變化紀錄裡的拍組名 (gym_activity.target) 也一起轉 —— 它只是顯示用的字串, 沒有唯一鍵,
-- 但同一張卡在紀錄牆上一半全形一半半形會很怪。
update public.gym_activity
   set target = translate(target,
     'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
     'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
 where kind in ('pair', 'gym_pair') and target ~ '[Ａ-Ｚａ-ｚ０-９]';
