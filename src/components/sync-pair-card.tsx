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
import { CARD_POLY, hexPoints } from "@/components/sync-pair-defs";
import { isNewPair } from "@/lib/pairs/name";
import { useNearViewport } from "@/lib/pairs/use-near-viewport";
import type { ClientPairRecord } from "@/lib/pairs/types";

const TYPE_FILE: Record<string, string> = {
  normal: "001", fire: "002", water: "003", electric: "004", grass: "005",
  ice: "006", fighting: "007", poison: "008", ground: "009", flying: "010",
  psychic: "011", bug: "012", rock: "013", ghost: "014", dragon: "015",
  dark: "016", steel: "017", fairy: "018",
};

// 來自 pomatools main.js: this.color / this.colorDarker 對應 theme 1-18
const THEME_COLORS: Array<{ color: string; darker: string }> = [
  { color: "#66b2a5", darker: "#316571" }, // 0 default
  { color: "#afaeac", darker: "#7d7875" }, // 1
  { color: "#ee605f", darker: "#ca4b4f" }, // 2
  { color: "#60c3ec", darker: "#3190b5" }, // 3
  { color: "#feda3c", darker: "#b09102" }, // 4
  { color: "#4fcb5d", darker: "#409849" }, // 5
  { color: "#78c8d1", darker: "#4d9da4" }, // 6
  { color: "#f9915a", darker: "#c55e24" }, // 7
  { color: "#c873db", darker: "#9052b3" }, // 8
  { color: "#d28247", darker: "#a06547" }, // 9
  { color: "#81a0f0", darker: "#4c73e0" }, // 10
  { color: "#f682af", darker: "#d44a7e" }, // 11
  { color: "#aad23d", darker: "#6a9002" }, // 12
  { color: "#be9778", darker: "#8f6b47" }, // 13
  { color: "#c89bc2", darker: "#8c6487" }, // 14
  { color: "#32aacd", darker: "#0d9cab" }, // 15
  { color: "#9695b4", darker: "#636287" }, // 16
  { color: "#95aad7", darker: "#62759d" }, // 17
  { color: "#fa9ead", darker: "#c1666e" }, // 18
];

// type → theme index (pomatools data.themes[0]%100 正好對到 18 屬性的順序)
const TYPE_THEME_INDEX: Record<string, number> = {
  normal: 1, fire: 2, water: 3, electric: 4, grass: 5,
  ice: 6, fighting: 7, poison: 8, ground: 9, flying: 10,
  psychic: 11, bug: 12, rock: 13, ghost: 14, dragon: 15,
  dark: 16, steel: 17, fairy: 18,
};

function pickTheme(type: string) {
  const idx = TYPE_THEME_INDEX[type];
  return idx != null ? THEME_COLORS[idx] : THEME_COLORS[0];
}

// (外框漸層 / 背景底色 / clipPath 的定義搬到 sync-pair-defs.tsx —— 全站共用一份 defs,
//  這裡只引用固定 id; 顏色值要改請改那邊)

