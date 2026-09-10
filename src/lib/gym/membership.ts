// 成員狀態的判斷 —— **中立模組, 不要 import 任何 server / client 專用的東西**。
//
// 讀它的有三種呼叫端: server component (queries.ts / gyms/page.tsx)、
// service role 的 API 路由 (/api/export)、以及測試。放進 queries.ts 的話,
// 一 import 就把 `next/headers` 拖進來 —— 那正是 0071 這條規則最需要被測到的地方。

import type { GymMemberStatus } from "@/lib/supabase/types";

export type { GymMemberStatus };

/**
 * 這一列是不是「已經被管理員確認」的成員 (0071)。
 *
 * ⚠ **一定要寫成 `!== "pending"` 而不是 `=== "active"`**:
 * `status` 是 0071 才加的欄位, 而部署前端與套 migration 是兩個動作、不會同時落地。
 * 中間那幾分鐘讀回來是 `undefined` —— 前者自然算 active (= 舊行為, 什麼都不變),
 * 後者會讓**全館 20 個人一起變成「還沒確認」**, 名冊、持有率、匯出一次全空。
 * 這個壞法沒有任何錯誤訊息, 只是資料看起來不見了。
 */
export function isActiveMember(m: { status?: string | null }): boolean {
  return m.status !== "pending";
}

/** 反過來: 還在門外等的那一列 */
export function isPendingMember(m: { status?: string | null }): boolean {
  return !isActiveMember(m);
}

/** 我送出的、還在等確認的加入申請 (0071)。型別放這裡: 「我的道館」清單是 client 元件, 不該 import 到 server 專用的 queries.ts。 */
export type PendingGym = {
  gymId: string;
  gymName: string;
  role: string;
  requestedAt: string;
};
