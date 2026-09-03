// 首頁的氛圍層 —— 散落在四周的拍組頭像 (2026-09-03, 使用者: 「完全看不出來跟遊戲有關」)。
//
// 為什麼是「散落 + 各自呼吸」而不是跑馬燈: 跑馬燈要讓內容寬過視窗才不會露出接縫,
// 一排就得塞二三十顆 (同一張圖重複貼) —— DOM 變重, 而且橫向流動會一直把視線從標題拉走。
// 定點擺放只放需要的顆數, 每顆用自己的 duration/delay 慢慢上下浮 (同步 = 像在閃),
// 視線不會被牽著跑, 但畫面不是死的。這就是「沉穩」要的量。
//
// 三個讓它不吵的設計:
//  1. **中間挖空**: 整層套一個橢圓 mask, 中央 (標題/CTA/看板所在) 完全透明, 只有邊緣看得到 ——
//     所以無論視窗多寬多窄, 頭像都不會壓在字上, 不必為每個斷點調位置。
//  2. **低透明度 + 淺色底盤**: 每顆是一個 card 底色的圓盤 (立繪去背後是方形頭像裁圓,
//     沒有底盤的話肩線會被切得很突兀)。
//  3. **入場錯開**: 進站時依序淡入 (rise-in), 淡完才接上呼吸 —— 一次全亮會像跳出來。
//
// 圖檔: 線上一律 .webp (AGENTS「線上的圖一律 .webp」), 路徑格式與 sync-pair-card 同一套
// (`/reference/{trainer,pokemon}/<id>_128.webp`)。**只能用已上市的拍組** —— 這一層是對外的,
// 未公布拍組的美術素材不能出現在這裡 (下面每一顆都對過 catalog 的 releaseDate)。
// 14 顆共約 68KB, 而且與 /pairs 共用同一批檔 (30 天快取), 逛過圖鑑的人是零成本。
// fetchPriority=low: 它只是氛圍, 不要跟 LCP (標題與 Google 按鈕) 搶頻寬。

// <img> 而不是 next/image (全站慣例, 同 candy.tsx / sync-pair-badges.tsx): 這些圖是資料管線
// 產好的 128px WebP, 由 Workers Assets 直送 (public/_headers 給 30 天快取), 尺寸與格式都已經定死,
// next/image 沒有東西可以再優化, 只會多一層 loader。
/* eslint-disable @next/next/no-img-element */

import { cn } from "@/lib/utils";

type Chip = {
  /** `/reference/` 底下的相對路徑 (不含副檔名) */
  src: string;
  /** 直徑 (px) */
  size: number;
  /** 位置 — 用百分比, 跟著 main 的尺寸縮放 */
  pos: React.CSSProperties;
  /** 呼吸一圈的秒數 (刻意都不同) */
  cycle: number;
  /** 小螢幕收掉 (手機的四周本來就沒有留白, 12 顆會變雜訊) */
  wide?: boolean;
};

const CHIPS: Chip[] = [
  // 左側
  { src: "trainer/ch0000_80_red", size: 56, pos: { left: "3%", top: "13%" }, cycle: 9 },
  { src: "pokemon/pm0025_00_pikachu", size: 40, pos: { left: "9%", top: "35%" }, cycle: 11, wide: true },
  { src: "trainer/ch0158_00_carnet", size: 68, pos: { left: "4%", top: "61%" }, cycle: 10 },
  { src: "pokemon/pm0384_00_rayquaza_rare", size: 44, pos: { left: "12%", top: "85%" }, cycle: 8, wide: true },
  // 右側
  { src: "pokemon/pm0150_00_mewtwo", size: 48, pos: { right: "4%", top: "11%" }, cycle: 12 },
  { src: "trainer/ch0127_00_mikuri", size: 64, pos: { right: "8%", top: "33%" }, cycle: 9, wide: true },
  { src: "pokemon/pm0448_00_lucario", size: 40, pos: { right: "3%", top: "59%" }, cycle: 13 },
  { src: "trainer/ch0245_00_mary", size: 56, pos: { right: "7%", top: "83%" }, cycle: 10, wide: true },
  // 上下兩條 (桌機才有足夠留白)
  { src: "trainer/ch0257_00_qibana", size: 44, pos: { left: "33%", top: "4%" }, cycle: 11, wide: true },
  { src: "pokemon/pm0133_00_eievui", size: 36, pos: { left: "59%", top: "6%" }, cycle: 9, wide: true },
  { src: "trainer/ch0114_00_natsume", size: 52, pos: { left: "27%", bottom: "5%" }, cycle: 12, wide: true },
  { src: "pokemon/pm0149_00_kairyu", size: 40, pos: { left: "63%", bottom: "8%" }, cycle: 10, wide: true },
];

/** 中間挖空 —— 字與看板所在的那塊完全透明, 邊緣才看得到頭像 */
const CENTER_MASK =
  "radial-gradient(ellipse 62% 54% at 50% 50%, transparent 42%, #000 100%)";

export function HomePairArt({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden",
        // **手機整層不渲染**: 中間挖空那招靠的是「四周有留白」, 而手機上內容本來就頂到左右兩邊,
        // 挖空區怎麼調都會壓到字。手機的遊戲感由看板每一列的拍組頭像扛 (那塊反而更清楚)。
        "hidden sm:block",
        // light 的底是暖米色, 圖蓋上去很跳 → 壓到 55%; dark 底本來就吃光, 再低一階
        "opacity-55 dark:opacity-35",
        className
      )}
      style={{ maskImage: CENTER_MASK, WebkitMaskImage: CENTER_MASK }}
    >
      {CHIPS.map((c, i) => (
        <span
          key={c.src}
          // 外層負責入場 (一次性), 內層負責呼吸 (無限) —— 兩個動畫不能疊在同一個元素上
          className={cn(
            "absolute animate-rise-in motion-reduce:animate-none",
            c.wide && "hidden sm:block"
          )}
          style={{ ...c.pos, animationDelay: `${120 + i * 70}ms` }}
        >
          <span
            className="block animate-float-y motion-reduce:animate-none"
            style={{ animationDuration: `${c.cycle}s`, animationDelay: `${i * 400}ms` }}
          >
            <img
              src={`/reference/${c.src}_128.webp`}
              alt=""
              width={c.size}
              height={c.size}
              draggable={false}
              // lazy 不只是「晚一點載」—— `hidden sm:block` 在手機上是 display:none,
              // 而 display:none 的 eager 圖 Chrome **照樣會下載** (12 張白花 65KB);
              // lazy 的圖沒有版面框就永遠不會進視窗, 手機因此一張都不抓。
              // 桌機這邊也順便讓它排在 LCP (標題與 Google 按鈕) 後面。
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              className="rounded-full bg-card object-cover ring-1 ring-border/60"
              style={{ width: c.size, height: c.size }}
            />
          </span>
        </span>
      ))}
    </div>
  );
}
