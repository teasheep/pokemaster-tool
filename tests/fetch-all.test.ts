// PostgREST 一次最多回 1000 列 —— `fetchAllRows` 是全站「讀全量」的唯一收口。
//
// 這支釘住的是**發了幾個請求**, 不只是「有沒有拿全」:
// 預設一批 3 頁是為了省一趟跨太平洋往返 (Worker 在 SJC、Supabase 在新加坡, 每趟 150-270ms),
// 那個交換在 server 端划算。但道館戰看板收到 realtime 事件時, **每一個開著看板的人**都會
// 重抓一次 —— 那裡多發的 2 個空請求要乘上人數, 所以它傳 `firstBatchPages: 1`。
//
// 紅了怎麼辦:
//   - 「預設批次不是 3」→ 有人改了 FIRST_BATCH_PAGES, 先確認 member_pairs 現在幾列
//     (2026-08 是 2055 = 3 頁剛好); 改小了就會退回多趟序列往返。
//   - 「firstBatchPages: 1 發了不只 1 個請求」→ 那個選項被弄丟了, 看板的查詢會變成 N×3。
//   - 「少拿列」→ 停止條件壞了 (只有「批尾那頁不滿 1000」才算讀完)。

import { describe, expect, it } from "vitest";

import { fetchAllRows } from "@/lib/supabase/fetch-all";

/** 造一個有 `total` 列的假資料表, 並記錄每次 range 查詢 */
function fakeTable(total: number) {
  const calls: Array<[number, number]> = [];
  const query = async (from: number, to: number) => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i });
    return { data: rows, error: null };
  };
  return { calls, query };
}

describe("fetchAllRows", () => {
  it("預設第一批平行發 3 頁 (省往返, 空頁不佔時間)", async () => {
    const t = fakeTable(120);
    const rows = await fetchAllRows(t.query);
    expect(rows).toHaveLength(120);
    expect(t.calls).toHaveLength(3);
    expect(t.calls.map(([from]) => from)).toEqual([0, 1000, 2000]);
  });

  it("firstBatchPages: 1 在資料沒破 1000 列時只發一個請求", async () => {
    const t = fakeTable(290); // 線上 battle_logs 目前的量級
    const rows = await fetchAllRows(t.query, { firstBatchPages: 1 });
    expect(rows).toHaveLength(290);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("firstBatchPages: 1 但資料破 1000 列時仍然抓得完 (不會靜默截斷)", async () => {
    const t = fakeTable(2500);
    const rows = await fetchAllRows(t.query, { firstBatchPages: 1 });
    expect(rows).toHaveLength(2500);
    // 第一頁滿 → 下一批加倍 (2 頁) → 批尾不滿就停
    expect(t.calls.map(([from]) => from)).toEqual([0, 1000, 2000]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
  });

  it("剛好 1000 列時要再問才停 (滿頁 = 可能還有, 不能就這樣收手)", async () => {
    const t = fakeTable(1000);
    const rows = await fetchAllRows(t.query, { firstBatchPages: 1 });
    expect(rows).toHaveLength(1000);
    // 第一頁滿 → 下一批**加倍成 2 頁**, 兩頁都空才確定到底 ⇒ 共 3 個請求。
    // 這正是「剛好 1000 列」最貴的情況; 一般情況 (<1000) 只要 1 個。
    expect(t.calls.map(([from]) => from)).toEqual([0, 1000, 2000]);
  });

  it("查詢出錯要丟出來, 不要默默回半套資料", async () => {
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: "boom" } }))
    ).rejects.toThrow("boom");
  });
});
