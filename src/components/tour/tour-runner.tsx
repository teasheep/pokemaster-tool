"use client";

// 使用教學的整片 overlay —— 2026-09-07 起是**互動式**的:
// 「讓使用者點一下試試看, 不用幫他切頁面, 自己點開側板、自己加寶數,
//   教學完以後再還給使用者自行控制」
//
// 改之前先看這幾條:
//  1. **教學不替使用者換頁**。要去別頁的步驟是框住導覽列的入口, 等他自己點到那一頁
//     (advance: path)。卡住的人可以按卡片上的「幫我開」—— 那是他自己選的。
//     (先前版本會 router.push 過去, 使用者說「不用幫他切頁面」。)
//  2. **整層不吃點擊**。overlay 一律 pointer-events:none, 壓暗只是視覺 ——
//     使用者要點什麼都點得到, 教學只是在旁邊看著。這也是「還給使用者自行控制」
//     最省事的實作: 沒有東西需要「還」。
//  3. **會動到資料的步驟標 practice** → 那段期間 Supabase 的寫入被吞掉
//     (lib/supabase/practice-mode.ts), 畫面照變但不進資料庫。離開教學一定要關掉它,
//     所有離開路徑都經過 tour-store 的 closeTour/finishTrack/backToChooser。
//  4. **幾何每一幀直接寫進 DOM**, 不走 React state (框要跟著捲動走 = 每幀更新一次,
//     用 setState 等於每幀重繪整張卡)。與首頁氛圍層同一條教訓。位移一律 translate3d。
//  5. **位移補間只在「同一畫面內換目標」時開**; 要捲動的改成框黏著元素走
//     (補間與捲動同時進行就是互相追, 那是卡頓感的來源)。
//  6. 同一個 data-tour 在桌機 (header) 與手機 (底部導覽列) 各有一份 —— findTarget
//     只挑**看得見的**那一個。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Hand, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { setWritesBlocked, swallowedWrites } from "@/lib/supabase/practice-mode";
import { cn } from "@/lib/utils";
import { centerPlacement, cornerRect, placeCallout, type Rect } from "./tour-place";
import { CHOOSABLE, resolveAt, stepsFor, trackDef, TRACKS, type TourTrack } from "./tour-steps";
import {
  backToChooser,
  closeTour,
  finishTrack,
  goToStep,
  hasSeenTour,
  markTourSeen,
  openTour,
  setTourGymId,
  startTrack,
  useTourState,
} from "./tour-store";

/** 幾何要在繪製前就位, 不然開啟的第一幀會看到卡片停在左上角 */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 同一個畫面內換目標時的位移補間長度 */
const MOVE_MS = 220;
/** 做對之後框閃綠的時間, 然後才進下一步 */
const CHEER_MS = 620;
/** 找目標找超過這麼久才顯示「還在找」的掃光 */
const SLOW_MS = 300;

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

/** 底部被固定元素吃掉的高度 — 認位置不認名字: 貼著視窗底緣的那個 nav */
function bottomInset(): number {
  for (const nav of document.querySelectorAll("nav")) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= window.innerHeight - 1) return r.height;
  }
  return 0;
}

