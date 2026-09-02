import { describe, expect, it } from "vitest";

import { avgRGBWindow, cos, histFromRGB, l2Normalize, mapWithConcurrency, subImageRGB, topK } from "./_math";

describe("cos", () => {
  it("returns dot product of two equal-length arrays", () => {
    expect(cos([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cos([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cos([1, 1], [1, 1])).toBeCloseTo(2);
  });

  it("works on Float32Array", () => {
    const a = Float32Array.of(0.6, 0.8);
    const b = Float32Array.of(0.6, 0.8);
    expect(cos(a, b)).toBeCloseTo(0.6 * 0.6 + 0.8 * 0.8);
  });
});

describe("l2Normalize", () => {
  it("scales vector to unit length", () => {
    const v = Float32Array.of(3, 4);
    l2Normalize(v);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1);
  });

  it("leaves zero vector unchanged (no div-by-zero)", () => {
    const v = new Float32Array(4);
    l2Normalize(v);
    for (const x of v) expect(x).toBe(0);
  });
});

describe("histFromRGB", () => {
  it("ignores near-black pixels (alpha=0 regions)", () => {
    // 全 0 (黑) → 應該全部跳過, 結果是 0 向量 (normalize 後仍 0)
    const black = new Uint8Array(30); // 10 pixels × 3
    const h = histFromRGB(black);
    for (const v of h) expect(v).toBe(0);
  });

  it("clusters a uniform red into one bin (L2 normalized)", () => {
    // 100 個 (255, 0, 0) 純紅像素 → 全進同一個 bin → 歸一化後該 bin = 1
    const rgb = new Uint8Array(300);
    for (let i = 0; i < 100; i++) rgb[i * 3] = 255;
    const h = histFromRGB(rgb);
    const peakIdx = h.indexOf(Math.max(...h));
    expect(h[peakIdx]).toBeCloseTo(1);
    // 其他 bin 應該全為 0
    let nonZero = 0;
    for (const v of h) if (v > 0.01) nonZero++;
    expect(nonZero).toBe(1);
  });

  it("two complementary colors are orthogonal (cos = 0)", () => {
    const red = new Uint8Array(300);
    for (let i = 0; i < 100; i++) red[i * 3] = 255;
    const green = new Uint8Array(300);
    for (let i = 0; i < 100; i++) green[i * 3 + 1] = 255;
    expect(cos(histFromRGB(red), histFromRGB(green))).toBeCloseTo(0);
  });
});

describe("subImageRGB", () => {
  // 3x2 影像 (寬3 高2), 每 pixel = (idx, idx, idx) 方便辨識
  function mk(w: number, h: number): Uint8Array {
    const d = new Uint8Array(w * h * 3);
    for (let p = 0; p < w * h; p++) { d[p * 3] = p; d[p * 3 + 1] = p; d[p * 3 + 2] = p; }
    return d;
  }
  it("crops an interior region and rebases to 0,0", () => {
    const full = mk(3, 2); // pixels 0..5 row-major
    const { data, width, height } = subImageRGB(full, 3, 2, 1, 0, 2, 2);
    expect(width).toBe(2);
    expect(height).toBe(2);
    // 取 col1..2 of both rows → 原 idx [1,2, 4,5]
    expect([data[0], data[3], data[6], data[9]]).toEqual([1, 2, 4, 5]);
  });

  it("clamps out-of-bounds crop to available pixels", () => {
    const full = mk(3, 2);
    const { width, height } = subImageRGB(full, 3, 2, 2, 1, 5, 5);
    expect(width).toBe(1); // 只剩最後一欄
    expect(height).toBe(1); // 只剩最後一列
  });

  it("returns empty when fully out of bounds", () => {
    const full = mk(3, 2);
    const r = subImageRGB(full, 3, 2, 10, 10, 4, 4);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    expect(r.data.length).toBe(0);
  });
});

describe("avgRGBWindow", () => {
  function mk(w: number, h: number): Uint8Array {
    const d = new Uint8Array(w * h * 3);
    for (let p = 0; p < w * h; p++) { d[p * 3] = 10; d[p * 3 + 1] = 20; d[p * 3 + 2] = 30; }
    return d;
  }
  it("sums RGB over an in-bounds window", () => {
    const full = mk(4, 4);
    const acc = avgRGBWindow(full, 4, 4, 1, 1, 2, 2);
    expect(acc).not.toBeNull();
    expect(acc!.n).toBe(4);
    expect(acc!.r).toBe(40); // 4 px × 10
    expect(acc!.g).toBe(80);
    expect(acc!.b).toBe(120);
  });
  it("returns null when window exceeds bounds (matches old sharp throw→skip)", () => {
    const full = mk(4, 4);
    expect(avgRGBWindow(full, 4, 4, 3, 0, 4, 4)).toBeNull(); // 3+4 > 4
    expect(avgRGBWindow(full, 4, 4, 0, 3, 4, 4)).toBeNull();
    expect(avgRGBWindow(full, 4, 4, -1, 0, 2, 2)).toBeNull();
  });
});

describe("topK", () => {
  it("selects the k highest-scoring items (order-independent set)", () => {
    const items = [3, 1, 4, 1, 5, 9, 2, 6];
    const sel = topK(items, 3, (x) => x).sort((a, b) => a - b);
    expect(sel).toEqual([5, 6, 9]);
  });
  it("returns all items (copy) when k >= length", () => {
    const items = [2, 7, 1];
    const sel = topK(items, 10, (x) => x);
    expect(sel.slice().sort((a, b) => a - b)).toEqual([1, 2, 7]);
    expect(sel).not.toBe(items); // copy, 非同一參照
  });
  it("returns empty for k<=0", () => {
    expect(topK([1, 2, 3], 0, (x) => x)).toEqual([]);
  });
  it("matches sort+slice membership on a random array", () => {
    const items = Array.from({ length: 200 }, () => Math.random());
    const k = 55;
    const fromSort = new Set(items.slice().sort((a, b) => b - a).slice(0, k));
    const fromTopK = new Set(topK(items, k, (x) => x));
    expect(fromTopK.size).toBe(k);
    for (const v of fromTopK) expect(fromSort.has(v)).toBe(true);
  });
});

describe("mapWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const seen: number[] = [];
    await mapWithConcurrency(items, 3, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("preserves original index for ordered output", async () => {
    const items = ["a", "b", "c", "d"];
    const out: string[] = [];
    await mapWithConcurrency(items, 2, async (s, i) => {
      // 故意倒序完成: 偶數 index 等更久
      await new Promise((r) => setTimeout(r, i % 2 === 0 ? 10 : 0));
      out[i] = s.toUpperCase();
    });
    expect(out).toEqual(["A", "B", "C", "D"]);
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input cleanly", async () => {
    await expect(mapWithConcurrency([], 4, async () => {})).resolves.toBeUndefined();
  });
});