// 卡片需要的拍組欄位 = client 投影型別 (單一來源在 @/lib/pairs/types)。
// 之前這裡手抄了一份 PairRecord, 加欄位會漏同步; 改成 alias 後只剩一處定義。
export type SyncPairCardData = ClientPairRecord;

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
  hideStars?: boolean;
  /** 顯示 EX role 第二徽章 (預設關, 由 /pairs 全域 toggle 控制) */
  showExRole?: boolean;
  /** 超覺醒等級 0-5 (使用者資料); >0 時在左側顯示超覺醒星 */
  superAwakening?: number;
  /** 是否已擁有; false 時卡片變灰 (管理頁未點亮狀態) */
  owned?: boolean;
  /**
   * 顯示 EX 換裝標記。EX 換裝 UI 已下架 (見 AGENTS.md『EX 裝』), 目前全站沒有呼叫端,
   * 立繪也一律用一般立繪 — 重啟時連同 exStyleImagePath 一起復原。
   */
  exStyle?: boolean;
  /** 太晶化拍組: 寶可夢用六角形框而非圓形 */
  tera?: boolean;
  /**
   * 精簡模式: 只留拍組圖 + 星級 + 寶數 + 超覺醒, 隱藏 Lv 文字、招式屬性 icon、
   * 角色定位與拍組類別徽章 (道館用途只在意「是誰、幾寶」)。
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
  hideStars = false,
  showExRole = false,
  superAwakening = 0,
  owned = true,
  exStyle = false,
  tera,
  minimal = false,
  awakenable,
  onCountClick,
  eager = false,
  scrollRoot,
}: Props) {
  const handleClick = onClick ?? (onSelect ? () => onSelect(pair.pairId) : undefined);
  // 唯讀卡 (無任何點擊行為) 渲染成 div, 不給 hover 浮起/按壓動效 — 可聚焦 button
  // 假裝可點會誤導 (成員唯讀視圖/隊伍展示卡)
  const interactive = !!handleClick || !!onCountClick;

  // 太晶拍組 (呼叫端可用 prop 覆寫); 判定規則在 loader.loadPairsForClient —
  // 原本要載整包 forms 才算得出來, 現在投影時就折成 isTera 布林
  const isTera = tera ?? pair.isTera;

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
  const tImg = `/reference/trainer/${pair.trainerId}_128.webp`;
  const pImg = `/reference/pokemon/${pair.pokemonId}_128.webp`;

  // 延遲載圖: 只延後「每張卡獨有的重圖」= 訓練家立繪 + 寶可夢圖 (一頁 645 張卡 ≈ 981 個請求
  // /14.7MB, 佔全頁圖片位元組 98.7%)。星星/屬性/角色/徽章/ballground 是全站共用的幾十個小檔,
  // 瀏覽器快取後不會重複下載, 一律照舊立刻載。
  // href 沒圖時給 undefined **不要給空字串** — React 對 undefined 直接不輸出屬性,
  // href="" 在部分瀏覽器會被當成「請求當前頁」。
  const [nearRef, near] = useNearViewport<SVGSVGElement>(scrollRoot);
  // 給過圖就不再收回: eager 是「第 N 張」的位置判定, 篩選/排序/切子分頁後名次會變,
  // 沒黏住的話已經下載好的圖會被拔掉再重載。(在 render 中寫 ref 這裡是安全的 —
  //  單向、只影響自己這張卡的輸出, 最壞情況是「圖照樣顯示」。)
  const shownRef = useRef(false);
  shownRef.current = shownRef.current || eager || near;
  const showArt = shownRef.current;

  // 星星圖 (官方資產) — 星數 6 = 6★EX 用 EX 星, 其餘一律 p5_N。
  // (以前「可 6EX 的拍組」即使只有 3★ 也套 pex_N 的星, 同一個星數兩種長相, 已取消)
  const isSixEx = promo >= 6 || !!ex;
  const starsUrl = isSixEx ? "/reference/ui/pex_ex.webp" : `/reference/ui/p5_${Math.min(promo, 5)}.webp`;

  const theme = pickTheme(pair.type);
  // frame 色 = 當前星級 (3-5★ 銅/銀/金); 6★EX 不另外做外框變化 — 星星已經表達了
  const frameId = `spc-frame-${Math.min(5, Math.max(3, promo))}`;
  // 角色背景底色依星數 (非屬性): 6★EX 淡彩虹, 否則 radial glow (3-5★ 銅/銀/金)
  const bgId = ex ? "spc-bg-ex" : `spc-bg-${Math.min(5, Math.max(3, promo))}`;

  const dim = { sm: 96, md: 128, lg: 192 }[size];

  const Wrapper: "button" | "div" = handleClick ? "button" : "div";
  return (
    <Wrapper
      {...(handleClick ? { type: "button" as const, onClick: handleClick } : { role: "img" })}
      aria-label={cardLabel}
      className={cn(
        "group relative inline-block overflow-hidden rounded-xl",
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
        className="block transition-[filter,opacity] duration-300 ease-out motion-reduce:transition-none"
        style={owned ? undefined : { filter: "grayscale(1) brightness(0.55)", opacity: 0.6 }}
      >
        {/* defs 全站共用一份 (SyncPairDefs, 在 root layout 渲染) — 這裡只引用固定 id */}

        {/* 0. 外層 128×128 透明 — 讓 star/hex/pokemon 等元件可以超出框,跟遊戲一致 */}

        {/* 1. 卡片 body polygon — 背景底色依星數 (稀有度), 非屬性 */}
        <polygon points={CARD_POLY} fill={`url(#${bgId})`} />

        {/* 2. 訓練家圖 — 放大約 13% (144×144 置中偏上) 讓頭更大、被框裁掉更多, 更貼近遊戲內比例 */}
        <g clipPath="url(#spc-clip-card)">
          <image
            href={showArt ? tImg : undefined}
            x="-8"
            y="-5"
            width="144"
            height="144"
            preserveAspectRatio="xMidYMid slice"
          />
        </g>

        {/* 3a. polygon 內框 — rarity 漸層描邊 (3★ 銅/4★ 銀/5★ 金; 6★EX 不變框) */}
        <polygon
          points={CARD_POLY}
          fill="none"
          stroke={`url(#${frameId})`}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {/* 3b. 內側細暗線增加層次 */}
        <polygon
          points={CARD_POLY}
          fill="none"
          stroke="black"
          strokeOpacity="0.18"
          strokeWidth="0.5"
        />

        {/* 4. 星星 (官方 PNG, 6★EX 較寬, 一般 1-5★ 較窄) */}
        {!hideStars && (
          <image
            href={starsUrl}
            x="2"
            y="2"
            width={isSixEx ? 66 : 54}
          />
        )}

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

        {/* 6. 屬性 icon — 主屬性大顆 (遊戲原位 92,30) 兩種模式都顯示;
            moveTypes[0] 不一定等於主屬性 (輔助手常有雜色招), 不能拿來當主屬性。
            一般模式另列「與主屬性不同的」招式屬性小 icon (垂直排, 主屬性下方) */}
        <image
          href={`/reference/ui/TYPE_${TYPE_FILE[pair.type] ?? "001"}.webp`}
          x="94"
          y="26"
          width="28"
          height="28"
          preserveAspectRatio="xMidYMid meet"
        />
        {(minimal ? [] : (pair.moveTypes ?? []).filter((t) => t !== pair.type))
          .slice(0, 2)
          .map((t, i) => {
            const tf = TYPE_FILE[t] ?? "001";
            return (
              <image
                key={t + i}
                href={`/reference/ui/TYPE_${tf}.webp`}
                x="100"
                y={58 + i * 17}
                width="16"
                height="16"
                preserveAspectRatio="xMidYMid meet"
              />
            );
          })}

        {/* 6b. 角色定位 (ROLE_* 攻擊/技巧/輔助/衝刺/場地) — 左側星星下方。
            辨識拍組定位的關鍵資訊, minimal 卡也要顯示 (與屬性 icon 同級) */}
        {pair.roleAsset && (
          <image
            href={`/reference/ui/${pair.roleAsset}.webp`}
            x="2"
            y="42"
            width="30"
            height="30"
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        {/* 6c. EX role (預設關, showExRole=true 才顯示) — 橫向放在主 role 右邊以節省垂直空間;
            minimal 卡也要吃 (收藏牆的「顯示 EX role」開關才有作用) */}
        {showExRole && pair.hasExRole && pair.exRole && (
          <image
            href={`/reference/ui/${pair.exRole}.webp`}
            x="33"
            y="44"
            width="26"
            height="26"
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        {/* 6c2. NEW 徽章 — 半年內上架的拍組 (下緣中央, 壓在卡框上) */}
        {isNewPair(pair) && (
          <g>
            <rect
              x="48"
              y="112"
              width="32"
              height="14"
              rx="7"
              fill="#e11d48"
              stroke="#ffffff"
              strokeWidth="1.2"
            />
            <text
              x="64"
              y="122.5"
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="800"
              fill="#ffffff"
              fontFamily="Roboto, sans-serif"
            >
              NEW
            </text>
          </g>
        )}

        {/* 6d. 拍組類別徽章 (master/exmaster/arc) — 遊戲內小卡有, minimal 也要顯示 */}
        {pair.pairKind && pair.pairKind !== "none" && (
          <image
            href={`/reference/ui/${pair.pairKind}.webp`}
            x="4"
            y="68"
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
              onCountClick && "group/count hover:scale-110 active:scale-95",
              pop && "animate-count-pop"
            )}
            style={onCountClick ? { cursor: "pointer" } : undefined}
          >
            {/* 可點時: 原生 tooltip + hover 白色光暈, 讓「這裡能點」一目瞭然 */}
            {onCountClick && (
              <>
                <title>點一下 +1 (寶數 → 超覺醒 → 歸零)</title>
                {/* 觸控裝置沒有 hover — 光暈常駐淡顯 (pointer-coarse), 提示這裡可點 */}
                <circle
                  cx="19"
                  cy="108"
                  r="17"
                  fill="#ffffff"
                  className="opacity-0 transition-opacity duration-150 group-hover/count:opacity-30 pointer-coarse:opacity-20"
                />
                <circle
                  cx="19"
                  cy="108"
                  r="17"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="opacity-0 transition-opacity duration-150 group-hover/count:opacity-90 pointer-coarse:opacity-60"
                />
              </>
            )}
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

        {/* 8. Pokemon 圈 (brybry 圖較少留白, 縮成 r=24 native size 不再放大):
            外圈 r=24 theme.darker + ballground 44×44 + pokemon 44×44 */}
        {tera ? (
          <polygon points={hexPoints(24)} fill={theme.darker} stroke="#b06cff" strokeWidth="1.5" />
        ) : (
          <circle cx="100" cy="100" r="24" fill={theme.darker} />
        )}
        <g clipPath={isTera ? "url(#spc-clip-poke-hex)" : "url(#spc-clip-poke-circle)"}>
          <image
            href="/reference/ui/ballground.webp"
            x="78"
            y="78"
            width="44"
            height="44"
            preserveAspectRatio="xMidYMid meet"
          />
          <image
            href={showArt ? pImg : undefined}
            x="78"
            y="78"
            width="44"
            height="44"
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      </svg>

      {showName && (
        <div
          className={cn(
            "px-2 py-1 leading-tight",
            size === "sm" ? "text-[10px] w-24" : size === "lg" ? "text-sm w-48" : "text-xs w-32"
          )}
        >
          <div className="font-semibold truncate">
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
