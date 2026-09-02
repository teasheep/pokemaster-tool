// 拍組卡 <defs> 的唯一一份定義 — 在 root layout 的 <body> 內渲染一次, 全站卡片共用這些 id。
//
// 為什麼抽出來: 每張卡本來自己畫一份 defs (13 個節點), /pairs 一頁 645 張卡就是 8,385 個 DOM
// 節點, 但實際變化只有 10 種 (3 個 clip + 3 個外框漸層 + 4 個底色)。
//
// 跨 <svg> 引用為什麼安全 (改這裡前先確認這兩點還成立):
//   - 兩種 gradient 都沒寫 gradientUnits (預設 objectBoundingBox) 且座標全是百分比 → 跟著引用它
//     的圖形自己縮放, 與定義在哪個 svg 無關。
//   - clipPath 沒寫 clipPathUnits (預設 userSpaceOnUse), 而每張卡的 user space 都是同一個
//     viewBox 0 0 128 128 → 座標一致。
//
// 藏法用 position:absolute + width/height 0, **不要改成 display:none** — 部分瀏覽器會連帶讓
// 引用失效 (整批卡片瞬間沒有外框與裁切)。

// CARD_POLY 在 128×128 outer 座標系, 邊框均勻 ~14px (上方/左右)、底部 8px 並 chamfered
export const CARD_POLY = "14,14 114,14 114,100 104,120 24,120 14,100";

/** 太晶化用的正六邊形頂點 (以卡片上的寶可夢圈心 100,100 為中心, 半徑 r) */
export function hexPoints(r: number): string {
  return [0, 60, 120, 180, 240, 300]
    .map((a) => {
      const rad = (a * Math.PI) / 180;
      return `${(100 + r * Math.cos(rad)).toFixed(1)},${(100 + r * Math.sin(rad)).toFixed(1)}`;
    })
    .join(" ");
}

// 從遊戲內 frame asset (brybry data/item/Frame/) 抽出的精準 RGB
// 每色 4 個 stop 對應上/右/下/左, 用 linearGradient 模擬立體 bevel
//
// **外框只有 3 種 (3/4/5★)**: 卡片外框不因 6★EX 變化 (星星已經表達了), 所以這裡沒有、
// 也不要長出彩虹外框 — 卡片會挑 spc-frame-{3|4|5}, 6★EX 一樣吃金框。
const RARITY_GRADIENT: Record<number, [string, string, string, string]> = {
  3: ["#e8b593", "#d7a482", "#c46f4d", "#948383"], // 銅
  4: ["#c3c3c3", "#b5c6c6", "#8b8383", "#738484"], // 銀
  5: ["#eecc22", "#d7c64f", "#996611", "#848440"], // 金
};

// 角色背景底色 — 依「星數 (稀有度)」而非屬性 (對齊遊戲: 3★銅/4★銀/5★金/6★EX 彩虹淡光)。
// 每階 [中心亮, 邊緣稀有色] 做 radial glow; 6★EX 用淡彩虹 linear。
const RARITY_BG: Record<number, [string, string]> = {
  3: ["#f2dcc5", "#c98a5f"], // 銅
  4: ["#eef0f1", "#a8b2b5"], // 銀
  5: ["#f7e8ad", "#d2a738"], // 金
};
const RARITY_BG_EX: [string, string, string] = ["#ffe1ec", "#dfe6ff", "#e3f7e0"]; // 6★EX 淡彩虹

const RARITIES = [3, 4, 5] as const;

export function SyncPairDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {/* 卡片本體外形 (訓練家立繪被它裁切) */}
        <clipPath id="spc-clip-card">
          <polygon points={CARD_POLY} />
        </clipPath>
        {/* 寶可夢圖的裁切: 一般圓形 / 太晶六角。半徑 22 —
            卡面上那個看得見的六角 polygon 是半徑 24, 兩者不同, 不要對齊成同一個值 */}
        <clipPath id="spc-clip-poke-circle">
          <circle cx="100" cy="100" r="22" />
        </clipPath>
        <clipPath id="spc-clip-poke-hex">
          <polygon points={hexPoints(22)} />
        </clipPath>

        {/* 外框漸層: 4 stops 模擬遊戲內 bevel (top light → bottom dark) */}
        {RARITIES.map((r) => (
          <linearGradient key={r} id={`spc-frame-${r}`} x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor={RARITY_GRADIENT[r][0]} />
            <stop offset="35%" stopColor={RARITY_GRADIENT[r][1]} />
            <stop offset="70%" stopColor={RARITY_GRADIENT[r][2]} />
            <stop offset="100%" stopColor={RARITY_GRADIENT[r][3]} />
          </linearGradient>
        ))}

        {/* 角色背景底色 (依星數): 3-5★ radial glow */}
        {RARITIES.map((r) => (
          <radialGradient key={r} id={`spc-bg-${r}`} cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor={RARITY_BG[r][0]} />
            <stop offset="100%" stopColor={RARITY_BG[r][1]} />
          </radialGradient>
        ))}
        {/* 6★EX 淡彩虹 linear */}
        <linearGradient id="spc-bg-ex" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={RARITY_BG_EX[0]} />
          <stop offset="50%" stopColor={RARITY_BG_EX[1]} />
          <stop offset="100%" stopColor={RARITY_BG_EX[2]} />
        </linearGradient>
      </defs>
    </svg>
  );
}
