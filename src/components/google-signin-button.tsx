"use client";

// Google 官方「使用 Google 帳戶登入」按鈕。
//
// **這是全站唯一刻意不套 shadcn `<Button>` 的按鈕**, 而且要保持這樣。
// 品牌規範 (https://developers.google.com/identity/branding-guidelines) 原文明寫的硬條件:
//   - 「Following these guidelines … is required for app verification」—— 對外開放後這是硬需求
//   - logo 必須是「the standard color gradient super G」, Don't「use an outdated Google 'G'」
//   - 「The button font is Google Sans Medium」
//   - padding: logo 左 12px / logo 右 10px / 文字右 12px
//   - Don't: 把 G 放在 light/dark/neutral 以外的有色底上、改 G 的尺寸或顏色、只寫「Google」一個字
// 套我們的 Button 會直接撞到底色那條 (--background 是暖奶油, 不是 #FFF / #131314)。
//
// 高度 40 / 圓角 4 / max-width 400 / 14px 500 字距 0.25 / 兩套配色 / hover 遮罩 這些**數值**
// 不在規範的文字裡, 是逐條抄自 Google 官方 HTML 產生器輸出的 `.gsi-material-button`
// (品牌規範頁「Render HTML Button Element」段內嵌的產生器, 官方 pre-approved 的 HTML 版按鈕),
// 並與官方素材包 signin-assets.zip 的 180×40 SVG 對過:
//   高 40px / 左右 padding 12px / 圓角 4px (pill 是 20px) / max-width 400px
//   字 14px / line-height 20px / font-weight 500 / letter-spacing 0.25px
//   logo 20×20, 右邊距 10px  (12 + 20 + 10 = 文字起點 42px, 與 SVG 量到的一致)
//   Light: 底 #FFFFFF  框 #747775  字 #1F1F1F
//   Dark : 底 #131314  框 #8E918F  字 #E3E3E3
//   hover: 疊 8% 遮罩 + 官方陰影; active/focus: 12%; disabled: 內容 38% 透明
//   轉場 .218s
// 要動任何一個值, 先回去看那份規範。
//
// 為什麼不用 `google.accounts.id.renderButton()` (GIS 自己畫的那顆):
//   1. 它產出的是 accounts.google.com 的 **iframe**, 必須先成功載入 gsi/client。
//      Brave Shields / 擋腳本的擴充 / 公司 proxy 擋掉那支 script 時, 容器就是空的 ——
//      **唯一的登入入口整個消失**。這比「入口還在但功能斷掉」更糟。
//   2. 它走的是 signInWithIdToken (跟 One Tap 同一條), 會一起繼承
//      google-one-tap.tsx 記載的「cookie 被封鎖 → resolve 成功但 session 沒落地」那個坑。
//      我們要的是一條**完全不依賴 GIS** 的保底路徑 = 頂層導向的 signInWithOAuth。
//   3. 寬度硬上限 400px 且 iframe 內無法用 CSS 干預, 字型/焦點框也不受控。
// 兩者並存更不行 —— 同一頁兩顆 Google 按鈕做同一件事。

import { Google_Sans } from "next/font/google";
import { useState } from "react";
import { toast } from "sonner";

// 隱形的 44px 觸控命中區 (::before 覆蓋層, 完全不佔版面, 一個像素都不動視覺)。
// 官方按鈕高度固定 40px < 44px, 這是唯一能同時滿足「官方尺寸」與「觸控目標 ≥44px」的做法。
import { COARSE_HIT_AREA } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/post-login-destination";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * 官方按鈕字型 —— 規範原文「The button font is Google Sans Medium」。
 * Google Sans 已是 OFL 授權並進了 Google Fonts, 走 next/font/google 自我託管:
 * 建置時下載、隨站部署, **執行期零外部請求** (不會多一個對 fonts.googleapis.com 的連線)。
 * 只載 500 一個字重 + latin 子集 (按鈕上只有「Google」這個詞是拉丁字, 繁中字元照常落到系統字型)。
 * 後備 stack 是官方 HTML 產生器輸出的 'Roboto', arial, sans-serif。
 */
