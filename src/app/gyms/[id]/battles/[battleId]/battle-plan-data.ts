// 排刀表 (0083)、它的分頁 (0087/0088) 與關卡的必要拍組 (0089) 的資料列型別與查詢欄位 ——
// server 的 page.tsx 與 client 的 battle-plan.tsx / stage-board.tsx / battle-client.tsx 共用。
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

/** 畫面用的排刀表: 欄位 → 每關的格子 (格子的 key 是關卡 id, 全場那一格是 PLAN_WIDE) */
export type PlanCell = { members: string[]; text: string };
export type PlanRow = {
  id: string;
  label: string;
  wide: boolean;
  cells: Record<string, PlanCell>;
};
export type PlanDoc = { rows: PlanRow[]; note: string };
/** 整場一格的列, cells 只用這個 key */
export const PLAN_WIDE = "all";

/**
 * 排刀表的分頁 (0087 建表, 0088 改成全館看得到): 一份一列, 整份內容 (= PlanDoc) 存在 plan 那一欄。
 * 全館讀得到; 只有建立的人 (user_id) 改得動, 建立的人或管理員刪得掉。正式那張 (0083) 完全不碰。
 * (表名還叫 drafts 是 0087「試排」留下來的, 畫面上叫「分頁」。)
 */
export type PlanDraftRow = {
  id: string;
  user_id: string;
  name: string;
  plan: PlanDoc;
  created_at: string;
};
export const PLAN_DRAFT_COLS = "id, user_id, name, plan, created_at";
/**
 * 排刀表的預設欄位: 與 0083 的 on_battle_created_plan 同一份 (新賽事的正式那張長這樣, tests 釘住兩邊一致)。
 * ＋ 分頁也是這個長相 (2026-11-08 使用者:「不要 我要新開的就是預設的長相」) ——
 * 正在看的那張多加的欄位、改過的欄位名都不帶過去。
 */
export const PLAN_DEFAULT_FIELDS = [
  { label: "物攻", wide: false },
  { label: "特攻", wide: false },
  { label: "降抗", wide: true },
] as const;
/** 預設長相的一張空白排刀表 (欄位 id 每張自己一份) */
export function blankPlanDoc(): PlanDoc {
  return {
    rows: PLAN_DEFAULT_FIELDS.map((f) => ({
      id: crypto.randomUUID(),
      label: f.label,
      wide: f.wide,
      cells: {},
    })),
    note: "",
  };
}
/** 一個人在一場最多開幾個分頁 (畫面上的上限; 夠用就好, 全館加起來不讓切換列長成一大排) */
export const MAX_PLAN_DRAFTS = 5;

/**
 * 關卡的必要拍組 (0089): 一關挑幾組拍組, 排刀側板可以切過去看「每個人那幾隻幾寶」。
 * 看板 (stage-board) 與排刀表 (battle-plan) 讀同一份, 欄位清單 page.tsx 與 battle-client 的重抓共用。
 */
export type StageRequiredPairRow = { stage_id: string; pair_id: string; min_grade: number };
/** min_grade 是 0090 才有的欄位 —— 部署順序一律「先套 0090 再上前端」(明列欄位在 migration 沒套時會 400) */
export const STAGE_REQUIRED_PAIR_COLS = "stage_id, pair_id, min_grade";
/** 一關最多幾組 (畫面上的上限: 要的是「共用的那幾隻」, 多到十幾組就跟屬性拍組沒兩樣了) */
export const MAX_STAGE_REQUIRED_PAIRS = 10;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * jsonb → PlanDoc。資料庫裡的形狀不保證 (手改、舊版本、半寫入), 讀不懂的部分丟掉,
 * 不要讓整塊排刀表因為一格壞資料畫不出來。
 */
export function normalizePlanDoc(raw: unknown): PlanDoc {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows: PlanRow[] = [];
  for (const r of Array.isArray(o.rows) ? o.rows : []) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) continue;
    const cells: Record<string, PlanCell> = {};
    const rawCells = row.cells && typeof row.cells === "object" ? (row.cells as Record<string, unknown>) : {};
    for (const [k, c] of Object.entries(rawCells)) {
      if (!c || typeof c !== "object") continue;
      const cell = c as Record<string, unknown>;
      const members = Array.isArray(cell.members)
        ? [...new Set(cell.members.filter((m): m is string => typeof m === "string"))]
        : [];
      const text = str(cell.text, 60);
      if (members.length || text) cells[k] = { members, text };
    }
    rows.push({ id: row.id, label: str(row.label, 20), wide: row.wide === true, cells });
  }
  return { rows, note: str(o.note, 2000) };
}

export function normalizeDraftRow(raw: {
  id: string;
  user_id: string;
  name: string | null;
  plan: unknown;
  created_at: string;
}): PlanDraftRow {
  return {
    id: raw.id,
    user_id: raw.user_id,
    name: raw.name ?? "",
    plan: normalizePlanDoc(raw.plan),
    created_at: raw.created_at,
  };
}
