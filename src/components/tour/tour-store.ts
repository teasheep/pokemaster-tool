"use client";

// 教學的開關狀態 —— 用模組層的小 store (useSyncExternalStore) 而不是 React Context。
//
// 原因: 觸發者 (頭像選單裡的「使用教學」) 與畫面 (TourRunner 的整片 overlay) 在兩個
// 不同的子樹, 用 Context 就得把 root layout 整個包進一個 client provider。
// AGENTS 對 root layout 有兩條硬規則 (layout 不准 await、導覽/頁尾只由它渲染),
// 為了一個開關去動它不划算; 這裡只要 import 一個函式就能開。
//
// 「看過了」記在 localStorage 而不是資料庫: 換裝置會再跳一次 —— 那反而是想要的
// (手機版的教學步驟框的是底部導覽列, 跟桌機不一樣)。要做成「一輩子只跳一次」的話
// 是 profiles 加一欄, 不是改這裡。

import { useSyncExternalStore } from "react";

import type { TourTrack } from "./tour-steps";

export type TourPhase = "choose" | "run";

export type TourState = {
  open: boolean;
  phase: TourPhase;
  track: TourTrack | null;
  step: number;
  gymId: string | null;
  /** 自動跳出來的 (不是使用者自己叫的) — 只影響文案 */
  auto: boolean;
};

const CLOSED: TourState = {
  open: false,
  phase: "choose",
  track: null,
  step: 0,
  gymId: null,
  auto: false,
};

let state: TourState = CLOSED;
const listeners = new Set<() => void>();

function set(patch: Partial<TourState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** getSnapshot 必須回同一個物件 identity, 否則 useSyncExternalStore 會無限重繪 */
function getSnapshot() {
  return state;
}

export function useTourState(): TourState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 打開「你是哪一種」的選擇卡 */
export function openTour(auto = false) {
  set({ open: true, phase: "choose", track: null, step: 0, auto });
}

export function closeTour() {
  set(CLOSED);
}

export function startTrack(track: TourTrack) {
  set({ phase: "run", track, step: 0 });
}

export function goToStep(step: number) {
  set({ step });
}

export function setTourGymId(gymId: string | null) {
  set({ gymId });
}

/** 回到「你是哪一種」(教學中途想換一條路) */
export function backToChooser() {
  set({ phase: "choose", track: null, step: 0 });
}

// ── 「看過了」的旗標 (每個帳號各一份 — 同一台電腦可能不只一個人用) ──

const SEEN_PREFIX = "pm-gym:tour-seen:v1:";

export function hasSeenTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + userId) !== null;
  } catch {
    // 無痕模式 / 擋了 storage: 當成看過, 寧可不跳也不要每次換頁都彈一次
    return true;
  }
}

export function markTourSeen(userId: string) {
  try {
    window.localStorage.setItem(SEEN_PREFIX + userId, new Date().toISOString());
  } catch {
    // 寫不進去就算了 — 這一輪還是照跳, 只是下次會再跳一次
  }
}
