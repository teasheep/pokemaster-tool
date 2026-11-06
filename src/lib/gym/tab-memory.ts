// 道館分頁「記得上次停在哪」(2026-11-04 使用者:「現在點人 刷新頁面 會自動跳回去 盡量不要 道館戰頁面也是」)。
//
// 成員頁選了某個人 → 去道館戰看一下 → 再按回「成員與拍組」, 舊版會回到**預設的自己**:
// 分頁的連結寫死 `/gyms/<id>/members`, 網址上的 ?member= 一離開那一頁就沒了。
// 這裡把每個分頁最後一次的完整網址 (含查詢字串) 記下來, 分頁連結改指向它。
//
// **記在 sessionStorage 不是 localStorage**: 這是「這個分頁視窗剛剛在看什麼」, 關掉分頁就該忘;
// 記一輩子的話, 隔週打開還停在上一場道館戰的某一關, 那是另一種「跳到奇怪的地方」。
// 讀寫一律包 try/catch (無痕視窗、被擋的 site data 會直接丟例外), 讀不到就是原本的行為。
//
// 這支只給 client 用, 但不標 "use client" —— 裡面沒有元件, 而且 use-url-state 要 import 它的事件名。

/** 有人改了網址 (useUrlState 的 replaceState) —— GymTabs 聽這個把最新的網址記下來 */
export const URL_STATE_EVENT = "pm-gym:url-state";
/** 記住的網址變了 —— GymTabs 的連結跟著換 */
const MEMORY_EVENT = "pm-gym:tab-memory";

/** 每個分頁底下的路徑段 (pairs 是「成員與拍組」分頁的舊路徑, 一併算在它頭上) */
export const GYM_SECTIONS = ["members", "battles", "teams", "activity"] as const;
export type GymSection = (typeof GYM_SECTIONS)[number];
const SEGMENT_TO_SECTION: Record<string, GymSection> = {
  members: "members",
  pairs: "members",
  battles: "battles",
  teams: "teams",
  activity: "activity",
};

const keyOf = (gymId: string, section: GymSection) => `pm-gym:tab-url:v1:${gymId}:${section}`;

export function gymSectionOf(pathname: string): { gymId: string; section: GymSection } | null {
  const m = pathname.match(/^\/gyms\/([^/]+)\/([^/]+)/);
  const section = m ? SEGMENT_TO_SECTION[m[2]!] : undefined;
  return m && section ? { gymId: m[1]!, section } : null;
}

/** 記下目前這一頁 (不是道館分頁就什麼都不做) */
export function rememberGymUrl(pathname: string, search: string): void {
  const at = gymSectionOf(pathname);
  if (!at) return;
  const url = pathname + search;
  try {
    const key = keyOf(at.gymId, at.section);
    if (window.sessionStorage.getItem(key) === url) return;
    window.sessionStorage.setItem(key, url);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(MEMORY_EVENT));
}

/** 某個分頁上次停在的網址; 沒記過 / 讀不到 = null */
export function readGymUrl(gymId: string, section: GymSection): string | null {
  try {
    const url = window.sessionStorage.getItem(keyOf(gymId, section));
    // 只認同一館同一個分頁底下的網址 (sessionStorage 被手改也不會把人帶去別的地方)
    return url && gymSectionOf(url.split("?")[0]!)?.section === section && url.startsWith(`/gyms/${gymId}/`)
      ? url
      : null;
  } catch {
    return null;
  }
}

/** useSyncExternalStore 的 subscribe (要是同一個函式參考, 放模組層) */
export function subscribeGymUrls(onChange: () => void): () => void {
  window.addEventListener(MEMORY_EVENT, onChange);
  return () => window.removeEventListener(MEMORY_EVENT, onChange);
}
