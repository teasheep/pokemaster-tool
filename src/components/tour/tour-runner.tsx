"use client";

// 使用教學的整片 overlay —— 一般產品導覽那一套: 把畫面壓暗、只留目標那一塊亮著,
// 旁邊放一張卡說明, 下一步/上一步/略過。
//
// 幾個刻意的選擇 (改之前先看):
//  1. **遮罩就是 spotlight 自己的一圈超大 box-shadow**, 不是四塊拼出來的洞。
//     一個元素、圓角與外框直接吃 Tailwind, 換步驟時也只有一個東西在動。
//     沒有目標時把它縮成 0x0 —— 陰影照樣蓋滿整個畫面, 所以不需要第二個遮罩元素。
//  2. **整層吃掉所有點擊** (連亮著的那塊也是)。教學是唯讀的 —— 讓人真的按下去就得
//     處理「按錯了」「按了會換頁」兩種分岔, 教學步驟會跟畫面對不起來。要操作就按略過。
//  3. **目標找不到就降級成置中的說明卡**, 不是卡住也不是跳過。
//     「我要建立道館」這條路的讀者通常還沒有道館, 後面幾步要框的東西根本不存在。
//  4. **手機不另寫一套版面**: 卡片寬度吃滿螢幕、底部自動讓開底部導覽列 (量它真實的高度,
//     桌機那顆是 display:none 所以量到 0)。方向的挑法兩邊共用 (tour-place.ts)。
//  5. 同一個 data-tour 在桌機 (header) 與手機 (底部導覽列) 各有一份 —— findTarget
//     只挑**看得見的**那一個, 所以兩邊都會框到對的東西。
//
// ── 順不順的四條 (2026-09-07 使用者:「動效不夠絲滑」「按了下一步整個都要等一段時間」) ──
//  A. **下一步要去的那一頁先 prefetch**。使用者在讀這一步的那幾秒就是預抓的時間窗,
//     按下去時多半已經在快取裡 = 純 client 換頁。實測 dev 的 /pairs 一趟 0.5-1.0 秒,
//     不預抓就是乾等。
//  B. **每一幀的幾何直接寫進 DOM, 不走 React state**。框要跟著捲動走 = 每幀更新一次,
//     用 setState 等於每幀把整張卡 (文字/按鈕) 重新 diff 一遍。這與首頁氛圍層是同一條
//     教訓 (AGENTS「滑鼠視差: 逐張直接寫 style.transform」)。位移一律 translate3d。
//  C. **位移補間只在「同一個畫面內換目標」時開**。要捲動才看得到的目標改成「框黏著元素走」,
//     不做補間 —— 補間與捲動同時進行就是互相追, 那正是卡頓感的來源。
//  D. **換步驟的當下先把上一步的框收掉**。留著它會在換頁後停在一個完全不相干的位置
//     (元素已經卸載, 量不到新位置), 那是「按了下一步整個卡住」看起來最嚴重的地方。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { centerPlacement, cornerRect, placeCallout, type Rect } from "./tour-place";
import { TRACKS, stepsFor } from "./tour-steps";
import {
  backToChooser,
  closeTour,
  goToStep,
  hasSeenTour,
  markTourSeen,
  openTour,
  setTourGymId,
  startTrack,
  useTourState,
} from "./tour-store";

/**
 * 幾何要在**繪製前**就位, 不然開啟的第一幀會看到卡片停在左上角。
 * SSR 沒有版面可量, 退回 useEffect 只是為了不噴 React 的警告 ——
 * 這層 overlay 本來就只在 client 開啟後才渲染, server 不會走到。
 */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 同一個畫面內換目標時的位移補間長度 */
const MOVE_MS = 220;
/** 找目標找超過這麼久才顯示「還在載入」的掃光 (快的時候完全不出現, 才不會閃一下) */
const SLOW_MS = 250;
/** 找不到就放棄, 降級成置中說明卡 */
const GIVE_UP_MS = 6000;

/** 同名的 data-tour 可能有兩份 (桌機/手機各一) — 只要看得見的那一個 */
function findTarget(name: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return (
    els.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) ?? null
  );
}

function toRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** 底部被固定元素吃掉的高度 — 量手機底部導覽列本人 (桌機 sm:hidden → 0) */
function bottomInset(): number {
  // 不認名字認位置: 貼著視窗底緣的那個 nav 才是底部導覽列
  for (const nav of document.querySelectorAll("nav")) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= window.innerHeight - 1) return r.height;
  }
  return 0;
}

/** 整個看得到 = 不用捲動 = 這一步可以做位移補間 (見檔頭 C) */
function fullyVisible(r: Rect, inset: number): boolean {
  return (
    r.top >= 0 &&
    r.left >= 0 &&
    r.top + r.height <= window.innerHeight - inset &&
    r.left + r.width <= window.innerWidth
  );
}

/**
 * 第一次自動跳出來的地方 = 登入後的落地頁。
 * /gyms 在只有一個道館時會轉導成 /gyms/<id>/members, 所以兩個都要算。
 * 深連結 (分享頁、單場看板) 刻意不跳 —— 那是有目的地開進來的人。
 */
