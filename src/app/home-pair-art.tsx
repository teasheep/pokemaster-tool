"use client";

// 首頁的氛圍層 —— 幾張**真的拍組卡**浮在一個有景深的空間裡, 而且跟著滑鼠微微轉。
// (2026-09-03, 使用者:「完全看不出來跟遊戲有關」→「用拍組組起來那個圖, 不要把人跟寶可夢分開」
//  →「可以有個氛圍感的 3D 微微跟著滑鼠動的那種空間感」)
//
// 畫的就是 `SyncPairCard` 本人 —— 站內 /pairs 那一牆卡片同一個元件、同一份 catalog 紀錄。
// 不是另外拼一張示意圖: 訓練家、寶可夢、外框、星星本來就是**一張卡**, 拆開擺才奇怪。
//
// 空間感由三件事疊出來 (少一件就會變回「貼了幾張圖」):
//  1. **靜態的遠近**: 每張卡自己的 scale / opacity / blur (見 home-art-pairs.ts)。
//  2. **跟著滑鼠的視差**: 指標位置寫進 CSS 變數 `--mx/--my` (-1…1), 每張卡用自己的
//     `par`(位移 px) 與 `deg`(旋轉度) 換算 —— **近的位移大、遠的小**, 那個差就是空間感。
//     旋轉走每張卡自己的 `perspective()`, 所以是真的翻轉不是斜切。
//  3. **各自呼吸**: 每張卡自己的 float-y (振幅/週期/相位都不同)。滑鼠不動時畫面也還活著。
//
// **深度刻意不用 translateZ** (踩過): 共用 perspective 時 translateZ 會把元素往消失點
// (畫面中央) 拉, 擺在 left:1.5% 的卡在 z=-560 會被拉到中間壓住文字, 位置完全不受控。
// 現在每張卡各自 perspective, 寫哪就在哪。
//
// 追指標用 rAF + lerp (每幀補 6%) 而不是直接跟 —— 直接跟很躁, 這裡要的是慢半拍地飄。
// 追到位就**停掉 rAF**, 不留一個永遠在跑的迴圈吃電; 指標再動時 onMove 會重新點火。
//
// 只在 md 以上**掛載** (不是 CSS 隱藏): 手機四周沒有留白, 中央挖空那招怎麼調都會壓到字;
// 而且沒掛載就一張圖都不會下載 (display:none 的圖瀏覽器照樣抓)。
// 指標視差另外要求 `(pointer: fine)` —— 平板照樣看得到卡, 只是不跟著手指跑。
//
// **`prefers-reduced-motion` 在這裡是「減半」不是「關掉」** (2026-09-03 修正)。
// 一開始我把兩種東西混為一談, 全部關掉 —— 結果開發機的 Windows 剛好關了動畫效果,
// 整頁完全不動, 差點得出「要改系統設定才看得到自己的網站」這種結論。兩者要分開看:
//   - **自己會動的**: 卡片的呼吸 (float-y)、滑入 (rise-in)。使用者控制不了、會自動播,
//     那才是這個偏好要擋的東西 → 呼吸照關, 滑入換成純淡入 (opacity 不會造成前庭不適)。
//   - **跟著指標走的**: 這裡的視差。不動滑鼠就不動, 動多少跟多少, 幅度上限 37px 又在背景層 ——
//     比較接近「游標本身在移動」而不是「畫面朝我動」。規範叫 **reduced** motion 不是 removed,
//     所以照做, 幅度乘 `REDUCED_GAIN` 砍半。
// (要在關了動畫效果的機器上驗有動畫的那一半, 用 playwright 的 `reducedMotion: "no-preference"`
//  開真的 Chrome: `channel: "chrome"`。headless shell 預設就是 no-preference, 驗不出這件事。)

import { useEffect, useRef, useSyncExternalStore } from "react";

import { SyncPairCard } from "@/components/sync-pair-card";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { cn } from "@/lib/utils";
import { ART_SLOTS } from "./home-art-pairs";

/** 中間挖空 —— 字與看板所在的那塊完全透明, 邊緣才看得到卡 */
const CENTER_MASK = "radial-gradient(ellipse 58% 54% at 50% 50%, transparent 38%, #000 100%)";

