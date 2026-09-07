// 使用教學的三條路。
//
// 2026-09-07 使用者要求整個改成**互動式**:
//   「讓使用者點一下試試看, 不用幫他切頁面, 讓他自己點、自己點開側板、自己加寶數,
//     教學完以後再還給使用者自行控制」
// 所以每一步不再是「看我示範」而是「換你做一次」——
//   - **教學不會替使用者換頁**。要去別頁的那幾步是框住導覽列上的入口, 等他自己點。
//     (卡住的人可以按卡片上的「幫我開」, 那是他自己選的, 不是教學自作主張。)
//   - 真的會動到資料的那幾步標 `practice: true` —— 那段期間 Supabase 的寫入會被吞掉
//     (lib/supabase/practice-mode.ts), 畫面照變但不進資料庫。
//   - 每一步自己說「什麼時候算做完」(advance), 做完了框會閃一下綠色再往下走。
//
// 內容一律講站內真的有的規則, 而且優先講「不講就沒人會發現」的事。

export type TourTrack = "leader" | "member" | "battle";

/** 這一步什麼時候算完成 */
export type TourAdvance =
  /** 純說明 — 按「下一步」 */
  | { on: "next" }
  /** 點了框起來的那塊 (region 是 corner 的話就只認左下角那一格) */
  | { on: "click" }
  /** 走到某一頁 (前綴比對) */
  | { on: "path"; path: string }
  /** 某個東西出現了 (例如側板被打開) */
  | { on: "appear"; target: string };

export type TourStep = {
  /** DOM 上的 data-tour 值; 沒給 = 純說明卡 (置中) */
  target?: string;
  /** 只框目標的左下角 (拍組卡的寶數) */
  region?: "corner";
  title: string;
  body: string;
  advance: TourAdvance;
  /**
   * 這一步使用者會動到資料 → 期間把 Supabase 的寫入吞掉。
   * 畫面照樣即時更新 (樂觀更新在前端), 但不會存進資料庫。
   */
  practice?: boolean;
  /**
   * 這一步該在哪一頁。**不會自動導航** —— 只用來在使用者跑掉時提供「幫我開」。
   * 需要道館 id 的用 `gym:` 開頭, 由 runner 換掉。
   */
  at?: string;
  /**
   * 補充說明 —— **只有 `ifTarget` 真的出現在畫面上時才顯示**。
   * 用途: 有些控制項只有特定身分看得到 (例如「設為道館拍組」只有管理員/編輯者有),
   * 對看不到的人講那個按鈕只會讓他找不到東西。
   */
  extra?: { ifTarget: string; body: string };
};

export type TourTrackDef = {
  id: TourTrack;
  title: string;
  hint: string;
  steps: TourStep[];
  /** 走完之後可以順著問「要不要再看這一段」 */
  next?: TourTrack;
};