function isLandingPath(p: string): boolean {
  if (p === "/gyms") return true;
  const parts = p.split("/");
  return parts.length === 4 && parts[1] === "gyms" && parts[3] === "members";
}

export function TourRunner({ userId }: { userId: string }) {
  const s = useTourState();
  const router = useRouter();
  const pathname = usePathname();

  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  /** 還在等目標出現 (換頁中 / 這一頁沒有) — 一個步驟只變兩次, 不是每幀 */
  const [locating, setLocating] = useState(true);
  /** 等超過 SLOW_MS 才顯示掃光 */
  const [slow, setSlow] = useState(false);

  const spotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const autoOpened = useRef(false);
  /** 卡片高度 — 放 ref 不放 state: 它只是擺放的輸入, 不需要為它重繪 */
  const cardHRef = useRef(180);
  /** 這個時間點之前的幾何更新要做補間 (見檔頭 C) */
  const animateUntil = useRef(0);

  const steps = s.track ? stepsFor(s.track) : [];
  const step = s.phase === "run" ? steps[s.step] : undefined;
  const running = s.open && s.phase === "run" && Boolean(step);

  // ── 1. 第一次自己跳出來 ──
  useEffect(() => {
    if (autoOpened.current || !isLandingPath(pathname) || hasSeenTour(userId)) return;
    autoOpened.current = true;
    // 開的當下就記「看過了」——「預設第一次會跳」= 就跳這麼一次,
    // 不管他是走完、略過還是按 Esc, 都不該在下一次換頁再彈一次。
    markTourSeen(userId);
    openTour(true);
  }, [pathname, userId]);

  // ── 2. 找出使用者的道館 (後面幾步要用它拼網址) ──
  useEffect(() => {
    if (!s.open || s.gymId) return;
    const parts = pathname.split("/");
    if (parts[1] === "gyms" && parts[2]) {
      setTourGymId(parts[2]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("gym_members")
        .select("gym_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!cancelled && data?.gym_id) setTourGymId(data.gym_id);
    })();
    return () => {
      cancelled = true;
    };
  }, [s.open, s.gymId, pathname, userId]);

  // ── 3. 這一步在別頁就先換過去 ──
  useEffect(() => {
    if (!running || !step) return;
    const want = step.path({ gymId: s.gymId });
    if (!want) return;
    const here = window.location.pathname + window.location.search;
    if (here !== want) router.push(want);
  }, [running, step, s.gymId, pathname, router]);

  // ── 3b. 下一步要去的那一頁先抓起來 (見檔頭 A) ──
  // 選擇卡階段就把兩條路的第一頁都抓了 —— 那時他正在挑, 兩條都可能被挑中。
  useEffect(() => {
    if (!s.open) return;
    const ctx = { gymId: s.gymId };
    const want = new Set<string>();
    if (s.phase === "choose") {
      for (const t of TRACKS) {
        const p = stepsFor(t.id)[0]?.path(ctx);
        if (p) want.add(p);
      }
    } else if (s.track) {
      const next = stepsFor(s.track)[s.step + 1]?.path(ctx);
      if (next) want.add(next);
    }
    for (const p of want) router.prefetch(p);
  }, [s.open, s.phase, s.track, s.step, s.gymId, router]);

  // ── 4. 等目標出現 (換頁 + 骨架 + 645 張卡都要時間) ──
  // rAF 輪詢而不是 setTimeout(100): 元素一掛上去下一幀就框得到, 不會多等 100ms。
  useEffect(() => {
    const name = running ? step?.target : undefined;
    let raf = 0;
    let slowTimer = 0;
    let cancelled = false;
    const start = performance.now();

    const tick = () => {
      if (cancelled) return;
      if (!name) {
        // 這一步不框東西 → 直接進置中說明卡
        setTargetEl(null);
        setLocating(false);
        return;
      }
      const el = findTarget(name);
      if (el) {
        const r = toRect(el);
        const inView = fullyVisible(r, bottomInset());
        // 同一個畫面內就補間過去; 要捲動的話讓框黏著元素走 (見檔頭 C)
        animateUntil.current = inView ? performance.now() + MOVE_MS : 0;
        if (!inView) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
        setTargetEl(el);
        setLocating(false);
        return;
      }
      if (performance.now() - start > GIVE_UP_MS) {
        setTargetEl(null);
        setLocating(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    // 先收掉上一步的框 (見檔頭 D)。setState 一律在 rAF/timeout 裡 ——
    // effect 內同步 setState 會被 react-hooks 判成 cascading render。
    slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
    raf = requestAnimationFrame(() => {
      if (cancelled) return;
      setTargetEl(null);
      setLocating(true);
      setSlow(false);
      tick();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(slowTimer);
    };
  }, [running, step, pathname]);

  // ── 5. 幾何: 每一幀直接寫進 DOM (見檔頭 B) ──
  const region = step?.region;
  useIsoLayoutEffect(() => {
    if (!s.open) return;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const spot = spotRef.current;
      const card = cardRef.current;
      if (!card) return;

      cardHRef.current = card.offsetHeight || cardHRef.current;
      const inset = bottomInset();
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const raw = targetEl ? toRect(targetEl) : null;
      const box = raw ? (region === "corner" ? cornerRect(raw) : raw) : null;
      const place = box
        ? placeCallout({
            target: box,
            viewport: vp,
            cardHeight: cardHRef.current,
            bottomInset: inset,
          })
        : centerPlacement(vp, cardHRef.current);
      const ms = performance.now() < animateUntil.current ? `${MOVE_MS}ms` : "0ms";

      if (spot) {
        spot.style.transitionDuration = ms;
        // 沒有目標 = 縮成 0x0 擺在畫面中央: 那圈超大陰影照樣蓋滿整片
        spot.style.transform = box
          ? `translate3d(${Math.round(box.left)}px, ${Math.round(box.top)}px, 0)`
          : `translate3d(${Math.round(vp.width / 2)}px, ${Math.round(vp.height / 2)}px, 0)`;
        spot.style.width = `${box ? Math.round(box.width) : 0}px`;
        spot.style.height = `${box ? Math.round(box.height) : 0}px`;
      }
      card.style.transitionDuration = ms;
      card.style.transform = `translate3d(${place.left}px, ${place.top}px, 0)`;
      card.style.width = `${place.width}px`;
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    // capture: true — 目標可能在自己會捲的框裡 (PairPicker 那種)
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (targetEl) ro.observe(targetEl);
    if (cardRef.current) ro.observe(cardRef.current);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [s.open, targetEl, region, s.phase, s.step]);

  const setCardRef = useCallback((el: HTMLDivElement | null) => {
    cardRef.current = el;
    if (el) cardHRef.current = el.offsetHeight || cardHRef.current;
  }, []);

  // 焦點: 每換一步就落在主要按鈕上 (鍵盤操作才走得下去)
  useEffect(() => {
    if (s.open) primaryRef.current?.focus();
  }, [s.open, s.phase, s.step]);

  // Esc 關閉 + 焦點留在卡片裡 (整層是 modal)
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTour();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const card = cardRef.current;
      if (card && e.target instanceof Node && !card.contains(e.target)) {
        primaryRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [s.open]);

  if (!s.open) return null;

  const last = running && s.step === steps.length - 1;
  const onTarget = Boolean(targetEl);

  return (
    // z-[60]: 壓過 sticky header 與底部導覽列 (z-40) 以及 Radix 的 dialog/dropdown (z-50)
    <div className="fixed inset-0 z-[60]" role="presentation">
      <div
        ref={spotRef}
        aria-hidden
        className={cn(
          // left/top 固定 0, 位置一律走 transform (合成器處理, 不會每幀重算版面)
          "pointer-events-none absolute left-0 top-0 rounded-lg",
          "transition-[transform,width,height] ease-out motion-reduce:transition-none",
          onTarget ? "ring-2 ring-primary" : "ring-0"
        )}
        style={{
          // 洞以外整片壓暗 — 深淺色共用同一個值 (壓的是畫面, 不是主題色)
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
        }}
      />

      <div
        ref={setCardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className={cn(
          "absolute left-0 top-0 overflow-hidden rounded-xl border bg-card p-4 shadow-xl",
          "transition-[transform,width] ease-out motion-reduce:transition-none"
        )}
      >
        {/* 還在等下一頁 → 頂邊一條掃光 (全站的骨架 utility, 不是轉圈圈)。
            250ms 內找到目標就完全不會出現。 */}
        {running && locating && slow ? (
          <span aria-hidden className="skeleton absolute inset-x-0 top-0 h-0.5" />
        ) : null}

        {running && step ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 id="tour-title" className="text-base font-semibold leading-tight">
                {step.title}
              </h2>
              <span className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground">
                {s.step + 1} / {steps.length}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            {!locating && !onTarget ? (
              <p className="mt-2 text-xs text-muted-foreground">
                (這一步要指的東西現在不在畫面上 —— 內容一樣看得完)
              </p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={closeTour}>
                略過
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (s.step === 0 ? backToChooser() : goToStep(s.step - 1))}
                >
                  {s.step === 0 ? "回上頁" : "上一步"}
                </Button>
                <Button
                  ref={primaryRef}
                  size="sm"
                  onClick={() => (last ? closeTour() : goToStep(s.step + 1))}
                >
                  {last ? "完成" : "下一步"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 id="tour-title" className="text-base font-semibold leading-tight">
                使用教學
              </h2>
              <button
                type="button"
                onClick={closeTour}
                aria-label="關閉教學"
                className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {s.auto
                ? "第一次來 — 挑一段看, 之後在右上角頭像選單裡隨時能再叫出來。"
                : "挑一段看。"}
            </p>
            <div className="mt-3 grid gap-2">
              {TRACKS.map((t, i) => (
                <button
                  key={t.id}
                  ref={i === 0 ? primaryRef : undefined}
                  type="button"
                  onClick={() => startTrack(t.id)}
                  className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{t.title}</span>
                  <span className="text-xs text-muted-foreground">{t.hint}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={closeTour}>
                略過
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