const googleSans = Google_Sans({ weight: "500", subsets: ["latin"], display: "swap" });
const GOOGLE_FONT_STACK = `${googleSans.style.fontFamily}, 'Roboto', arial, sans-serif`;

/**
 * 官方 Google「G」logo —— **原封不動**取自 Google 官方素材包 signin-assets.zip (2026-04 版)
 * 的 icon-only SVG, 只拿掉外圍的按鈕底色/框線那兩條 path, 其餘 (mask / conic-gradient /
 * 六顆高斯模糊橢圓) 一個數值都沒動, 屬性名只是轉成 JSX 寫法。
 *
 * 為什麼一定要這一份: 品牌規範原文「must be the standard color version (the standard color
 * **gradient super G** logo)」, 且 Don't 明列「use an outdated Google 'G'」—— 網路上到處流傳的
 * 經典扁平四色 G 就是那個 outdated 版本。Light 與 Dark 主題用的是同一份 G (已比對兩個官方檔)。
 *
 * 它用 <foreignObject> 放一個 CSS conic-gradient 的 div 再用 G 形狀 mask 住 (Figma 的匯出法),
 * inline SVG 在所有現代瀏覽器都支援 foreignObject; 但**不能**改成 <img src="…svg"> 載入 ——
 * 圖片模式的 SVG 不會渲染 foreignObject 裡的 HTML, G 會變成空白。
 * id 一律帶 _gsg 後綴, 同一頁放多顆也不會撞。
 */
