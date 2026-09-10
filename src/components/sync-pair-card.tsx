// 完全照 pomatools main.js 的 sync-pair-tile component 重現
//
// 從 main.js 反編譯解出的核心規格:
//   - 外 svg viewBox 0 0 128 128
//   - 訓練家圖 pattern: x=0 y=5 width=100% height=75% preserveAspectRatio="none" (非均勻拉伸)
//   - 內 svg viewBox 0 0 122 124 x=3 y=2
//   - polygon "10,17 114,17 114,101 103,112 19,112 10,101" (倒角卡片)
//   - 金邊 path (368×368 viewBox, scale 0.348)
//   - 星星圖位置 x=0 y=0 (natural 51x38 一般 / 73x39 ex)
//   - 屬性 icon: 92,30 30×30
//   - Pokemon 圈: cx=94 cy=95 r=22 (白底 r=28, 圖 44×44 at 72,73)
//   - 寶 hex: "11,87 27,87 35,101 27,115 11,115 3,101"
//   - Lv 文字: stroke #225d6b 8px + fill #fff (描邊字)
//   - 背景色 (theme color): 18 種, 來自 main.js this.color
//
// 背景色 case 1-18 來自 pomatools data.themes[0]%100 (沒 theme 欄位時用 region 近似)

import { memo, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { regionLabel } from "@/data/sync-pairs";
import { isNewPair } from "@/lib/pairs/name";
import { useNearViewport } from "@/lib/pairs/use-near-viewport";
import { usePromoteGesture } from "@/lib/pairs/use-promote-gesture";
import type { ClientPairRecord } from "@/lib/pairs/types";

// 2026-09-10: sync-pair-defs.tsx 整個刪掉了 —— 外框漸層 / 背景底色 / clipPath 那 10 個 id
// 在換成官方成品卡之後全站零引用, 卻還在每一頁的 root layout 渲染一次。

// 卡片需要的拍組欄位 = client 投影型別 (單一來源在 @/lib/pairs/types)。
// 之前這裡手抄了一份 PairRecord, 加欄位會漏同步; 改成 alias 後只剩一處定義。
export type SyncPairCardData = ClientPairRecord;

/**
 * NEW 標記 —— **畫在拍組名稱前面**, 不畫在卡面上 (2026-09-09 使用者指定:
 * 「new 的位置還是不太好, 試試看在拍組名稱前面呢? 這樣至少可以對齊」)。
 *
 * 前兩版都不行, 記著免得又繞回去:
 *  - 壓在卡面下緣 → 蓋住官方卡面的內容。
 *  - 卡片上方獨立一列 → 要為它固定保留高度, 而那段高度對「沒有 NEW 的卡」是純浪費。
 * 放進名稱那一行就完全不必處理對齊 —— 名稱本來就是固定兩行高的區塊, 有沒有 NEW 都一樣。
 *
 * `isNewPair` 的判定 (半年內初上線) 在 lib/pairs/name.ts, 與這裡只有顯示與否的關係。
 * 卡牆的名稱由 PairTypeGrid 畫, 卡片自己的 showName 也會畫 —— 兩處都用這一顆。
 */
/**
 * 拍檔石盤徽章 —— 直接用官方那六張 49×22 的圖 (grid_60…grid_70)。
 * 60-68 是青色、70 是橘色 (滿階自己會亮起來), 那是遊戲本身的視覺語言, 不要自己配色。
 *
 * **只有升過才畫** (索引 0 = 60 = 每張卡的起點, 畫了整面牆都掛一顆「60」就不帶資訊了)。
 * 這是照 pomasters 的做法, 他們用 CSS 把第一張圖藏起來。
 *
 * 放在**名稱那一行**不放卡面上, 兩個理由:
 *  1. 官方卡面的左下角是寶數六角、下緣中央是類別徽章、右下是寶可夢圈, 疊上去一定撞。
 *  2. 那張圖是 49×22 的長條, 縮進 96px 的卡裡數字看不清楚。
 */
export function SyncGridTag({ cap, className }: { cap: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 站內小圖一律原生 img (與 candy.tsx 同)
    <img
      src={`/reference/ui/grid_${cap}.webp`}
      alt={`拍檔石盤 ${cap}`}
      title={`拍檔石盤 ${cap}`}
      width={49}
      height={22}
      /* 高度跟著字級走, 寬度照 49:22 自己算 —— 名稱那一行的字級在卡牆與側板不一樣 */
      className={cn("mr-1 inline-block h-[1.25em] w-auto align-[-0.2em]", className)}
    />
  );
}

export function NewTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "mr-1 inline-block rounded-full bg-rose-600 px-1 py-px align-[0.05em]",
        "text-[0.85em] font-extrabold leading-none text-white",
        className
      )}
    >
      NEW
    </span>
  );
}

