// 教學卡片的擺放計算 — 純函式, 不碰 DOM (tests/tour.test.ts 釘住)。
//
// 手機與桌機共用同一條路徑: 差別只在卡片寬度 (手機吃滿螢幕) 與底部要不要
// 讓開底部導覽列。方向的挑法一律是「先下、再上、都放不下就挑空間大的那邊貼邊」——
// 不要為手機再分一套規則, 兩套規則遲早會各走各的。

export type Rect = { top: number; left: number; width: number; height: number };

/** 卡片最寬 380px; 手機是 螢幕寬 - 兩側各 8px */
export const CALLOUT_MAX_W = 380;
/** 目標與卡片之間留的距離 */
export const GAP = 12;
/** 距離視窗邊緣 */
export const EDGE = 8;

export type Placement = { top: number; left: number; width: number };

export function calloutWidth(viewportWidth: number): number {
  return Math.min(CALLOUT_MAX_W, viewportWidth - EDGE * 2);
}

/**
 * 目標不存在 (那一頁還沒有那個東西) 時卡片置中 —— 這是刻意的降級:
 * 教學內容照樣看得完, 只是沒有東西可以框。步驟不會因此卡住。
 */
export function centerPlacement(
  viewport: { width: number; height: number },
  cardHeight: number
): Placement {
  const width = calloutWidth(viewport.width);
  return {
    width,
    left: Math.round((viewport.width - width) / 2),
    top: Math.max(EDGE, Math.round((viewport.height - cardHeight) / 2)),
  };
}

export function placeCallout({
  target,
  viewport,
  cardHeight,
  bottomInset = 0,
}: {
  target: Rect | null;
  viewport: { width: number; height: number };
  cardHeight: number;
  /** 底部被固定元素佔掉的高度 (手機的底部導覽列 + 安全區) */
  bottomInset?: number;
}): Placement {
  if (!target) return centerPlacement(viewport, cardHeight);

  const width = calloutWidth(viewport.width);
  const bottomLimit = viewport.height - bottomInset - EDGE;

  const below = target.top + target.height + GAP;
  const aboveTop = target.top - GAP - cardHeight;

  let top: number;
  if (below + cardHeight <= bottomLimit) {
    top = below;
  } else if (aboveTop >= EDGE) {
    top = aboveTop;
  } else {
    // 上下都塞不下 (目標很大或視窗很矮): 挑空間多的那一邊貼著邊放
    const roomAbove = target.top - EDGE;
    const roomBelow = bottomLimit - (target.top + target.height);
    top = roomAbove > roomBelow ? EDGE : Math.max(EDGE, bottomLimit - cardHeight);
  }

  // 水平: 對齊目標中心, 再夾回視窗內 (手機因為卡片幾乎滿寬, 夾完一定是 EDGE)
  const centered = target.left + target.width / 2 - width / 2;
  const left = Math.min(Math.max(centered, EDGE), Math.max(EDGE, viewport.width - width - EDGE));

  return { top: Math.round(top), left: Math.round(left), width };
}

/**
 * 只框卡片的左下角 (「點左下角 = 寶數循環」那一步)。
 * 卡片是正方形而且在容器最上方 (卡名在下面), 所以用容器的**寬度**推卡片底緣 ——
 * 直接用 rect.height 會把卡名那兩行也算進去, 框就會掉到名字上。
 */
export function cornerRect(rect: Rect, size = 44): Rect {
  const cardBottom = rect.top + rect.width;
  return {
    left: rect.left - 2,
    top: cardBottom - size + 2,
    width: size,
    height: size,
  };
}
