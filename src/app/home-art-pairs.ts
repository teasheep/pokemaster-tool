import type { CSSProperties } from "react";

/**
 * 首頁氛圍層要擺哪幾張**拍組卡**, 以及每張的位置、大小與「離鏡頭多遠」。
 *
 * 為什麼獨立成一個模組: server 與 client 兩邊都要用 —— `page.tsx` 依這裡的 pairId 去
 * catalog 撈真的紀錄, `home-pair-art.tsx` 依同一份設定擺位置。id 清單只能有一份。
 * (client 元件裡的常數不要讓 server 元件 import, 那條路在 RSC 邊界上很容易踩雷。)
 *
 * 選這七組的理由: 都是**已上市**的 (未公布的在 loadPairsForClient 就被濾掉, 撈不到就自動
 * 不畫, 不會外洩素材), 屬性/配色分散 (火/地面/妖精/鋼/電/水/超能) —— 一眼看過去是七張
 * 不同顏色的卡而不是同一批。與看板上那五組刻意不重複。
 *
 * **深度不用 translateZ 表達** (踩過): 共用一個 perspective 時, translateZ 會把元素往
 * 消失點 (畫面中央) 拉 —— 擺在 left:1.5% 的卡在 z=-560 會被拉到畫面中間去壓住文字,
 * 位置完全不受控。改成「每張卡自己一個 perspective + 自己轉」, 深度則由
 * scale / opacity / blur / 視差位移量 四件事表達, 位置就是你寫的那個位置。
 */
export type ArtSlot = {
  pairId: string;
  /** 位置 — 百分比, 跟著 main 的尺寸縮放。負值 = 故意讓卡切在畫面邊緣外 */
  pos: CSSProperties;
  size: "sm" | "md";
  /** 縮放 = 「離鏡頭多遠」的主要線索 */
  scale: number;
  opacity: number;
  /** 滑鼠移到邊緣時這張卡橫向位移幾 px —— **近的大、遠的小**, 視差就是這個差 */
  par: number;
  /** 滑鼠移到邊緣時這張卡轉幾度 (自己的 perspective, 所以是真的翻轉不是斜切) */
  deg: number;
  /** 靜止時的歪斜, 看起來像散落的卡而不是排好的格子 */
  tilt: number;
  /** 呼吸的振幅 (px) —— 一樣近的大遠的小 */
  float: number;
  /** 呼吸一圈的秒數 (刻意都不同, 同步 = 像在閃) */
  cycle: number;
  /** 最遠的那張加一點景深模糊 —— **會動的元素上的 filter 每幀都要重新光柵化**, 只留必要的 */
  blur?: boolean;
};

export const ART_SLOTS: ArtSlot[] = [
  // 左側 — 近 / 中 / 遠
  { pairId: "10000000000", pos: { left: "-2.5%", top: "9%" }, size: "md", scale: 1, opacity: 0.78, par: 48, deg: 13, tilt: -5, float: -20, cycle: 9, },
  { pairId: "10158000000", pos: { left: "0.5%", top: "47%" }, size: "md", scale: 0.78, opacity: 0.6, par: 26, deg: 8, tilt: 4, float: -14, cycle: 11 },
  { pairId: "10192000000", pos: { left: "15%", bottom: "5%" }, size: "sm", scale: 0.8, opacity: 0.42, par: 12, deg: 6, tilt: -3, float: -8, cycle: 13 },
  // 右側 — 近 / 中 / 遠
  { pairId: "10245000000", pos: { right: "-2.5%", top: "6%" }, size: "md", scale: 0.95, opacity: 0.74, par: 44, deg: 13, tilt: 5, float: -18, cycle: 10 },
  { pairId: "10127000000", pos: { right: "2%", top: "45%" }, size: "md", scale: 0.72, opacity: 0.56, par: 22, deg: 8, tilt: -4, float: -13, cycle: 12 },
  { pairId: "10257000000", pos: { right: "14%", bottom: "3%" }, size: "sm", scale: 0.76, opacity: 0.4, par: 10, deg: 6, tilt: 3, float: -8, cycle: 14 },
  // 下緣中間 — 最遠的一張, 給畫面一個底 (刻意切在視窗外一點)
  { pairId: "10114000000", pos: { left: "36%", bottom: "-3%" }, size: "sm", scale: 0.66, opacity: 0.34, par: 7, deg: 4, tilt: -6, float: -6, cycle: 15, blur: true },
];

export const ART_PAIR_IDS = ART_SLOTS.map((s) => s.pairId);