export const TRACKS: TourTrackDef[] = [
  {
    id: "leader",
    title: "我是道館負責人",
    hint: "我要建立道館",
    next: "battle",
    steps: [
      {
        target: "gym-create",
        at: "/gyms?list=1",
        title: "建一個道館",
        body: "只要填館名。建的人就是管理員，之後可以把別人也升成管理員（最後一位管理員動不了，免得整館沒人管）。",
        advance: { on: "next" },
      },
      {
        target: "invite-codes",
        at: "gym:/members",
        title: "把人找進來",
        body: "標題旁邊有兩組碼。成員碼佔 20 人名額；顧問碼進來是唯讀，不佔名額。對方只要貼上碼就加入，名字用他自己設定的。",
        advance: { on: "next" },
      },
      {
        target: "gym-pairs-row",
        at: "gym:/members",
        title: "選出全館要練的拍組",
        body: "點「全館拍組」看看 —— 裡面點灰卡就能把它設成道館拍組（★），大家的「道館重點拍組」分頁就會跟著出現。",
        advance: { on: "click" },
      },
    ],
  },
  {
    id: "member",
    title: "我是成員",
    hint: "我要管理拍組資訊",
    next: "battle",
    steps: [
      {
        target: "nav-pairs",
        at: "/pairs",
        title: "先去「拍組」",
        body: "你自己點點看 —— 桌機在上面那排，手機在螢幕最下面。這一頁只有你自己的資料。",
        advance: { on: "path", path: "/pairs" },
      },
      {
        target: "pair-card",
        at: "/pairs",
        title: "點一張卡看看",
        body: "任何一張都可以，沒有的灰卡也點得開。",
        advance: { on: "appear", target: "side-panel" },
        practice: true,
      },
      {
        target: "side-panel",
        at: "/pairs",
        title: "這裡設星數與寶數",
        body: "星數只能從原始星級升到 6★EX。寶數與超覺醒是同一條軸：未持有 → 寶1-5 → 超覺醒1-5。這一段是練習，改了不會存檔。",
        advance: { on: "next" },
        practice: true,
        extra: {
          ifTarget: "gym-pair-toggle",
          body: "你這裡還有一顆「☆ 設為道館拍組」—— 那是給整館看的名單（★），不是你自己的練度。設進去之後，所有人的「道館重點拍組」分頁都會出現這一組，還會統計全館幾個人有。只有管理員與編輯者看得到這顆。",
        },
      },
      {
        target: "pair-card",
        region: "corner",
        title: "換你試試：點卡片左下角",
        body: "不用開側板也能調寶數 —— 寶1 → 寶5 → 超覺醒1 → 超覺醒5 → 歸零。一整排調練度用這個最快。",
        advance: { on: "click" },
        practice: true,
        at: "/pairs",
      },
      {
        target: "pairs-tabs",
        at: "/pairs",
        title: "兩個子分頁 + 一個開關",
        body: "道館重點拍組＝館裡指定要練的；所有遊戲拍組＝全圖鑑。右邊的「只看我持有的」是另一件事，關掉時沒有的會顯示成灰卡。",
        advance: { on: "next" },
      },
      {
        target: "nav-gyms",
        at: "/gyms",
        title: "想看別人有什麼？點「道館」",
        body: "「拍組」只有你自己的資料。要看館內其他人練到哪，在道館的「成員與拍組」。",
        advance: { on: "path", path: "/gyms" },
      },
      {
        target: "member-row",
        at: "gym:/members",
        title: "點任何一位成員",
        body: "右邊就會列出他的持有拍組與練度。第一項的「全館拍組」則是整館的 ★ 名單加持有率 —— 誰還缺哪一張一眼看得出來。",
        advance: { on: "click" },
      },
      {
        target: "nav-resources",
        at: "/resources",
        title: "最後：我的資源",
        body: "糖果庫存記在這裡，另外可以複選「想投入資源的屬性」與「已投入較多資源的屬性」，安排道館戰的人看得到。",
        advance: { on: "next" },
      },
    ],
  },
  {
    id: "battle",
    title: "道館戰怎麼跑",
    hint: "出刀、挑戰券、看板",
    steps: [
      {
        target: "gym-tab-battles",
        at: "gym:/battles",
        title: "道館戰在這個分頁",
        body: "點看看。賽事一覽在這裡，管理員可以開新的一場。",
        advance: { on: "path", path: "/battles" },
      },
      {
        target: "battle-card",
        at: "gym:/battles",
        title: "狀態是算出來的，不是設定的",
        body: "籌備中／進行中／已結束一律由賽期日期推導，沒有手動下拉。「目前輪」也是從已回報的紀錄推出來的。",
        advance: { on: "next" },
      },
      {
        at: "gym:/battles",
        title: "挑戰券是「剩餘 ／ 上限」",
        body: "預設 30/30 往下扣。你在看板上回報出刀，券會自動扣 —— 登記跟統計是同一個動作，不用另外記。",
        advance: { on: "next" },
      },
    ],
  },
];

export function trackDef(id: TourTrack): TourTrackDef {
  return TRACKS.find((t) => t.id === id)!;
}

export function stepsFor(id: TourTrack): TourStep[] {
  return trackDef(id).steps;
}

/** 選擇卡上列出的路 —— 道館戰是走完成員那條之後才問, 不放在一開始 */
export const CHOOSABLE: TourTrack[] = ["leader", "member"];

/** `at` 裡的 `gym:` 前綴換成真的道館網址; 沒有道館就回 null (那一步不提供「幫我開」) */
export function resolveAt(at: string | undefined, gymId: string | null): string | null {
  if (!at) return null;
  if (!at.startsWith("gym:")) return at;
  return gymId ? `/gyms/${gymId}${at.slice(4)}` : null;
}