type Props = {
  pair: SyncPairCardData;
  /** promotion 0-5 (一般星) 或 6 (EX), 沒設定時用 basePotential */
  promotion?: number;
  /** EX 模式 (用 pex_ex 星 + _ex 變體圖) */
  ex?: boolean;
  level?: number | null;
  potential?: number | null;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  /** 穩定的點選 callback (傳 pairId) — 比 inline onClick 友善於 React.memo */
  onSelect?: (pairId: string) => void;
  selected?: boolean;
  className?: string;
  showName?: boolean;
  /**
   * 這個人**已經解鎖 EX 體系** (`ex_role_unlocked`, 0065) → 卡片左緣多畫一顆體系圖示。
   * 這是**使用者資料**不是全域開關 (舊版的 `showExRole` 是後者, 全站零呼叫端已移除):
   * 解鎖了才看得到, 與遊戲裡一樣。混多人的卡牆不要傳 (見 AGENTS「一面牆代表誰」)。
   */
  exRoleUnlocked?: boolean;
  /**
   * 換掉訓練家立繪的來源 (data: URL 也可以) —— **只給本機的取景工具頁用**
   * (`/dev/trainer-art`, 那頁在 cloudflare build 完全不存在)。
   * 站上一律不要傳: 立繪路徑的單一來源就是 trainerId, 傳了等於多一條規則。
   */
  trainerImgSrc?: string;
  /** 超覺醒等級 0-5 (使用者資料); >0 時在左側顯示超覺醒星 */
  superAwakening?: number;
  /** 是否已擁有; false 時卡片變灰 (管理頁未點亮狀態) */
  owned?: boolean;
  /**
   * 顯示 EX 換裝標記。**這個功能不會回來了** (2026-09-10 使用者決定) ——
   * 6★EX 的卡面本來就是官方在 6★EX 時的樣子, 不需要我方再疊一個標記。
   * prop 留著只為呼叫端相容, 全站零呼叫端。
   */
  exStyle?: boolean;
  /**
   * 太晶化拍組。**2026-09-09 起不再影響卡片長相** —— 六角框烤在官方卡面裡了,
   * 形狀由官方那張圖決定。prop 保留只為了呼叫端相容 (仍有幾處在傳)。
   */
  tera?: boolean;
  /**
   * 精簡模式。換成官方成品卡之後**只剩「隱藏 Lv 文字」一個作用** ——
   * 屬性圓 / 角色定位 / 拍組類別徽章都烤在官方圖裡, 挖不掉也不該挖。
   */
  minimal?: boolean;
  /**
   * 此拍組是否支援超覺醒 (catalog hasAwakening)。
   * 支援時左下角的計數會在寶5之後接續「超覺醒 1-5」(旋風圖標)。
   */
  awakenable?: boolean;
  /**
   * 左下角計數點擊 (寶數 → 超覺醒 遞增, 循環回 0)。
   * 有給才會變成可點的按鈕; 點擊不會觸發卡片本身的 onClick。
   */
  onCountClick?: () => void;
  /**
   * 升星 (桌機右鍵 / 手機長按) —— 見 lib/pairs/use-promote-gesture.ts。
   * 沒給就完全不掛事件, 卡片行為與以前一模一樣。
   */
  onPromote?: () => void;
  /** 略過延遲判定, 立刻給圖 (首屏就看得到的卡用) */
  eager?: boolean;
  /** 延遲載圖的 IntersectionObserver root — 卡片在自己捲的框裡時要給那個框 */
  scrollRoot?: Element | null;
};

