// PostgREST 一次最多回 1000 列 — 讀「全量」一律走這裡分頁。
// 忘記分頁的症狀: 拿到「剛好 1000 列」, 排刀/持有率默默少算 (前科: 格鬥物攻隊
// 把全符合的成員判成吃糖可打, 因為他的列落在第 1000 列之後)。
//
// 分頁「一定要有」, 但不必「一頁等一頁」: Worker 在 SJC、Supabase 在新加坡,
// 每一趟往返 150-270ms, 而 member_pairs 現在 2055 列 = 3 頁 = 3 趟序列往返。
// 這裡改成一批平行發, 只有「這批最後一頁還是滿的」才發下一批。

/** PostgREST 單次回傳上限 (Supabase 預設 db-max-rows = 1000) */
const PAGE_SIZE = 1000;

/**
 * 第一批就發 3 頁 = 3000 列。全站最大的 member_pairs 目前 2055 列 (2026-08 實測),
 * 一批就抓完 → 1 趟往返, 而且 3 頁都有用到, 一個請求都沒浪費。
 * 小表 (gym_pairs 144 列) 會多發 2 個回空陣列的請求 — 超出範圍的 range 在 PostgREST
 * 是 200 + 空陣列 (實測 range 3000-3999 → 200, 0 列), 不是 416, 所以安全;
 * 而且它們是平行發的, 不佔額外時間。用 2 個空請求換掉一趟跨太平洋往返, 划算。
 */
const FIRST_BATCH_PAGES = 3;

/** 之後每批加倍, 但不要無限膨脹 (Workers 有 subrequest 上限) */
const MAX_BATCH_PAGES = 8;

type PageQuery<T> = (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * 分頁把整張表讀完 (一批平行, 批與批之間才等)。
 *
 * 競態 (讀的當下有人在寫) 怎麼處理:
 *
 * 1. **不用 count**。先 count 再平行發 range 會有「count 與資料對不上」的窗口
 *    (中間有人新增就少拿一列, 持有率算錯), 而且 count=exact 在 Postgres 是整表掃描,
 *    還要多一趟序列往返才拿得到。這裡完全不問總數, 只靠「這一頁滿不滿」判斷 ——
 *    沒有 count 就沒有 count 的競態, 停止條件跟舊版逐頁 await 的版本一模一樣。
 * 2. **窗口反而變小**。舊版三頁之間隔了兩趟往返 (~400ms), 中間的寫入會讓 offset 位移;
 *    現在同一批是同時發出的 (差幾毫秒), 錯開的機會比原本更低。
 * 3. **不會提早收手**。表在讀的過程中變大時, 只要批尾那頁是滿的就繼續發下一批,
 *    所以「邊讀邊長」最多是多拿到新列, 不會漏掉舊列。
 * 4. offset 分頁本身的老問題還在, 但變輕: 呼叫端沒有 `.order()`, 所以讀取期間的
 *    INSERT/UPDATE 會讓列順序位移, 邊界有機會重複或漏 (重複會讓持有人數多算一個)。
 *    這在舊版逐頁 await 時一樣會發生, 而且窗口大上百倍。要根治得由呼叫端補一個穩定
 *    排序 (例如 `.order("id")`) —— 那是呼叫端的事, 不在這支。
 */
export async function fetchAllRows<T>(query: PageQuery<T>): Promise<T[]> {
  const out: T[] = [];
  let nextPage = 0;
  let batchPages = FIRST_BATCH_PAGES;

  for (;;) {
    const pages = await Promise.all(
      Array.from({ length: batchPages }, async (_, i) => {
        const from = (nextPage + i) * PAGE_SIZE;
        const { data, error } = await query(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        return data ?? [];
      })
    );

    // 整批都收下 (已經拿到手了, 丟掉才會少算), 順序仍照 offset
    for (const rows of pages) out.push(...rows);

    // 停止條件與舊版同一條 (「有一頁不滿 1000 就沒有下一頁了」), 只是改在批尾判斷:
    // 批尾不滿 = 這批已經摸到表尾。批尾是滿的才可能還有, 繼續發下一批。
    if (pages[pages.length - 1].length < PAGE_SIZE) break;

    nextPage += batchPages;
    batchPages = Math.min(batchPages * 2, MAX_BATCH_PAGES);
  }

  return out;
}
