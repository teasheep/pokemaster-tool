import { NextResponse } from "next/server";

import { resolvePostLoginPath, safeNextPath } from "@/lib/auth/post-login-destination";
import { createClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Google One Tap 登入成功後的落地點。
 *
 * **為什麼要有這條路由, 而不是讓 client 直接導去 `/welcome?next=`**:
 * `/welcome` 是頁面, 而 `src/app/loading.tsx` 涵蓋它 —— 那個檔自己的註解就寫著
 * 「`/` `/gyms` `/welcome` 是 await 完才 redirect 的頁, redirect() + loading.tsx
 * 會先串流出骨架殼再跳走」。已經設定過的成員 (20 位裡的絕大多數) 每次用 One Tap 登入
 * 都要先閃一下骨架再被踢走, 純粹是白費。
 * Route Handler 沒有 loading.tsx, 回的是真的 307 —— 已 onboarded 的人什麼中間畫面都看不到。
 *
 * 職責只有一件事: 用 `resolvePostLoginPath()` 算出目的地並轉過去。
 * onboarding 的判斷邏輯與 `/auth/callback` 共用同一支函式, 這裡不做第二套判斷。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  const user = await getSessionUser();
  // 照理說 client 已經確認過 session 才會導過來; 真的沒有就退回登入頁,
  // 帶上 error 讓「cookie 寫不進去」這種情況在網址上看得出來 (不要靜默轉圈)。
  if (!user) return NextResponse.redirect(`${origin}/login?error=onetap_no_session`);

  const supabase = await createClient();
  const dest = await resolvePostLoginPath(supabase, user.id, next);
  return NextResponse.redirect(`${origin}${dest}`);
}