/** 每幀往目標補多少 —— 0.06 ≈ 半秒才追到位, 那個「慢半拍」就是沉穩感的來源 */
const EASE = 0.06;
/** 追到這麼近就當作到位, 收掉 rAF */
const SETTLED = 0.001;
/** 開了「減少動態」時視差的幅度倍率 (減半, 不是關掉 —— 見檔頭) */
const REDUCED_GAIN = 0.5;

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  };
}
const snapshot = (query: string) => () =>
  typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;

/** SSR 一律 false → 伺服器不畫, hydration 後才依實際視窗決定 (React 會自己補這次 re-render) */
function useMedia(query: string) {
  return useSyncExternalStore(subscribeMedia(query), snapshot(query), () => false);
}

export function HomePairArt({ pairs }: { pairs: ClientPairRecord[] }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const wide = useMedia("(min-width: 768px)");
  const canTilt = useMedia("(pointer: fine)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  // 視差跟著指標走 = 直接操作, 開了偏好也照做, 只是幅度砍半 (見檔頭)
  const tilting = wide && canTilt;
  const gain = reduce ? REDUCED_GAIN : 1;

  useEffect(() => {
    if (!tilting) return;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;

    const tick = () => {
      cur.x += (target.x - cur.x) * EASE;
      cur.y += (target.y - cur.y) * EASE;
      const el = sceneRef.current;
      if (el) {
        el.style.setProperty("--mx", cur.x.toFixed(4));
        el.style.setProperty("--my", cur.y.toFixed(4));
      }
      if (Math.abs(target.x - cur.x) < SETTLED && Math.abs(target.y - cur.y) < SETTLED) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tilting]);

  // 手機/窄視窗完全不掛載 —— 一張卡的圖都不會下載
  if (!wide || pairs.length === 0) return null;

  const byId = new Map(pairs.map((p) => [p.pairId, p]));

  return (
    <div
      ref={sceneRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden dark:opacity-75"
      style={{ maskImage: CENTER_MASK, WebkitMaskImage: CENTER_MASK }}
    >
      {ART_SLOTS.map((slot, i) => {
        const pair = byId.get(slot.pairId);
        // catalog 撈不到 = 那組被 isUnreleasedPair 擋掉或改了 id → 直接不畫, 不要出現空卡
        if (!pair) return null;
        return (
          <div
            key={slot.pairId}
            className="absolute will-change-transform"
            style={{
              ...slot.pos,
              opacity: slot.opacity,
              // --mx/--my 由上面的 rAF 寫在 scene 上 (-1…1); 沒有指標時 fallback 0 = 正面
              transform: [
                `translate3d(calc(var(--mx, 0) * ${(slot.par * gain).toFixed(2)}px), calc(var(--my, 0) * ${(slot.par * gain * 0.55).toFixed(2)}px), 0)`,
                `perspective(700px)`,
                `rotateY(calc(var(--mx, 0) * ${(slot.deg * gain).toFixed(2)}deg))`,
                `rotateX(calc(var(--my, 0) * ${(-slot.deg * gain * 0.7).toFixed(2)}deg))`,
                `scale(${slot.scale})`,
              ].join(" "),
            }}
          >
            {/* 入場 (一次性) 與呼吸 (無限) 必須分兩層 —— 疊在同一個元素上後者會蓋掉前者 */}
            <div
              className="animate-rise-in motion-reduce:animate-fade-in"
              style={{
                animationDelay: `${200 + i * 90}ms`,
                filter: slot.blur ? "blur(1.4px)" : undefined,
              }}
            >
              <div
                className="animate-float-y motion-reduce:animate-none"
                style={
                  {
                    animationDuration: `${slot.cycle}s`,
                    animationDelay: `${i * 500}ms`,
                    "--float": `${slot.float}px`,
                    "--tilt": `${slot.tilt}deg`,
                    // 靜態的歪斜要寫在這裡而不是只寫在 keyframe 裡: 關了呼吸 (減少動態)
                    // 之後 keyframe 整個不套, 只靠它的話七張卡會全部站得直挺挺, 散落感沒了。
                    // keyframe 自己也帶 rotate(var(--tilt)), 所以動的時候不會打架。
                    transform: `rotate(${slot.tilt}deg)`,
                  } as React.CSSProperties
                }
              >
                {/* minimal + 不顯示名字 = 只留卡本身 (立繪/寶可夢/外框/星星), 背景不需要文字 */}
                <SyncPairCard
                  pair={pair}
                  size={slot.size}
                  minimal
                  showName={false}
                  eager
                  className={cn("drop-shadow-lg", slot.blur && "drop-shadow-none")}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