function GoogleG() {
  return (
    <svg
      viewBox="10 10 20 20"
      className="block h-5 w-5"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <mask id="mask0_gsg" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="10" y="10" width="20" height="20">
      <path d="M29.3987 18.1814H19.9849V22.0445H25.3598C25.1286 23.294 24.4294 24.3596 23.3676 25.0712C22.4746 25.6716 21.3266 26.0211 19.9849 26.0211C17.3864 26.0211 15.1823 24.2666 14.3947 21.9004C14.1952 21.2989 14.0853 20.6599 14.0853 19.9983C14.0853 19.3367 14.1952 18.6966 14.3947 18.0962C15.1823 15.7311 17.3864 13.9755 19.9849 13.9755C21.4524 13.9755 22.767 14.4816 23.8039 15.4713L26.6653 12.6057C24.936 10.9908 22.6786 10 19.9849 10C16.0832 10 12.705 12.2414 11.0618 15.5076C10.383 16.8592 10 18.3834 10 19.9994C10 21.6155 10.383 23.1396 11.0618 24.4913C12.705 27.7597 16.0832 30 19.9849 30C22.6797 30 24.9485 29.1137 26.6018 27.5861C28.4887 25.8452 29.5732 23.2702 29.5732 20.2275C29.5732 19.5182 29.5131 18.835 29.3987 18.1825V18.1814Z" fill="#E94FFF"/>
      </mask>
      <g mask="url(#mask0_gsg)">
      <g filter="url(#filter0_f_gsg)">
      <g clipPath="url(#paint0_angular_gsg_clip_path)"><g transform="matrix(0.00804129 -0.00805186 0.00804128 0.00805186 19.6819 19.7927)"><foreignObject x="-2105.64" y="-2105.64" width="4211.29" height="4211.29"><div style={{ background: "conic-gradient(from 90deg,rgba(255, 70, 65, 1) 0deg,rgba(255, 70, 65, 1) 4.14555deg,rgba(49, 134, 255, 1) 39.154deg,rgba(49, 134, 255, 1) 72.0044deg,rgba(0, 165, 183, 1) 96.7463deg,rgba(14, 188, 95, 1) 120.897deg,rgba(14, 188, 95, 1) 154.722deg,rgba(108, 196, 0, 1) 179.136deg,rgba(255, 204, 0, 1) 203.588deg,rgba(255, 211, 20, 1) 226.915deg,rgba(255, 204, 0, 1) 251.688deg,rgba(255, 106, 43, 1) 273.129deg,rgba(253, 70, 65, 1) 289.305deg,rgba(255, 70, 65, 1) 359.593deg,rgba(255, 70, 65, 1) 360deg)", height: "100%", width: "100%", opacity: 1 }} /></foreignObject></g></g><path d="M7.25922 19.7927C7.25922 12.6759 13.0209 6.90668 20.1283 6.90668C27.2357 6.90668 32.9973 12.6759 32.9973 19.7927C32.9973 26.9094 27.2357 32.6786 20.1283 32.6786C13.0209 32.6786 7.25921 26.9094 7.25922 19.7927Z"/>
      </g>
      <g filter="url(#filter1_f_gsg)">
      <ellipse cx="20.0496" cy="20.2413" rx="5.39634" ry="2.83537" transform="rotate(24.4473 20.0496 20.2413)" fill="#3186FF"/>
      </g>
      <g filter="url(#filter2_f_gsg)">
      <ellipse cx="33.3538" cy="18.2155" rx="7.43918" ry="3.09357" fill="#3186FF"/>
      </g>
      <g filter="url(#filter3_f_gsg)">
      <ellipse cx="25.2744" cy="16.2195" rx="7.40854" ry="2.37805" fill="#FF4641"/>
      </g>
      <g filter="url(#filter4_f_gsg)">
      <ellipse cx="29.5427" cy="12.9268" rx="7.40854" ry="2.37805" fill="#FF5B8B"/>
      </g>
      <g filter="url(#filter5_f_gsg)">
      <ellipse cx="24.4817" cy="19.878" rx="8.5061" ry="3.10976" fill="#3186FF"/>
      </g>
      <g filter="url(#filter6_f_gsg)">
      <ellipse cx="25.1842" cy="14.0197" rx="4.53882" ry="2.37805" transform="rotate(-28.6599 25.1842 14.0197)" fill="#FF4641"/>
      </g>
      </g>
      <defs>
      <filter id="filter0_f_gsg" x="5.25922" y="4.90668" width="29.7381" height="29.772" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <clipPath id="paint0_angular_gsg_clip_path"><path d="M7.25922 19.7927C7.25922 12.6759 13.0209 6.90668 20.1283 6.90668C27.2357 6.90668 32.9973 12.6759 32.9973 19.7927C32.9973 26.9094 27.2357 32.6786 20.1283 32.6786C13.0209 32.6786 7.25921 26.9094 7.25922 19.7927Z"/></clipPath><filter id="filter1_f_gsg" x="12.9977" y="14.828" width="14.1038" height="10.8265" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <filter id="filter2_f_gsg" x="23.9146" y="13.1219" width="18.8784" height="10.1871" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <filter id="filter3_f_gsg" x="15.8659" y="11.8415" width="18.8171" height="8.7561" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <filter id="filter4_f_gsg" x="20.1341" y="8.54878" width="18.8171" height="8.7561" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <filter id="filter5_f_gsg" x="13.9756" y="14.7683" width="21.0122" height="10.2195" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      <filter id="filter6_f_gsg" x="19.0404" y="9.00419" width="12.2878" height="10.0309" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feFlood floodOpacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feGaussianBlur stdDeviation="1" result="effect1_foregroundBlur_gsg"/>
      </filter>
      </defs>
      
    </svg>
  );
}

