import { pairName } from "@/lib/pairs/name";
import type { ClientPairRecord } from "@/lib/pairs/types";

/**
 * 首頁拍組看板列的那幾組 —— **catalog 裡最新上架的五組 5★** (2026-09-03 使用者指定),
 * 持有人數隨機 (使用者:「持有的數字就隨機就可以了」)。
 *
 * 為什麼首頁不寫死拍組: 寫死的話每次改版都要有人記得回來換, 而且遲早會變成一份過期名單。
 * 直接吃 catalog 就自己跟著更新了。
 *
 * 為什麼是獨立模組而不是寫在 page.tsx 裡:
 *  - 型別與 `HOME_GYM_MEMBERS` 兩邊都要用 (server 的 page.tsx 與 client 的看板),
 *    放在純模組兩邊都 import 得到, 不用讓 server 元件去 import client 模組的常數。
 *  - 擲骰子留在 render 裡會被 `react-hooks/purity` 擋下 —— 那條規則是對的
 *    (元件重繪時值會亂跳), 只是**這裡的呼叫端是 server 元件**: 一個請求只跑一次,
 *    結果隨 RSC payload 一起送到瀏覽器, SSR 與 hydration 看到的是同一組數字。
 *    真正不能做的是在 client 元件裡擲 —— 那才會 SSR 對不起來。
 */

/** 示範道館的人數 */
export const HOME_GYM_MEMBERS = 20;

/** 看板列幾組 */
const BOARD_ROWS = 5;

/**
 * 只收 5★ (2026-09-03 使用者:「最新的 5 星拍組, 4 星的就先放一放」)。
 *
 * 每一波改版通常 5★ 與 4★ 一起上, 不濾的話首頁一半是 4★ —— 而道館戰在乎的、
 * 大家會去抽的、值得放到門面上的都是 5★。星級一律看 `basePotential` (原始星級,
 * AGENTS「圖鑑星級一律 basePotential」) 而不是個人升到幾星。
 * 寫 `>=` 而不是 `===`: 之後遊戲真的長出更高的原始星級時不用回來改這裡。
 */
const MIN_BASE_POTENTIAL = 5;

/**
 * 每一列「20 人中幾人有」的擲骰區間, 由新到舊。
 *
 * 使用者說數字隨機就好, 但**完全均勻的隨機會擲出五條差不多長的條**, 看不出這是個持有率看板。
 * 照名次分區間 → 越新的越少人有 (真實道館就是這樣), 長條的顏色也一定會有層次
 * (灰/黃 → 藍 → 綠, 門檻見看板的 toneOf)。
 */
const OWNER_BANDS: readonly (readonly [number, number])[] = [
  [0, 3],
  [2, 7],
  [5, 12],
  [9, 16],
  [14, HOME_GYM_MEMBERS],
];

/** 一列 = 一組拍組 + 全館幾個人有 */
export type HomePairRow = {
  pairId: string;
  /** pairName() 產的「人名 & 寶可夢名」 */
  name: string;
  trainerId: string;
  pokemonId: string;
  owners: number;
};

/**
 * 從 catalog 挑最新上架的幾組, 配上隨機的持有人數。
 *
 * 傳進來的一定要是 `loadPairsForClient()` 的結果 —— 它是所有對外輸出的唯一收口,
 * 「還沒公布」的那批在那裡就被濾掉了, 絕對不會冒到首頁上 (AGENTS.md「還不能對外送的拍組」)。
 */
export function pickLatestPairRows(catalog: ClientPairRecord[]): HomePairRow[] {
  return catalog
    .filter((p) => p.releaseDate && p.basePotential >= MIN_BASE_POTENTIAL)
    // pairId 當決勝鍵: 同一天上架好幾組時排序才是穩定的
    .sort((a, b) => b.releaseDate!.localeCompare(a.releaseDate!) || b.pairId.localeCompare(a.pairId))
    .slice(0, BOARD_ROWS)
    .map((p, i) => {
      const [lo, hi] = OWNER_BANDS[i] ?? OWNER_BANDS[OWNER_BANDS.length - 1];
      return {
        pairId: p.pairId,
        name: pairName(p),
        trainerId: p.trainerId,
        pokemonId: p.pokemonId,
        owners: lo + Math.floor(Math.random() * (hi - lo + 1)),
      };
    });
}
