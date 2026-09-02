// 自動偵測 Pokemon Masters 拍組組合畫面的 5x4 grid
//
// 演算法 (brightness-based):
//   1. ROI 內掃描像素, 標記亮 pixel (avg RGB > 200) — 卡片之間的青色背景很亮
//   2. 計算每 row/col 的亮 pixel 比例
//   3. 比例 > 65% 且長度 > 1% 的連續區段 = 卡片間的 gap
//   4. 取最長的 (rows+1) 個 row gaps + (cols+1) 個 col gaps
//   5. cell.top = rowGap[r].end, cell.bottom = rowGap[r+1].start

import "server-only";

import sharp from "sharp";

export type DetectedCell = {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectResult = {
  ok: boolean;
  cells: DetectedCell[];
  reason?: string;
};

const BRIGHTNESS_THRESHOLD = 200;
const GAP_RATIO_THRESHOLD = 0.65;

export async function detectGrid(
  imageBuffer: Buffer,
  opts: {
    cols?: number;
    rows?: number;
    roiTopRatio?: number;
    roiBottomRatio?: number;
  } = {}
): Promise<DetectResult> {
  const cols = opts.cols ?? 4;
  const rows = opts.rows ?? 5;
  const roiTopRatio = opts.roiTopRatio ?? 0.32;
  const roiBottomRatio = opts.roiBottomRatio ?? 0.92;

  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return fail("無法讀取截圖大小");

  const roiTopPx = Math.round(H * roiTopRatio);
  const roiBottomPx = Math.round(H * roiBottomRatio);

  const { data, info } = await sharp(imageBuffer)
    .extract({ left: 0, top: roiTopPx, width: W, height: roiBottomPx - roiTopPx })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // row/col 亮點計數: 在同一個 row-major pass 累計
  // (舊版先建 isBright mask, 再用一個 strided column-major 迴圈算 colProj, cache 不友善;
  //  合併後一次掃完, 且不再需要保留整張 mask)。
  const rowCount = new Float32Array(h);
  const colCount = new Float32Array(w);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 3) {
      const avg = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (avg > BRIGHTNESS_THRESHOLD) {
        rowCount[y]!++;
        colCount[x]!++;
      }
    }
  }

  const rowProj = new Float32Array(h);
  for (let y = 0; y < h; y++) rowProj[y] = rowCount[y]! / w;
  const colProj = new Float32Array(w);
  for (let x = 0; x < w; x++) colProj[x] = colCount[x]! / h;

  const minRowLen = Math.max(8, Math.round(h * 0.01));
  const minColLen = Math.max(8, Math.round(w * 0.01));
  const rowRuns = findRuns(rowProj, GAP_RATIO_THRESHOLD, minRowLen);
  const colRuns = findRuns(colProj, GAP_RATIO_THRESHOLD, minColLen);

  if (rowRuns.length < rows + 1) {
    return fail(
      `gap detection: 預期至少 ${rows + 1} 個 row gaps, 實際 ${rowRuns.length}`
    );
  }
  if (colRuns.length < cols + 1) {
    return fail(
      `gap detection: 預期至少 ${cols + 1} 個 col gaps, 實際 ${colRuns.length}`
    );
  }

  // 取最長的 N+1 個 gaps 並重新排序
  const useRowRuns = topByLength(rowRuns, rows + 1);
  const useColRuns = topByLength(colRuns, cols + 1);

  const cells: DetectedCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const yTop = useRowRuns[r]!.end;
      const yBot = useRowRuns[r + 1]!.start;
      const xLeft = useColRuns[c]!.end;
      const xRight = useColRuns[c + 1]!.start;
      cells.push({
        index: r * cols + c,
        row: r,
        col: c,
        x: Math.round(xLeft),
        y: Math.round(roiTopPx + yTop),
        width: Math.round(xRight - xLeft),
        height: Math.round(yBot - yTop),
      });
    }
  }

  return { ok: true, cells };

  function fail(reason: string): DetectResult {
    return { ok: false, cells: [], reason };
  }
}

type Run = { start: number; end: number };

function findRuns(
  projection: Float32Array,
  threshold: number,
  minLen: number
): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < projection.length; i++) {
    if (projection[i]! > threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0 && projection.length - start >= minLen) {
    runs.push({ start, end: projection.length - 1 });
  }
  return runs;
}

function topByLength(runs: Run[], n: number): Run[] {
  return runs
    .slice()
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, n)
    .sort((a, b) => a.start - b.start);
}