export function GoogleSignInButton({
  redirect,
  className,
}: {
  redirect?: string | null;
  /** 只用來調位置 (例: mx-auto)。**不要拿來改顏色/尺寸/圓角** — 那些是規範值。 */
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    const supabase = createClient();
    // open redirect 的判斷走全站唯一那份 (safeNextPath), 不要在這裡再抄一次規則。
    const next = safeNextPath(redirect);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setLoading(false);
      toast.error("Google 登入失敗", { description: error.message });
    }
    // 成功時瀏覽器會整頁導向 Google, 不用收 loading
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      // 字型不能吃站內的 Geist —— 那等於改了按鈕字型。
      style={{ fontFamily: GOOGLE_FONT_STACK }}
      className={cn(
        // — 版面 (尺寸一律 px, 官方規格是 px 不是 rem) —
        "group relative flex h-[40px] w-full max-w-[400px] min-w-min items-center px-[12px]",
        // — 形狀與字 —  rounded-[20px] 就是官方的 pill 版, 其餘值不動
        "cursor-pointer rounded-[4px] border text-[14px] leading-[20px] font-medium tracking-[0.25px] select-none",
        // — Light / Dark 兩套官方配色 (第三套 neutral 是 #F2F2F2 + 無框, 我們用不到) —
        "border-[#747775] bg-white text-[#1F1F1F]",
        "dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]",
        // — 官方狀態轉場與 hover 陰影 —
        "transition-[background-color,border-color,box-shadow] duration-[218ms]",
        "hover:not-disabled:shadow-[0_1px_2px_0_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]",
        // — 焦點框: 官方 CSS 只用 12% 遮罩表示 focus, 鍵盤使用者看不出來, 補站內的 ring —
        //   (ring 畫在按鈕外側, 不動到規範管的 fill/stroke)
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        // — 官方 disabled 樣式 (順便擋連點兩下) —
        "disabled:cursor-wait disabled:border-[#1F1F1F1F] disabled:bg-[#FFFFFF61]",
        "dark:disabled:border-[#8E918F1F] dark:disabled:bg-[#13131461]",
        // 44px 觸控命中區。**不要在這顆按鈕上加 overflow-hidden** —
        // 那個 ::before 比按鈕高 4px, 會被裁掉, 命中區就白做了 (下面的遮罩改用 rounded-[inherit])。
        COARSE_HIT_AREA,
        className
      )}
    >
      {/* 官方的 hover/active 遮罩層。loading 時整顆不給互動, 直接不渲染, 免得和 disabled 樣式打架。 */}
      {!loading ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] opacity-0",
            "bg-[#303030] transition-opacity duration-[218ms] dark:bg-white",
            "group-hover:opacity-[0.08] group-active:opacity-[0.12]"
          )}
        />
      ) : null}

      {/* 內容列: logo 靠左固定, 文字在剩餘空間置中 —— 這就是官方按鈕的排法
          (content-wrapper 是 space-between, 文字那格 flex-grow:1 + text-center)。 */}
      <span className="relative flex h-full w-full flex-row flex-nowrap items-center justify-between group-disabled:opacity-[0.38]">
        <span className="mr-[10px] block h-5 w-5 min-w-5">
          <GoogleG />
        </span>
        <span className="grow overflow-hidden text-center align-top text-ellipsis whitespace-nowrap">
          {/* 官方繁中 CTA。三選一: 使用 Google 帳戶登入 / 使用 Google 帳戶註冊 / 使用 Google 帳戶繼續。
              不要自己縮寫成「使用 Google 登入」, 也不要只寫「Google」。 */}
          使用 Google 帳戶登入
        </span>
        {/* Google 官方產生器輸出就有這一行 (display:none), 給品牌自動檢查用的英文原文。
            不是給使用者看的, 所以不違反「使用者看得到的值一律繁中」。 */}
        <span className="hidden">Sign in with Google</span>
      </span>
    </button>
  );
}

// 註: 原本這個檔案還有一個 `AuthDivider`(「或」分隔線) —— 帳密登入移除後全 repo 沒人用,
//     已一併刪除。要再有第二種登入方式時再長回來。
