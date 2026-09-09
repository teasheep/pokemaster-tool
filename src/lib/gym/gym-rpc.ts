// `create_gym` / `join_gym` 兩支 RPC 的回傳判讀 —— 全站唯一一份。
//
// **為什麼要一份共用的**: 這兩支在 0060/0061 從「回 uuid + 丟例外」改成「回 jsonb」,
// 理由是節流必須把失敗記下來, 而丟例外會讓那筆紀錄跟著交易一起回滾 (見 0060 檔頭)。
//
// ⚠ **新舊兩種形狀都要吃得下**, 而且這不是為了好看:
//   部署 (推 tag → CI → Workers) 與套 migration 是兩個動作, 不會同時落地。
//   中間那幾分鐘如果前端只認得新形狀, **加入道館就會斷** —— 而那是 20 位成員真的在用的路。
//   吃得下兩種之後, 先部署或先套 migration 都無所謂。
//     舊版: data = "<uuid>" 字串, 錯誤靠 exception 的 message 帶代碼
//     新版: data = { gym_id } 或 { error }
//
// 等哪天確定線上一定是新版了, 可以把字串那一支拿掉 —— 但沒有非拿不可的理由。

/** 錯誤代碼 → 使用者看得懂的中文 (使用者看得到的字一律繁中) */
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "請先登入",
  INVALID_CODE: "邀請碼無效",
  INVALID_CREATE_CODE: "建館碼無效或已經用過了",
  NAME_REQUIRED: "請輸入道館名稱",
  // 節流 (0060): 10 分鐘內試錯 5 次
  TOO_MANY_ATTEMPTS: "試太多次了，請等 10 分鐘再試",
  // PostgREST 找不到函式 = 前端與資料庫還沒對齊 (部署與 migration 之間那幾分鐘)
  RPC_MISSING: "這個功能正在更新，請稍後再試一次",
};

export type GymRpcResult =
  | { gymId: string; error?: undefined }
  | { gymId?: undefined; error: string };

/**
 * 把 supabase.rpc(...) 的 `{ data, error }` 收成 `{ gymId }` 或 `{ error: 中文訊息 }`。
 * 認不出來的錯誤把原文帶出去 —— 寧可看到英文, 也不要吞掉一個我們沒想過的失敗。
 */
export function readGymRpc(data: unknown, error: { message?: string; code?: string } | null): GymRpcResult {
  if (error) {
    // 函式不存在 (簽章對不上) —— PostgREST 的代碼是 PGRST202
    if (error.code === "PGRST202" || /Could not find the function/i.test(error.message ?? "")) {
      return { error: MESSAGES.RPC_MISSING };
    }
    const key = Object.keys(MESSAGES).find((k) => (error.message ?? "").includes(k));
    return { error: key ? MESSAGES[key] : (error.message ?? "發生未知的錯誤") };
  }
  // 舊版: 直接回 uuid
  if (typeof data === "string" && data) return { gymId: data };
  if (data && typeof data === "object") {
    const row = data as { gym_id?: unknown; error?: unknown };
    if (typeof row.gym_id === "string" && row.gym_id) return { gymId: row.gym_id };
    if (typeof row.error === "string") {
      return { error: MESSAGES[row.error] ?? row.error };
    }
  }
  return { error: "沒有拿到道館資料，請再試一次" };
}
