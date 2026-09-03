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
//  2. **跟著滑鼠的視差**: 指標位置 (-1…1) 每一幀直接寫進每張卡的 style.transform, 各自用
//     `par`(位移 px) 與 `deg`(旋轉度) 換算 —— **近的位移大、遠的小**, 那個差就是空間感。
//     旋轉走每張卡自己的 `perspective()`, 所以是真的翻轉不是斜切。
//  3. **各自呼吸**: 每張卡自己的 float-y (振幅/週期/相位都不同)。滑鼠不動時畫面也還活著。
//
// **深度刻意不用 translateZ** (踩過): 共用 perspective 時 translateZ 會把元素往消失點
// (畫面中央) 拉, 擺在 left:1.5% 的卡在 z=-560 會被拉到中間壓住文字, 位置完全不受控。
// 現在每張卡各自 perspective, 寫哪就在哪。
//
// 追指標用 rAF + **以時間為準**的緩動 (見 TAU_MS) 而不是直接跟 —— 直接跟很躁, 這裡要的是慢半拍地飄。
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
//   - **跟著指標走的**: 這裡的視差。不動滑鼠就不動, 動多少跟多少, 又在背景層 ——
//     比較接近「游標本身在移動」而不是「畫面朝我動」。規範叫 **reduced** motion 不是 removed,
//     所以照做, 幅度乘 `REDUCED_GAIN`。
// (要在關了動畫效果的機器上驗有動畫的那一半, 用 playwright 的 `reducedMotion: "no-preference"`
//  開真的 Chrome: `channel: "chrome"`。headless shell 預設就是 no-preference, 驗不出這件事。)

import { useEffect, useRef, useSyncExternalStore } from "react";

import { SyncPairCard } from "@/components/sync-pair-card";
import type { ClientPairRecord } from "@/lib/pairs/types";
import { cn } from "@/lib/utils";
import { ART_SLOTS, type ArtSlot } from "./home-art-pairs";

/** 中間挖空 —— 字與看板所在的那塊完全透明, 邊緣才看得到卡 */
const CENTER_MASK = "radial-gradient(ellipse 58% 54% at 50% 50%, transparent 38%, #000 100%)";

/**
 * 追指標的時間常數 (ms) —— 每幀補的比例由**這一幀實際過了多久**算出來, 不是寫死一個比例。
 *
 * 一開始寫死「每幀補 6%」, 那在 60Hz 與 32Hz 上是兩種東西: 32Hz 時追到位要兩倍久,
 * 而且每一幀跳的距離是兩倍大 —— 看起來就是頓。改成 alpha = 1 - exp(-dt / TAU) 之後,
 * 不管螢幕幾 Hz、掉不掉幀, 走完的路徑都一樣, 只是取樣點多寡不同。
 * (這台開發機是遠端桌面, 虛擬螢幕只有 32Hz —— 就是這樣抓到的。)
 * 150ms ≈ 追到位約 0.45 秒: 跟得上手但仍然慢半拍。
 */
const TAU_MS = 150;
/** 一幀最多算多久 —— 分頁切回來時 dt 可能是好幾秒, 沒有夾住會瞬間跳到定位 */
const MAX_DT = 64;
/** 追到這麼近就當作到位, 收掉 rAF */
const SETTLED = 0.001;
/** 開了「減少動態」時視差的幅度倍率 (調弱, 不是關掉 —— 見檔頭) */
const REDUCED_GAIN = 0.65;

/**
 * 一張卡在指標 (x, y) ∈ [-1,1] 時的 transform —— rAF 迴圈與初始值共用同一份公式。
 *
 * **視差直接寫在每張卡自己的 `style.transform`, 不走 CSS 變數** (2026-09-03 改):
 * 原本是把 `--mx/--my` 寫在最外層再讓每張卡用 `calc(var(...))` 換算, 但自訂屬性是**會繼承的**,
 * 改一次就把七張卡連同它們整個 SVG 子樹全部標記成待重算 —— 實測每幀樣式重算 1.9ms。
 * 逐張寫字串反而只動七個元素自己的 transform, 拿回大約一半。
 */
function slotTransform(slot: ArtSlot, x: number, y: number, gain: number): string {
  const px = (x * slot.par * gain).toFixed(2);
  const py = (y * slot.par * gain * 0.55).toFixed(2);
  const ry = (x * slot.deg * gain).toFixed(2);
  const rx = (-y * slot.deg * gain * 0.7).toFixed(2);
  return `translate3d(${px}px, ${py}px, 0) perspective(700px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${slot.scale})`;
}

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
  // 每張卡一個 ref —— 視差逐張寫進 style.transform (理由見 slotTransform)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const wide = useMedia("(min-width: 768px)");
  const canTilt = useMedia("(pointer: fine)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  // 視差跟著指標走 = 直接操作, 開了偏好也照做, 只是幅度調弱 (見檔頭)
  const tilting = wide && canTilt;
  const gain = reduce ? REDUCED_GAIN : 1;

  useEffect(() => {
    if (!tilting) return;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    let prev = 0;

    const apply = (x: number, y: number) => {
      for (let i = 0; i < ART_SLOTS.length; i++) {
        const el = cardRefs.current[i];
        if (el) el.style.transform = slotTransform(ART_SLOTS[i], x, y, gain);
      }
    };

    const tick = (now: number) => {
      // 第一幀沒有前一幀可比, 當作一個標準幀
      const dt = Math.min(prev ? now - prev : 16.7, MAX_DT);
      prev = now;
      const alpha = 1 - Math.exp(-dt / TAU_MS);
      cur.x += (target.x - cur.x) * alpha;
      cur.y += (target.y - cur.y) * alpha;
      apply(cur.x, cur.y);
      if (Math.abs(target.x - cur.x) < SETTLED && Math.abs(target.y - cur.y) < SETTLED) {
        raf = 0;
        prev = 0;
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
  }, [tilting, gain]);

  // 手機/窄視窗完全不掛載 —— 一張卡的圖都不會下載
  if (!wide || pairs.length === 0) return null;

  const byId = new Map(pairs.map((p) => [p.pairId, p]));

  return (
    <div
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
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="absolute will-change-transform"
            style={{
              ...slot.pos,
              opacity: slot.opacity,
              // 初始 = 指標在正中央 (0,0); 之後每一幀由 rAF 直接覆寫這一行
              transform: slotTransform(slot, 0, 0, gain),
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
