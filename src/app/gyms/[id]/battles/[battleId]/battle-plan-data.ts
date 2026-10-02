// 排刀表 (0083) 的資料列型別與查詢欄位 —— server 的 page.tsx 與 client 的 battle-plan.tsx 共用。
// ⚠ 這個檔**不可以標 "use client"**: page.tsx 要拿這裡的字串去 select, 從 use client 的檔案
//   import 到的是 client reference 不是字串, 整頁直接掛掉 (2026-10-02 踩過, 與 activity-filters 同一個坑)。

export type PlanFieldRow = { id: string; label: string; wide: boolean; sort_order: number };
export type PlanSlotRow = {
  field_id: string;
  stage_id: string | null;
  member_id: string | null;
  note: string | null;
};
export const PLAN_FIELD_COLS = "id, label, wide, sort_order";
export const PLAN_SLOT_COLS = "field_id, stage_id, member_id, note";