export const SyncPairCard = memo(function SyncPairCard({
  pair,
  promotion,
  ex,
  level,
  potential,
  size = "md",
  onClick,
  onSelect,
  selected,
  className,
  showName = true,
  exRoleUnlocked = false,
  trainerImgSrc,
  superAwakening = 0,
  owned = true,
  exStyle = false,
  minimal = false,
  awakenable,
  onCountClick,
  onPromote,
  eager = false,
  scrollRoot,
}: Props) {
  const handleClick = onClick ?? (onSelect ? () => onSelect(pair.pairId) : undefined);
  const promoteBind = usePromoteGesture(onPromote);
  // 唯讀卡 (無任何點擊行為) 渲染成 div, 不給 hover 浮起/按壓動效 — 可聚焦 button
  // 假裝可點會誤導 (成員唯讀視圖/隊伍展示卡)
  const interactive = !!handleClick || !!onCountClick;

  // 太晶的六角框現在烤在官方卡面裡 → isTera 不再影響卡片長相。
  // tera / pair.isTera 兩個都保留 (呼叫端與投影都還在用), 只是這裡不再讀。

  // 點左下角計數時的回饋: 數字彈一下 (值變才觸發, 不吃初次渲染)
  const shownCount = superAwakening > 0 ? superAwakening : (potential ?? 0);
  const [pop, setPop] = useState(false);
  const prevCount = useRef(shownCount);
  useEffect(() => {
    if (prevCount.current !== shownCount) {
      prevCount.current = shownCount;
      setPop(true);
      const t = setTimeout(() => setPop(false), 260);
      return () => clearTimeout(t);
    }
  }, [shownCount]);
  const cardLabel = `${pair.trainerNameZh ?? pair.trainerName} & ${pair.pokemonNameZh ?? pair.pokemonName}${level != null ? `, Lv.${level}` : ""}`;

  // 星數: 沒傳就用原始星級。**下限一律是原始星級** — 星星只能往上升,
  // 舊資料/匯入曾寫進比原始星級還低的值 (4★ 的牡丹&伊布 存成 3), 那會畫出遊戲裡不存在的卡。
  const base = Math.max(1, Math.min(5, pair.basePotential ?? 5));
  const promo = Math.max(base, Math.min(6, promotion ?? base));

  // 檔名 = actorId (例 ch0360_00_kakitsubata), 由 scrape-brybry.mjs 保證唯一不衝突。
  // 副檔名一律 .webp — scrape 下載的是 PNG, 由 scripts/convert-card-images.mjs 轉出同名
  // .webp (資料管線 stage 1b); PNG 只留給本機的 embedding 管線, 不進部署
  // (public/.assetsignore)。所以這裡改回 .png 會讓線上整牆變空圖。
  // 重啟 EX 換裝時要把 exStyleImagePath 加回 CLIENT_PAIR_FIELDS (見 AGENTS.md『EX 裝』) —
  // 立繪路徑一律吃 catalog 的 exStyleImagePath, 不要用 trainerId 拼 (同名多變體會拼錯)。
  // ⚠ 換成官方卡面之後這裡不再拼訓練家 / 寶可夢的圖 —— 兩張都烤在卡面裡了。
  //    `trainerImgSrc` (全站只有 /dev/trainer-art 會傳) 因此**暫時失效**, 那頁要另外處理。
  void trainerImgSrc;

  // 延遲載圖: 只延後「每張卡獨有的重圖」= 訓練家立繪 + 寶可夢圖 (一頁 645 張卡 ≈ 981 個請求
  // /14.7MB, 佔全頁圖片位元組 98.7%)。星星/屬性/角色/徽章/ballground 是全站共用的幾十個小檔,
  // 瀏覽器快取後不會重複下載, 一律照舊立刻載。
  // href 沒圖時給 undefined **不要給空字串** — React 對 undefined 直接不輸出屬性,
  // href="" 在部分瀏覽器會被當成「請求當前頁」。
  const [nearRef, near] = useNearViewport<SVGSVGElement>(scrollRoot);
  // 給過圖就不再收回: eager 是「第 N 張」的位置判定, 篩選/排序/切子分頁後名次會變,
  // 沒黏住的話已經下載好的圖會被拔掉再重載。(在 render 中寫 ref 這裡是安全的 —
  //  單向、只影響自己這張卡的輸出, 最壞情況是「圖照樣顯示」。)
  // 「給過圖就黏住」改用 state, 不要在 render 階段寫 ref —— 那會被 react-hooks/refs 擋下,
  // 而規則是對的 (那樣寫元件不保證跟著更新)。
  //
  // 這裡用的是 React 官方認可的「render 期間調整 state」寫法: 條件式 setState + 立刻回傳,
  // React 會在同一次 render 內重跑這個元件, 不會多一輪 commit, 也不是 effect
  // (所以不撞 set-state-in-effect)。`showArt` 另外 OR 上當下的 eager / near,
  // 讓「這一輪就該給圖」不必等到重跑。
  const [everShown, setEverShown] = useState(false);
  /** 卡面圖載好了沒 —— 只影響淡入, 沒載好也不會擋住任何互動 */
  const [artLoaded, setArtLoaded] = useState(false);
  const showArt = everShown || eager || near;
  if (showArt && !everShown) setEverShown(true);

  const isSixEx = promo >= 6 || !!ex;

  /**
   * 官方卡面 —— 卡片本體現在是**一張圖**, 不再自己合成 (2026-09-09 使用者指定:
   * 「那邊只有壓平的成品卡, 那就把我們的卡全面改成那邊的成品卡」)。
   *
   * 底色 / 外框 / 星星 / 屬性圓 / 角色定位 / 拍組類別徽章 / 寶可夢圈 **全都烤在這張圖裡**,
   * 所以那幾層 SVG 已經移除。我們自己畫的只剩「這個人的狀態」: 左下角寶數計數、
   * 卡片上方的 NEW、以及蓋掉被計數擋住的類別徽章。
   *
   * 檔名 `<pairId>_<3|4|5|EX>.webp`, 星級由 promo 決定 —— 官方的 _3/_4/_5 只差左上角
   * 那條星星, 外框與底色三階完全相同 (已逐像素驗證), 所以「外框不因星級變化」照舊成立。
   * 沒傳 promotion 就自動拿到 basePotential 那張 (混多人的牆就是這樣用的)。
   *
   * EX 檔只有 634/654 有 (取決於這個拍組在遊戲裡有沒有 EX 姿勢), 用 hasSixEx 當守門:
   * 實測 hasSixEx=true 的每一筆都有 _EX 檔, 反向只有 1 筆例外 (小菊兒（合眾）&電飛鼠,
   * 那是我方 wiki 抓取的頁名歸屬錯誤, 修在資料端不是這裡)。
   */
  const cardTier = isSixEx && pair.hasSixEx ? "EX" : String(Math.min(5, promo));
  const cardUrl = `/reference/card/${pair.pairId}_${cardTier}.webp`;

  /**
   * 「圖載好了沒」**不能只靠 `<image onLoad>`** —— 那條路有兩個洞, 症狀都是
   * **卡面整張隱形** (className 停在 opacity-0), 而「透明」與「沒有圖」在畫面上一模一樣。
   *
   * ⚠ 前科 (2026-09-10 使用者:「從成員與拍組移動到隊伍庫時, 很多拍組圖沒有被載出來」):
   *   1. **SSR 的元素會在 hydration 之前就開始載圖**。快取命中時 load 事件早就燒掉了,
   *      React 才掛上監聽器 → onLoad 永遠不會被呼叫 → artLoaded 卡在 false。
   *      實測 (線上, 隊伍庫): 硬重整 6/6 張全透明; 軟導覽時 React 自己建元素、
   *      監聽器先掛好, 所以反而正常 —— 同一張卡的行為取決於它是怎麼被畫出來的。
   *   2. **圖 404 時 onLoad 不會來**, 卡片就永遠隱形 (連 pair_id 的文字都沒有)。
   *
   * 解法: 另外拿一顆同網址的 HTMLImageElement 去問瀏覽器快取 —— 已經在快取裡的話
   * `complete` 當下就是 true, 不必等任何事件; 沒快取就用它的 load/error 當第二條路。
   * 同網址所以**不會多一個網路請求** (共用同一份快取/同一筆 in-flight 請求)。
   * **error 也放行**: 載不到就直接顯示, 寧可看到空卡也不要看到一張隱形的卡。
   */
  useEffect(() => {
    if (!showArt || artLoaded) return;
    const probe = new Image();
    const done = () => setArtLoaded(true);
    // ⚠ **監聽器要先掛, src 最後才設** —— 反過來寫的話, 快取命中的圖會在設 src 的當下
    // 就把 load 排進去, 而我們可能已經錯過它 (那正是上面第 1 個洞的成因)。
    // 這樣寫連快取命中都收得到事件, 不必去問 complete, 也就不會在 effect 裡同步 setState。
    probe.addEventListener("load", done);
    probe.addEventListener("error", done);
    probe.src = cardUrl;
    return () => {
      probe.removeEventListener("load", done);
      probe.removeEventListener("error", done);
    };
  }, [showArt, artLoaded, cardUrl]);

  const dim = { sm: 96, md: 128, lg: 192 }[size];

  const Wrapper: "button" | "div" = handleClick ? "button" : "div";
  return (
    <Wrapper
      {...(handleClick ? { type: "button" as const, onClick: handleClick } : { role: "img" })}
      {...(promoteBind
        ? {
            onContextMenu: promoteBind.onContextMenu,
            onPointerDown: promoteBind.onPointerDown,
            onPointerMove: promoteBind.onPointerMove,
            onPointerUp: promoteBind.onPointerUp,
            onPointerCancel: promoteBind.onPointerCancel,
            onClickCapture: promoteBind.onClickCapture,
          }
        : null)}
      aria-label={cardLabel}
      className={cn(
        "group relative inline-block rounded-xl",
        // 左下角的計數放大時會超出 128×128 的畫布 (六角本來就貼著左下緣),
        // overflow-hidden 會把放大的那一圈切掉一角, 很難看
        // (2026-09-10 使用者:「六角有變好, 但左下會被裁掉」)。
        // 只有真的可點的卡才放行 —— 其餘維持原本的裁切, 免得哪天有東西不小心漏出來。
        // hover 時抬到上層, 免得溢出的那一角被右邊/下面那張卡蓋住。
        onCountClick ? "overflow-visible hover:z-20" : "overflow-hidden",
        promoteBind?.className,
        // 點擊回饋: hover 微放大提亮, 按下時縮一下 (唯讀卡不給, 避免誤導可點)
        interactive &&
          "transition-[transform,filter,box-shadow] duration-150 ease-out " +
            "hover:-translate-y-0.5 hover:brightness-105 hover:drop-shadow-md active:translate-y-0 active:scale-[0.97] " +
            "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        selected && "bg-emerald-500/50 ring-2 ring-emerald-400/60",
        className
      )}
    >
      {/* EX 換裝標記 — 上緣置中, 表示此卡顯示的是 EX style 立繪 */}
      {exStyle && (
        <span className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-1.5 py-px text-[8px] font-bold leading-tight text-white shadow">
          EX 裝
        </span>
      )}
      <svg
        ref={nearRef}
        viewBox="0 0 128 128"
        xmlns="http://www.w3.org/2000/svg"
        width={dim}
        height={dim}
        className={cn(
          "block transition-[filter,opacity] duration-300 ease-out motion-reduce:transition-none",
          // ⚠ **最外層的 <svg> 自己也會裁**: UA 樣式表對 outermost svg 是 overflow:hidden,
          // 所以只在外面那顆 div/button 開 overflow-visible 沒有用 —— 放大的六角超出
          // viewBox (0 0 128 128) 的那一圈還是會被 SVG viewport 切掉
          // (2026-09-10 使用者連續回報兩次「左下會被裁掉」, 第一次只改了外層)。
          // 兩層都要開才看得到完整的六角。
          onCountClick && "overflow-visible"
        )}
        style={owned ? undefined : { filter: "grayscale(1) brightness(0.55)", opacity: 0.6 }}
      >
        {/* 0. 外層 128×128 透明 — 讓 star/hex/pokemon 等元件可以超出框,跟遊戲一致 */}

        {/* 1. 卡片本體 = 官方成品卡一張圖 (128×128)。
            舊的 1-4 / 6 / 6b / 8 層 (底色 polygon、訓練家圖、外框、星星、屬性圓、角色定位、
            寶可夢圈) 全部烤在這張圖裡, 已移除 —— 不要再疊自己的版本上去, 會變成雙畫。
            `hideStars` 因此也失效 (星星在圖裡挖不掉), 那個 prop 全站零呼叫端, 留著只是相容。 */}
        {/* 卡面圖**載好才淡入** (2026-09-10 使用者:「篩選完以後拍組用閃的出現」)。
            篩完之後新進畫面的卡是新掛載的元件, 圖要現抓 —— 沒有這一層的話,
            使用者看到的是一格空白然後圖「啪」一下蓋上去, 整面牆同時閃。
            120ms 夠短, 不會變成「圖慢慢浮出來」的那種假掰效果; 已經在快取裡的圖
            onLoad 會在同一幀觸發, 幾乎看不到過渡。 */}
        <image
          href={showArt ? cardUrl : undefined}
          x="0"
          y="0"
          width="128"
          height="128"
          preserveAspectRatio="xMidYMid meet"
          // 快路徑而已 —— 真正保證會翻的是上面那個 effect (SSR 的元素收不到這個事件)
          onLoad={() => setArtLoaded(true)}
          className={cn(
            "transition-opacity duration-[120ms] ease-out motion-reduce:transition-none",
            artLoaded ? "opacity-100" : "opacity-0"
          )}
        />

        {/* 5. Lv 文字 (右上, 描邊白字, 避開放大星星) */}
        {!minimal && level != null && (
          <g fontFamily="NewRodinPro, Roboto, sans-serif" fontWeight="700">
            <text
              x="124"
              y="22"
              textAnchor="end"
              fontSize="18"
              style={{ stroke: "#225d6b", strokeWidth: "5px", strokeLinecap: "round", strokeLinejoin: "round", paintOrder: "stroke" }}
            >
              Lv.{level}
            </text>
            <text x="124" y="22" textAnchor="end" fontSize="18" fill="#fff">
              Lv.{level}
            </text>
          </g>
        )}

        {/* 6 / 6b 已移除: 主屬性圓與角色定位徽章都烤在官方卡面裡了。
            招式屬性的小 icon 也一併拿掉 —— 官方卡面沒有這個東西, 而且我方 moveTypes
            有 17 筆根本不含拍組自身的屬性 (forms[].moves 611 筆全空, 推導不回來),
            那 38 張卡因此多畫了一顆「一般」圖示。少畫這一層正好順手修掉。 */}

        {/* 6c. EX 體系圖示 —— **解鎖了才畫** (使用者資料, 不是全域開關)。
            官方卡面把「原本的體系」烤在左緣 x7..29 / y45..59, 這顆就**疊在它正下方**,
            與遊戲裡「解鎖後多一個體系」的呈現一致 (參考站也是這樣排的)。
            用同一組官方圖 (`/reference/ui/ROLE_*.webp`), 高度對齊上面那顆的 14px,
            寬度讓 meet 自己算 —— 那六張圖的長寬比本來就不一樣 (55×32 到 61×40)。
            ⚠ 不要改成畫在右邊: 右緣中段是官方的同步圖示, 下面是寶可夢圈, 兩邊都會撞。 */}
        {exRoleUnlocked && pair.hasExRole && pair.exRole && (
          <image
            href={`/reference/ui/${pair.exRole}.webp`}
            /* 2026-09-10 使用者微調: 往左 2 / 往下 2 —— 與烤在卡面上那顆的左緣對齊, 中間留一點空 */
            x="5"
            y="61"
            width="26"
            height="16"
            preserveAspectRatio="xMinYMid meet"
          />
        )}
        {/* 6d. 拍組類別徽章 (master/exmaster/arc/academy) — **移到下緣中央** (2026-09-09 使用者指定
            「徽章改移到 new 的位置」)。
            為什麼要重畫一次: 官方卡面自己也有這顆徽章, 但它烤在**左下角 x3..28 y92..117**,
            正好被我們的寶數六角整個蓋住 (實測只露出左斜邊 3-6 個像素)。寶數計數不能搬 ——
            「點左下角 = 寶數循環」是 AGENTS 明訂的手勢, 首頁 hero 在演它、教學也在框它。
            所以讓徽章讓位, 在計數右邊的空白處重畫一顆。

            ⚠ **只在計數真的有畫的時候才重畫** (`potential != null`) —— 否則就是同一顆徽章
            出現兩次: 官方那顆在左下角好端端露著, 我們又在中間補一顆。
            2026-09-09 第一版漏了這個條件, 訪客版的 /pairs (沒有收藏 = 不畫計數) 整牆
            雙徽章。這個壞法只在「沒有計數」的畫面上看得到, 登入後反而正常, 很容易漏。 */}
        {pair.pairKind && pair.pairKind !== "none" && potential != null && (
          <image
            href={`/reference/ui/${pair.pairKind}.webp`}
            x="53"
            y="103"
            width="22"
            height="22"
            preserveAspectRatio="xMidYMid meet"
          />
        )}

        {/* (移除原 DMAX/MEGA/TERA 文字標 — 遊戲內小卡沒有, 形態資訊保留在 data 但不在卡上顯示) */}

        {/* 7. 左下角計數 — 寶數 (sync_icon 六角) → 超覺醒 (awakening 旋風) 兩段式:
            超覺醒 >0 時改顯示旋風圖標與超覺醒級數; 到頂 (不可超覺醒的寶5 / 超覺5)
            數字轉紅描邊表示「滿了」。onCountClick 有給時整組可點 (寶+1 → 超覺 → 循環)。 */}
        {potential != null && (
          <g
            /* QA 的穩定把手 —— 這一格沒有可及名稱, 用結構選它 (class/巢狀) 一改版就爛掉
               (前科: qa:gymcode 的頭像選單靠 role+name 猜, 名稱一沒了就靜默點空) */
            {...(onCountClick ? { "data-count-hit": "" } : null)}
            onClick={
              onCountClick
                ? (e) => {
                    e.stopPropagation();
                    onCountClick();
                  }
                : undefined
            }
            className={cn(
              "origin-[19px_108px] transition-transform duration-150 ease-out motion-reduce:transition-none",
              // 可點的提示 = **六角本身放大**, 不要在它後面透出一顆圓
              // (2026-09-10 使用者:「會有一個圓形的 hover 框透出來, 但我不要,
              //  我想要就是那個六角形 hover 放大一點」+「效果明顯一點」)。
              // 圓形本來是要當光暈, 但那個形狀跟遊戲裡的六角對不起來, 看起來像多一層東西。
              // 觸控裝置沒有 hover → 常駐放大一點點, 不然完全沒有「這裡可以點」的線索。
              onCountClick &&
                "group/count hover:scale-[1.32] active:scale-95 pointer-coarse:scale-105",
              // 陰影只是讓放大的六角從卡面上浮起來, 不是要壓一塊黑影
              // (2026-09-10 使用者:「陰影有點深, 我想要亮一點點的陰影」)
              onCountClick &&
                "hover:[filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.28))]",
              pop && "animate-count-pop"
            )}
            style={onCountClick ? { cursor: "pointer" } : undefined}
          >
            {/* 可點時只留原生 tooltip —— 放大就是提示本身 (見上面 className 的註解) */}
            {onCountClick && <title>點一下 +1 (寶數 → 超覺醒 → 歸零)</title>}
            {/* 放大的可點區域 (透明) — 左下象限都算, sm 卡換算約 45×42px 觸控目標 */}
            {onCountClick && <rect x="-6" y="72" width="60" height="56" fill="transparent" />}
            <image
              href={
                superAwakening > 0
                  ? "/reference/ui/awakening_level_on.webp"
                  : "/reference/ui/sync_icon.webp"
              }
              x={superAwakening > 0 ? 0 : -2}
              y={superAwakening > 0 ? 90 : 92}
              width={superAwakening > 0 ? 38 : 42}
              height={superAwakening > 0 ? 38 : 36}
              preserveAspectRatio="xMidYMid meet"
              opacity={shownCount > 0 ? 1 : 0.5}
            />
            <g fontFamily="NewRodinPro, Roboto, sans-serif" fontWeight="800">
              {(() => {
                const value = superAwakening > 0 ? superAwakening : potential;
                // 到頂: 可超覺醒者要覺5 才算滿; 不可超覺醒者寶5 即滿
                const maxed = awakenable ? superAwakening >= 5 : potential >= 5;
                const cx = 19;
                return (
                  <text
                    x={cx}
                    y={superAwakening > 0 ? 114 : 116}
                    textAnchor="middle"
                    fontSize="16"
                    style={{
                      stroke: maxed ? "#b91c1c" : "#225d6b",
                      strokeWidth: "3.5px",
                      strokeLinejoin: "round",
                      paintOrder: "stroke",
                    }}
                    fill={maxed ? "#fecaca" : "#ffffff"}
                  >
                    {value}
                  </text>
                );
              })()}
            </g>
          </g>
        )}

        {/* 8 已移除: 寶可夢圈 (含太晶的六角框與圈底) 都烤在官方卡面裡。
            太晶拍組的框形狀因此也由官方決定, 我方 isTera 的 11→17 筆缺漏不再影響卡面長相。 */}
      </svg>

      {showName && (
        <div
          className={cn(
            "px-2 py-1 leading-tight",
            size === "sm" ? "text-[10px] w-24" : size === "lg" ? "text-sm w-48" : "text-xs w-32"
          )}
        >
          <div className="font-semibold truncate">
            {isNewPair(pair) ? <NewTag /> : null}
            {pair.trainerNameZh ?? pair.trainerName}
          </div>
          <div className="text-muted-foreground truncate">
            & {pair.pokemonNameZh ?? pair.pokemonName}
          </div>
          {pair.region && (
            <div className="text-[10px] text-muted-foreground/70 truncate">
              {regionLabel(pair.region)}
            </div>
          )}
        </div>
      )}
    </Wrapper>
  );
});
