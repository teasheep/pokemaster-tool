// 「快進畫面了嗎」的判定 — 卡片重圖 (訓練家立繪/寶可夢圖) 延遲載入用。
//
// 為什麼要自己寫: SVG 的 <image> **不吃 loading="lazy"** (SVGImageElement 根本沒有這個屬性),
// 圖片標籤那套原生延遲載入在卡片上完全沒作用, 只能自己接 IntersectionObserver。
//
// 兩個效能地雷 (都是這個檔的存在理由):
//   1. **一個 root 共用一顆 observer**, 不是每張卡各自 new 一顆 — /pairs 一頁 645 張卡,
//      645 顆 observer 的成本會把省下來的圖吃回去。
//   2. 元素一進場就 unobserve 並從 WeakMap 移除 → 觀察清單只會變小, 不會愈滾愈重。

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefCallback } from "react";

/** 元素 → 進場時要跑的 callback (卡片的 setNear) */
const callbacks = new WeakMap<Element, () => void>();
/** viewport (root=null) 那顆, 全站共用一個 */
let viewportObserver: IntersectionObserver | null = null;
/** 每個捲動容器一顆; 用 WeakMap 不用 Map — 面板開一次就是一個新 root, 拿 Map 存會把
 *  已經拆掉的 DOM 連同 observer 一路留著 */
const rootObservers = new WeakMap<Element, IntersectionObserver>();

/** 預載邊界: 捲到距離 800px 就開始載, 使用者捲到時圖已經在了 (不會看到空卡再補圖) */
const ROOT_MARGIN = "800px 0px";

function getObserver(root: Element | null): IntersectionObserver | null {
  // 舊瀏覽器 / 測試環境沒有 IntersectionObserver → 交給呼叫端退回「一律載」
  if (typeof IntersectionObserver === "undefined") return null;
  const cached = root ? rootObservers.get(root) : viewportObserver;
  if (cached) return cached;
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        // 進場即退訂 — 圖只需要載一次, 之後這個元素跟 observer 再無關係
        obs.unobserve(e.target);
        const cb = callbacks.get(e.target);
        callbacks.delete(e.target);
        cb?.();
      }
    },
    { root, rootMargin: ROOT_MARGIN, threshold: 0 }
  );
  if (root) rootObservers.set(root, io);
  else viewportObserver = io;
  return io;
}

/**
 * 回傳 `[ref, near]`: ref 掛到要觀察的元素; near 在元素接近視窗時翻 true, **翻了就不會再變回**
 * (載過的圖不要因為捲出畫面又被拔掉)。
 *
 * root = 捲動容器, 不給就以 viewport 為準。**捲動框內一定要給** — rootMargin 只擴張 root
 * 自己的框, 祖先的 overflow 照樣裁切: root=viewport 時 PairPicker 那個 max-h-96 捲動框裡
 * 看不見的卡完全沒有預載邊界, 使用者捲一格才補一格 (pop-in)。給了 root 才有那 800px。
 */
export function useNearViewport<T extends Element>(
  root?: Element | null
): [RefCallback<T>, boolean] {
  const elRef = useRef<T | null>(null);
  const [near, setNear] = useState(false);

  // 穩定的 ref callback (每次渲染換一顆會讓 React 反覆 detach/attach)
  const ref = useCallback<RefCallback<T>>((el) => {
    elRef.current = el;
  }, []);

  // observer 一律在 effect 內建立 → SSR 不會執行, 首次渲染兩邊都是 near=false (無 hydration 落差)
  useEffect(() => {
    if (near) return;
    const el = elRef.current;
    const io = el ? getObserver(root ?? null) : null;
    if (!el || !io) {
      // 沒有元素或環境不支援 → 直接當作已進場, 行為退回「跟以前一樣立刻載」
      setNear(true);
      return;
    }
    callbacks.set(el, () => setNear(true));
    io.observe(el);
    return () => {
      callbacks.delete(el);
      io.unobserve(el);
    };
  }, [near, root]);

  return [ref, near];
}