function fullyVisible(r: Rect, inset: number): boolean {
  return (
    r.top >= 0 &&
    r.left >= 0 &&
    r.top + r.height <= window.innerHeight - inset &&
    r.left + r.width <= window.innerWidth
  );
}

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
  const [locating, setLocating] = useState(true);
  const [slow, setSlow] = useState(false);
  /** 剛做對 —— 框閃綠 + 打勾 */
  const [cheer, setCheer] = useState(false);

  const spotRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const autoOpened = useRef(false);
  const cardHRef = useRef(180);
  const animateUntil = useRef(0);
  /** 目標的目前矩形 (含 corner 換算) — 判斷點擊有沒有點在框裡要用 */
  const spotRectRef = useRef<Rect | null>(null);
  const checkRef = useRef<HTMLSpanElement | null>(null);

  const steps = s.track ? stepsFor(s.track) : [];
  const step = s.phase === "run" ? steps[s.step] : undefined;
  const running = s.open && s.phase === "run" && Boolean(step);
  const last = running && s.step === steps.length - 1;
  const interactive = step ? step.advance.on !== "next" : false;

  const advance = useCallback(() => {
    setCheer(true);
    window.setTimeout(() => {
      setCheer(false);
      if (last) finishTrack();
      else goToStep(s.step + 1);
    }, CHEER_MS);
  }, [last, s.step]);

  // ── 第一次自己跳出來 ──
  useEffect(() => {
    if (autoOpened.current || !isLandingPath(pathname) || hasSeenTour(userId)) return;
    autoOpened.current = true;
    // 開的當下就記「看過了」= 就跳這麼一次, 不管他走完、略過還是按 Esc
    markTourSeen(userId);
    openTour(true);
  }, [pathname, userId]);

  // ── 找出使用者的道館 (「幫我開」要用它拼網址) ──
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

  // ── 練習模式: 只在標了 practice 的步驟開著 ──
  useEffect(() => {
    setWritesBlocked(Boolean(running && step?.practice));
  }, [running, step]);

  // ── 下一步大概會去哪, 先抓起來 (使用者自己點過去時就不用等) ──
  useEffect(() => {
    if (!s.open) return;
    const paths = new Set<string>();
    if (s.phase === "choose") {
      for (const id of CHOOSABLE) {
        const p = resolveAt(stepsFor(id)[0]?.at, s.gymId);
        if (p) paths.add(p);
      }
    } else if (s.track) {
      for (const n of [s.step, s.step + 1]) {
        const p = resolveAt(stepsFor(s.track)[n]?.at, s.gymId);
        if (p) paths.add(p);
      }
    }
    for (const p of paths) router.prefetch(p);
  }, [s.open, s.phase, s.track, s.step, s.gymId, router]);

  // ── 找目標 (rAF 輪詢: 元素一掛上去下一幀就框得到) ──
  useEffect(() => {
    const name = running ? step?.target : undefined;
    let raf = 0;
    let slowTimer = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (!name) {
        setTargetEl(null);
        setLocating(false);
        return;
      }
      const el = findTarget(name);
      if (el) {
        const r = toRect(el);
        const inView = fullyVisible(r, bottomInset());
        animateUntil.current = inView ? performance.now() + MOVE_MS : 0;
        if (!inView) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
        setTargetEl(el);
        setLocating(false);
        return;
      }
      // 找不到就一直找 —— 使用者可能還在別頁, 等他自己走過來 (不再自動導航)
      setTargetEl(null);
      raf = requestAnimationFrame(tick);
    };

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

  // ── 完成條件 1: 走到某一頁 ──
  useEffect(() => {
    if (!running || step?.advance.on !== "path") return;
    const hit =
      pathname.startsWith(step.advance.path) || pathname.includes(step.advance.path);
    if (!hit) return;
    // 一律排到下一幀才動 state (effect 內同步 setState 會被 react-hooks 判成 cascading render)
    const raf = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(raf);
  }, [running, step, pathname, advance]);

  // ── 完成條件 2: 某個東西出現了 (側板) ──
  useEffect(() => {
    if (!running || step?.advance.on !== "appear") return;
    const want = step.advance.target;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (findTarget(want)) {
        advance();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [running, step, advance]);

  // ── 完成條件 3: 點在框裡 ──
  // 用 capture 的 pointerdown: 就算目標自己 stopPropagation 也聽得到, 而且不干涉那個點擊
  // (overlay 本來就 pointer-events:none, 事件照樣送到真正的按鈕上)。
  useEffect(() => {
    if (!running || step?.advance.on !== "click") return;
    const onDown = (e: PointerEvent) => {
      const r = spotRectRef.current;
      if (!r) return;
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.left + r.width &&
        e.clientY >= r.top &&
        e.clientY <= r.top + r.height;
      if (inside) advance();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [running, step, advance]);

  // ── 幾何: 每一幀直接寫進 DOM ──
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
      spotRectRef.current = box;
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
        spot.style.transform = box
          ? `translate3d(${Math.round(box.left)}px, ${Math.round(box.top)}px, 0)`
          : `translate3d(${Math.round(vp.width / 2)}px, ${Math.round(vp.height / 2)}px, 0)`;
        spot.style.width = `${box ? Math.round(box.width) : 0}px`;
        spot.style.height = `${box ? Math.round(box.height) : 0}px`;
      }
      // 打勾跟著框的右上角走 (位置也在這裡寫, render 期間不可以讀 ref)
      const check = checkRef.current;
      if (check && box) {
        check.style.transform = `translate3d(${Math.round(box.left + box.width - 12)}px, ${Math.round(box.top - 12)}px, 0)`;
      }
      card.style.transitionDuration = ms;
      card.style.transform = `translate3d(${place.left}px, ${place.top}px, 0)`;
      card.style.width = `${place.width}px`;
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
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

  // Esc 關閉。**不做焦點鎖** —— 這一版的教學不搶控制權, 使用者要操作畫面就讓他操作。
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.open]);

  // 離開頁面 / 元件卸載時一定要把練習模式關掉 (寫入被吞掉是很難察覺的失敗)
  useEffect(() => () => setWritesBlocked(false), []);

  if (!s.open) return null;

  const onTarget = Boolean(targetEl);
  const goHere = resolveAt(step?.at, s.gymId);
  const offTrack = running && !onTarget && !locating;
  const def = s.track ? trackDef(s.track) : null;
  const nextTrack = def?.next;

  return (
    // pointer-events-none: 整層只負責「看」, 使用者要點什麼都點得到 (見檔頭 2)
    <div className="pointer-events-none fixed inset-0 z-[60]" role="presentation">
      <div
        ref={spotRef}
        aria-hidden
        style={{
          // 洞以外整片壓暗。0.45 比原本的 0.55 淡 —— 畫面還能操作, 不要壓得像不能碰
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
        }}
        className={cn(
          "absolute left-0 top-0 rounded-lg outline outline-2 outline-offset-2",
          "transition-[transform,width,height] ease-out motion-reduce:transition-none",
          cheer ? "outline-emerald-500" : onTarget ? "outline-primary" : "outline-transparent"
        )}
      >
        {/* 脈動**一定要放在子層**: 這個動畫動的是 box-shadow, 掛在上面那層會把
            那圈 9999px 的壓暗陰影一起蓋掉 (整片變透明再變回來 = 閃爍)。 */}
        {interactive && onTarget && !cheer ? (
          <span
            aria-hidden
            style={{ "--tour-pulse-color": "var(--color-primary)" } as React.CSSProperties}
            className="animate-tour-pulse absolute inset-0 rounded-lg motion-reduce:animate-none"
          />
        ) : null}
      </div>

      {/* 做對了的打勾 —— 位置在 apply() 裡跟著框寫, 這裡只切換看得見/看不見 */}
      <span
        ref={checkRef}
        aria-hidden
        className={cn(
          "absolute left-0 top-0 flex h-6 w-6 origin-center items-center justify-center rounded-full",
          "bg-emerald-500 text-white shadow-lg transition-[opacity,scale] duration-200 motion-reduce:transition-none",
          cheer && onTarget ? "scale-100 opacity-100" : "scale-50 opacity-0"
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>

      <div
        ref={setCardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        className={cn(
          // 卡片自己要可以點 (整層是 pointer-events-none)
          "pointer-events-auto absolute left-0 top-0 overflow-hidden rounded-2xl border bg-card p-4 shadow-2xl",
          "transition-[transform,width] ease-out motion-reduce:transition-none",
          "animate-fade-in"
        )}
      >
        {running && locating && slow ? (
          <span aria-hidden className="skeleton absolute inset-x-0 top-0 h-0.5" />
        ) : null}

        {running && step ? (
          <>
            <div className="flex items-center gap-2">
              {interactive ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Hand className="h-3 w-3" />
                  換你試試
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1" aria-label={`第 ${s.step + 1} 步, 共 ${steps.length} 步`}>
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
                      i === s.step ? "w-4 bg-primary" : i < s.step ? "w-1.5 bg-primary/40" : "w-1.5 bg-muted"
                    )}
                  />
                ))}
              </span>
            </div>

            <h2 id="tour-title" className="mt-2 text-base font-semibold leading-snug">
              {step.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

            {offTrack ? (
              <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                這一步要指的東西不在這一頁
                {goHere ? " — 按下面的「幫我開」我就帶你過去。" : "。"}
              </p>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={closeTour}>
                結束教學
              </Button>
              <div className="ml-auto flex items-center gap-2">
                {offTrack && goHere ? (
                  <Button variant="outline" size="sm" onClick={() => router.push(goHere)}>
                    幫我開
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (s.step === 0 ? backToChooser() : goToStep(s.step - 1))}
                >
                  {s.step === 0 ? "回上頁" : "上一步"}
                </Button>
                {/* 互動步驟也留一顆「跳過這步」—— 做不到的人不能被卡住 */}
                <Button
                  ref={primaryRef}
                  size="sm"
                  variant={interactive ? "outline" : "default"}
                  onClick={() => (last ? finishTrack() : goToStep(s.step + 1))}
                >
                  {interactive ? "跳過這步" : last ? "看完了" : "下一步"}
                </Button>
              </div>
            </div>
          </>
        ) : s.phase === "done" ? (
          <DoneCard trackTitle={def?.title ?? ""} nextTrack={nextTrack ?? null} />
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
                ? "第一次來 — 挑一段跟著點一次，比讀說明快。之後在右上角頭像選單裡隨時能再叫出來。"
                : "挑一段跟著點一次。"}
            </p>
            <div className="mt-3 grid gap-2">
              {TRACKS.filter((t) => CHOOSABLE.includes(t.id)).map((t, i) => (
                <button
                  key={t.id}
                  ref={i === 0 ? primaryRef : undefined}
                  type="button"
                  onClick={() => startTrack(t.id)}
                  className="group/track flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all hover:border-primary hover:bg-accent active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground transition-transform group-hover/track:translate-x-0.5 motion-reduce:transition-none">
                    →
                  </span>
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

/**
 * 收尾卡。有下一段就順口問一句 (使用者:「道館戰教學接在成員教學的後面, 但不強迫看」),
 * 所以「不用了」與「好啊」是同樣大小的兩顆, 不是一顆主鈕加一行小字。
 */
function DoneCard({ trackTitle, nextTrack }: { trackTitle: string; nextTrack: TourTrack | null }) {
  const next = nextTrack ? trackDef(nextTrack) : null;
  // 練習模式吞掉過寫入 → 老實告訴使用者, 並讓「完成」重新整理回真實資料
  const dirty = swallowedWrites() > 0;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
        <h2 id="tour-title" className="text-base font-semibold">
          {trackTitle} — 看完了
        </h2>
      </div>
      {dirty ? (
        <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
          剛剛練習時調的練度<strong className="font-semibold">沒有</strong>存進資料庫（那是練習用的）。
          按「完成」會重新載入，畫面就回到你真正的資料。
        </p>
      ) : null}
      {next ? (
        <p className="mt-2 text-sm text-muted-foreground">
          還有「{next.title}」這一段（{next.hint}）—— 現在看，還是之後從頭像選單再叫？
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          之後想再看一次，右上角頭像選單裡的「使用教學」隨時叫得出來。
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant={next ? "outline" : "default"}
          size="sm"
          onClick={() => {
            closeTour();
            if (dirty) window.location.reload();
          }}
        >
          {next ? "不用了" : "完成"}
        </Button>
        {next ? (
          <Button size="sm" onClick={() => startTrack(next.id)}>
            繼續看
          </Button>
        ) : null}
      </div>
    </>
  );
}
