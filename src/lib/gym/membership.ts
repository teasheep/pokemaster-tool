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

/**
 * 道館正式成員上限 (0075)。遊戲內的「訓練家道館」是 20 人公會。
 *
 * ⚠ **這個數字必須與 migration 0075 的 trigger 裡那個 20 一致** ——
 * 前端夾得比資料庫鬆, 管理員就會看到一句 `GYM_FULL` 的英文例外;
 * 夾得比資料庫緊, 就是按了沒反應而且沒人知道為什麼。
 * `tests/member-seat-cap.test.ts` 會把兩邊掃出來對。
 *
 * 誰佔名額: status = 'active' 且 role ≠ 'advisor'。
 * 顧問是唯讀觀察者不佔名額 (0028/0072), 管理員佔 (他也是公會的一員),
 * 待確認的不佔 (還沒放行, 所以滿員時照樣排得進來)。
 */
export const GYM_SEAT_CAP = 20;

/** 這一列佔不佔名額 */
export function occupiesSeat(m: { role?: string | null; status?: string | null }): boolean {
  return m.role !== "advisor" && isActiveMember(m);
}

/**
 * 放行這一筆申請會不會多佔一個名額 —— 看的是**申請人自己的角色**:
 * 用顧問碼申請的人放行後還是顧問, 不佔名額, 滿 20 人照樣可以放行。
 * (2026-09-29 線上: 滿員的道館要放行一位顧問, 前端只看「滿了沒」就擋下來, 資料庫那條 trigger 其實會過。)
 */
export function approvalTakesSeat(applicant: { role?: string | null }): boolean {
  return occupiesSeat({ role: applicant.role, status: "active" });
}

/** 從一份成員清單算出目前佔掉幾個名額 */
export function countSeats(list: ReadonlyArray<{ role?: string | null; status?: string | null }>): number {
  return list.filter(occupiesSeat).length;
}

/** 我送出的、還在等確認的加入申請 (0071)。型別放這裡: 「我的道館」清單是 client 元件, 不該 import 到 server 專用的 queries.ts。 */
export type PendingGym = {
  gymId: string;
  gymName: string;
  role: string;
  requestedAt: string;
};
