"use client";

// 使用教學的整片 overlay —— 一般產品導覽那一套: 把畫面壓暗、只留目標那一塊亮著,
// 旁邊放一張卡說明, 下一步/上一步/略過。
//
// 幾個刻意的選擇 (改之前先看):
//  1. **遮罩就是 spotlight 自己的一圈超大 box-shadow**, 不是四塊拼出來的洞。
//     一個元素、圓角與外框直接吃 Tailwind, 換步驟時 transition 也只有一個東西在動。
//  2. **整層吃掉所有點擊** (連亮著的那塊也是)。教學是唯讀的 —— 讓人真的按下去就得
//     處理「按錯了」「按了會換頁」兩種分岔, 教學步驟會跟畫面對不起來。要操作就按略過。
//  3. **目標找不到就降級成置中的說明卡**, 不是卡住也不是跳過。
//     「我要建立道館」這條路的讀者通常還沒有道館, 後面幾步要框的東西根本不存在。
//  4. **手機不另寫一套版面**: 卡片寬度吃滿螢幕、底部自動讓開底部導覽列 (量它真實的高度,
//     桌機那顆是 display:none 所以量到 0)。方向的挑法兩邊共用 (tour-place.ts)。
//  5. 同一個 data-tour 在桌機 (header) 與手機 (底部導覽列) 各有一份 —— findTarget
//     只挑**看得見的**那一個, 所以兩邊都會框到對的東西。

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [box, setBox] = useState<{
    vp: { width: number; height: number };
    inset: number;
    rect: Rect | null;
  } | null>(null);
  const [cardH, setCardH] = useState(180);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardRoRef = useRef<ResizeObserver | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const autoOpened = useRef(false);

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

  // ── 4. 等目標出現 (換頁 + 骨架 + 645 張卡都要時間), 找到就捲到畫面中間 ──
  useEffect(() => {
    const name = running ? step?.target : undefined;
    let timer = 0;
    let tries = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      // 這一步不框東西 (或教學沒在跑) → 清掉上一步的目標
      if (!name) {
        setTargetEl(null);
        return;
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const el = findTarget(name);
      if (el) {
        setTargetEl(el);
        // 捲動是使用者按「下一步」引發的 → 平順捲動照做; 開了 reduce 就直接跳。
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        return;
      }
      // 5 秒都沒出現就當它不在這一頁 (降級成置中說明卡), 不要無限等
      if (++tries > 50) {
        setTargetEl(null);
        return;
      }
      timer = window.setTimeout(tick, 100);
    };
    // 一律排在下一個 tick 才動 state —— effect 內同步 setState 會被 react-hooks 判成
    // cascading render (與 home-demo-step.ts 同一個處理)。
    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [running, step, pathname]);

  // ── 5. 量視窗/目標 (捲動時跟著動, 所以平順捲動看起來就是框跟著跑) ──
  useEffect(() => {
    if (!s.open) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setBox({
        vp: { width: window.innerWidth, height: window.innerHeight },
        inset: bottomInset(),
        rect: targetEl ? toRect(targetEl) : null,
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    // capture: true — 目標可能在自己會捲的框裡 (PairPicker 那種)
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (targetEl) ro.observe(targetEl);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [s.open, targetEl]);

  // 卡片高度要先量到才擺得準 (擺在目標上方時得先知道自己多高)。
  // 用 ResizeObserver 而不是每次 render 量: 每 render 量會被 react-hooks 判成
  // 「可能無限更新」, 而且字型載入、換行變化這些它也追不到。
  const setCardRef = useCallback((el: HTMLDivElement | null) => {
    cardRef.current = el;
    cardRoRef.current?.disconnect();
    cardRoRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
    ro.observe(el);
    cardRoRef.current = ro;
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

  if (!s.open || !box) return null;

  const spot = box.rect ? (step?.region === "corner" ? cornerRect(box.rect) : box.rect) : null;
  const place = spot
    ? placeCallout({ target: spot, viewport: box.vp, cardHeight: cardH, bottomInset: box.inset })
    : centerPlacement(box.vp, cardH);
  const last = running && s.step === steps.length - 1;

  return (
    // z-[60]: 壓過 sticky header 與底部導覽列 (z-40) 以及 Radix 的 dialog/dropdown (z-50)
    <div className="fixed inset-0 z-[60]" role="presentation">
      {spot ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-lg ring-2 ring-primary",
            "transition-all duration-200 ease-out motion-reduce:transition-none"
          )}
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            // 洞以外整片壓暗 — 深淺色共用同一個值 (壓的是畫面, 不是主題色)
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}

      <div
        ref={setCardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute rounded-xl border bg-card p-4 shadow-xl transition-all duration-200 ease-out motion-reduce:transition-none"
        style={{ top: place.top, left: place.left, width: place.width }}
      >
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
            {!spot ? (
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
