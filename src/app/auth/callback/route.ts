import { NextResponse } from "next/server";

import { resolvePostLoginPath, safeNextPath } from "@/lib/auth/post-login-destination";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // 只接受站內路徑 (擋 open redirect: 外部網址 / 協定相對 //host)。
  // fallback 維持 /pairs (這條路徑原本就是這樣, 不要跟著共用函式的預設值一起改)。
  const next = safeNextPath(searchParams.get("next"), "/pairs");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 首次登入 (還沒設定名稱/頭貼) → 先走設定引導。
      // 這個閘門與 One Tap 那條路徑共用同一支 resolvePostLoginPath()，全站只有一份實作。
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const dest = user ? await resolvePostLoginPath(supabase, user.id, next) : next;
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}
