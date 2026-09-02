// 純函式 math helpers — 從 embed-matcher 抽出來方便 unit test。
// 不要 import 任何 server-only 的東西, 這個檔可在測試環境直接 require。

const HB_DEFAULT = 5;

export function cos(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/**
 * RGB → 5x5x5 直方圖, L2 歸一化。
 * 排除接近全黑像素 (避免 alpha=0 區域稀釋色彩分佈)。
 */
export function histFromRGB(rgb: ArrayLike<number>, bins: number = HB_DEFAULT): Float32Array {
  const h = new Float32Array(bins * bins * bins);
  const st = 256 / bins;
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i]! < 6 && rgb[i + 1]! < 6 && rgb[i + 2]! < 6) continue;
    const r = Math.min(bins - 1, (rgb[i]! / st) | 0);
    const g = Math.min(bins - 1, (rgb[i + 1]! / st) | 0);
    const b = Math.min(bins - 1, (rgb[i + 2]! / st) | 0);
    h[r * bins * bins + g * bins + b]++;
  }
  let s = 0;
  for (const v of h) s += v * v;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < h.length; i++) h[i] /= n;
  return h;
}

/**
 * 從已解碼的整張 RGB raw buffer 裡, 純 JS 裁切出一塊子影像 (rebase 成 0,0 起點)。
 * 不經過 sharp / 不重新解碼; 像素完全等同於 sharp(orig).extract(同區域) 的結果。
 * 超出邊界的座標會被夾在 [0, W/H] 內 (回傳實際可裁切的寬高)。
 */
export function subImageRGB(
  full: ArrayLike<number>,
  fullWidth: number,
  fullHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
): { data: Uint8Array; width: number; height: number } {
  const x0 = Math.max(0, Math.min(fullWidth, Math.round(left)));
  const y0 = Math.max(0, Math.min(fullHeight, Math.round(top)));
  const x1 = Math.max(x0, Math.min(fullWidth, x0 + Math.round(width)));
  const y1 = Math.max(y0, Math.min(fullHeight, y0 + Math.round(height)));
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 3);
  for (let yy = 0; yy < h; yy++) {
    let srcOff = ((y0 + yy) * fullWidth + x0) * 3;
    let dstOff = yy * w * 3;
    for (let k = 0; k < w * 3; k++) out[dstOff++] = full[srcOff++]!;
  }
  return { data: out, width: w, height: h };
}

/**
 * 在 RGB raw buffer 中對一個小矩形視窗求各通道平均值 (回傳 [r,g,b], 0 像素時 n=0)。
 * 供取樣型偵測 (邊框 rarity / 主屬性) 用; 視窗超出影像邊界回傳 null (對齊舊版 try/catch 略過)。
 */
export function avgRGBWindow(
  full: ArrayLike<number>,
  fullWidth: number,
  fullHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
): { r: number; g: number; b: number; n: number } | null {
  const x0 = Math.round(left);
  const y0 = Math.round(top);
  // 視窗任一邊超出影像 → 對齊舊版 sharp.extract 會丟例外被 catch 略過
  if (x0 < 0 || y0 < 0 || x0 + width > fullWidth || y0 + height > fullHeight) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = 0; yy < height; yy++) {
    let o = ((y0 + yy) * fullWidth + (x0 + 0)) * 3;
    for (let xx = 0; xx < width; xx++) {
      r += full[o]!; g += full[o + 1]!; b += full[o + 2]!; o += 3; n++;
    }
  }
  return { r, g, b, n };
}

/**
 * 無排序 bounded top-K: 回傳分數最大的 k 個元素 (順序不保證, 由 caller 視需要再排)。
 * O(n·k) — k 很小時 (本專案 k=55) 比 full sort O(n log n) 省。
 */
export function topK<T>(items: readonly T[], k: number, score: (x: T) => number): T[] {
  if (k >= items.length) return items.slice();
  if (k <= 0) return [];
  // 用簡單的「維護目前最小門檻」陣列; k 小時效率足夠且不需額外 heap 依賴。
  const sel: { v: T; s: number }[] = [];
  let minIdx = -1; // sel 中分數最小者的索引
  for (let i = 0; i < items.length; i++) {
    const s = score(items[i]!);
    if (sel.length < k) {
      sel.push({ v: items[i]!, s });
      if (sel.length === k) {
        minIdx = 0;
        for (let j = 1; j < k; j++) if (sel[j]!.s < sel[minIdx]!.s) minIdx = j;
      }
    } else if (s > sel[minIdx]!.s) {
      sel[minIdx] = { v: items[i]!, s };
      // 重新找最小門檻
      minIdx = 0;
      for (let j = 1; j < k; j++) if (sel[j]!.s < sel[minIdx]!.s) minIdx = j;
    }
  }
  return sel.map((e) => e.v);
}

/**
 * 按併發上限執行 async 函式 (避免一次配 N 個 inference 把記憶體/GPU 吃光)。
 * 維持輸入順序傳給 fn 的第二個參數 (`originalIndex`)。
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, originalIndex: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}
