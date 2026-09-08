// 品牌圖示 (大師球外框)。**由 npm run logo:build 產生, 不要手改** ——
// 幾何的單一來源是 scripts/build-logo.node.mjs, 對外發佈的 SVG 檔在 public/logo/。
//
// 用 currentColor 而不是寫死顏色: 深色主題自己會跟著變, 呼叫端用 text-* 決定顏色。
// **簡化版**: 站上只有 20px, 全細節在那個尺寸會糊成一團 (M 與凸點併成一條黑帶)。
// 所以拿掉兩顆凸點與按鈕內圈, 線寬加到 14 (lucide 是 2/24 = 8.3%)。大 logo 維持全細節。

export function CoachBallMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={14}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="100" cy="100" r="84" />
      <path d="M16 100 H68" />
      <path d="M132 100 H184" />
      <path d="M79 63 V35 L100 53 L121 35 V63" strokeWidth={15} />
      <circle cx="100" cy="100" r="26" />
    </svg>
  );
}
