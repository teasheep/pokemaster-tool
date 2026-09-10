// 使用教學的三條路。
//
// 2026-09-07 使用者要求整個改成**互動式**:
//   「讓使用者點一下試試看, 不用幫他切頁面, 讓他自己點、自己點開側板、自己加寶數,
//     教學完以後再還給使用者自行控制」
// 所以每一步不再是「看我示範」而是「換你做一次」——
//   - **教學不會替使用者換頁**。要去別頁的那幾步是框住導覽列上的入口, 等他自己點;
//     人不在那一頁時整張卡改成「指路」(見檔尾 wayTo), 走到了才換回這一步本身。
//   - **整段教學期間, Supabase 的寫入一律被吞掉** (lib/supabase/tour-writes.ts) ——
//     畫面照變但不進資料庫, 連「建立賽事」也一樣。教學不留任何資料。
//   - 每一步自己說「什麼時候算做完」(advance), 做完了框會閃一下綠色再往下走。
//
// 內容一律講站內真的有的規則, 而且優先講「不講就沒人會發現」的事。

export type TourTrack = "leader" | "member" | "battle" | "leader2";

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
  /**
   * 這一步是**分叉**: 問一個是非題, 兩顆一樣大的鈕 (與收尾卡的「不用了 / 繼續看」同一套,
   * 不是一顆主鈕配一行小字)。
   *
   * 用在「你有沒有建館碼」: 沒有的人再往下走也只會撞牆 —— 建館對話框會擋他,
   * 那不如在第一步就講清楚, 而且給他一個能做的事。
   */
  gate?: {
    yes: string;
    no: string;
    /** 選「沒有」之後的終點卡 (顯示完就結束教學) */
    denied: {
      title: string;
      body: string;
      /** 給他一個能做的事 —— 按鈕是動作, 不是又一行說明 */
      action?: { label: string; to: string };
    };
  };
};

export type TourTrackDef = {
  id: TourTrack;
  title: string;
  hint: string;
  steps: TourStep[];
  /** 走完之後可以順著問「要不要再看這一段」 */
  next?: TourTrack;
  /**
   * 這一段的終點不是收尾卡, 而是**先去做一件真的事**, 做完了才接上 `resume` 那一段。
   *
   * 為什麼要有這個: 教學開著時所有寫入都被吞掉 (RPC 一律回錯誤), 所以「在教學裡建道館」
   * 本來就不可能成立。使用者 2026-09-09 指定的順序是「他填了、建了道館(實際資料),
   * 才開始後續的教學」—— 那唯一自洽的做法就是**先結束教學**, 讓他真的去建。
   */
  handoff?: { label: string; resume: TourTrack };
};

export const TRACKS: TourTrackDef[] = [
  {
    id: "leader",
    title: "我是道館負責人",
    // 選擇卡上就講清楚要什麼 —— 不然是走了幾步之後才發現自己做不到
    hint: "我要建立道館（需要建館碼）",
    handoff: { label: "我去建", resume: "leader2" },
    steps: [
      {
        // 純說明卡 (沒有 target): 這一步問的是「你有沒有碼」, 畫面上沒有東西好框
        title: "先確認一件事",
        body: "建立道館目前為封測，需要作者提供的建館碼，一組只能用一次。",
        advance: { on: "next" },
        gate: {
          yes: "我有建館碼",
          no: "我沒有",
          denied: {
            title: "建立道館目前為封測",
            // 文案是使用者指定的原話。**不要在這裡寫信箱或 GitHub** ——
            // 那兩個留給懂程式的人自己從隱私權政策/服務條款找 (使用者 2026-09-09 指定)。
            body: "目前該功能封測中，請在賴群聯絡作者取得建館碼。",
            action: { label: "先去記我的拍組", to: "/pairs" },
          },
        },
      },
      {
        target: "gym-create",
        at: "/gyms?list=1",
        title: "拿到碼之後就從這裡開始",
        body: "填館名與建館碼。建的人就是管理員，之後可以把別人也升成管理員（最後一位管理員動不了，免得整館沒人管）。教學先停在這裡 —— 道館真的建好了，後面那幾步才有東西可以看。",
        advance: { on: "next" },
      },
    ],
  },
  {
    // 建好道館之後自動接上的續集 (不在 CHOOSABLE — 沒有道館的人選了也沒東西可看)。
    // 觸發條件在 tour-runner: 落地在某個道館的成員頁 + 自己是那一館的管理員。
    id: "leader2",
    title: "道館建好了",
    hint: "把人找進來、選出全館要練的拍組",
    next: "battle",
    steps: [
      {
        target: "invite-codes",
        at: "gym:/members",
        title: "把人找進來",
        // 2026-09-10 起貼碼只是**送出申請** (0071) —— 碼有可能被轉傳出去,
        // 而舊制是「進來以後再踢, 但館內資料已經被看光了」。這一步一定要講,
        // 不然管理員發完碼就會以為人已經進來了, 而對方在門外等著沒人理。
        body: "標題旁邊有兩組碼。成員碼佔 20 人名額；顧問碼進來是唯讀，不佔名額。對方貼上碼之後會出現在名冊最上面的「待確認加入」，你按綠色勾勾他才看得到館內資料 —— 碼被轉傳出去也不會有人直接看光全館。",
        advance: { on: "next" },
        extra: {
          ifTarget: "pending-requests",
          body: "現在就有人在等了 —— 綠色勾勾放行，叉叉拒絕（叉叉要按兩下）。拒絕之後他要重新貼一次碼才能再申請。",
        },
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
      },
      {
        target: "side-panel",
        at: "/pairs",
        title: "這裡設練度",
        // 2026-09-10 起未持有時只有寶數那一格能動 (其餘灰掉), 所以文案要先講「先設寶數」——
        // 不然使用者照著標題去點星數, 會發現點不動而以為壞了。
        body: "寶數與超覺醒是同一條軸：未持有 → 寶1-5 → 超覺醒1-5。先把寶數設起來，星數、等級、拍檔石盤那幾格才會亮；沒有這張卡的時候它們是鎖住的。放心改，教學期間什麼都不會存進資料庫。",
        advance: { on: "next" },
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
        body: "右邊就會列出他的持有拍組與練度。第一項的「全館拍組」則是整館的 ★ 名單加持有率 —— 誰還缺哪一張一眼看得出來。剛貼完邀請碼的話這一頁還打不開：要等管理員在名冊上按確認，你的申請才會變成正式成員。",
        advance: { on: "click" },
        // 手機/平板的名冊收在 bottom sheet 裡, 沒打開就框不到任何東西 (member-row 不存在)。
        // member-picker 只在 < lg 看得見, 所以這段補充只會出現在需要的人眼前。
        extra: {
          ifTarget: "member-picker",
          body: "手機上名冊收起來了 —— 先點上面那條「切換」把成員清單打開, 再點一位。",
        },
      },
      {
        target: "nav-resources",
        at: "/resources",
        title: "最後：我的背包",
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
        // 從「建立賽事」開始 (使用者:「那就從建立賽事開始阿」)。
        // 人不在道館戰那一頁時, wayTo 會先框「道館戰」分頁把他帶過來 —— 不必為此多一步。
        target: "battle-create",
        at: "gym:/battles",
        title: "開一場道館戰",
        body: "管理員用右上角的「建立賽事」開一場。裡面可以直接套用模板 —— 遊戲每一回的 8 關弱點屬性是固定的，選「第一次／第二次／第三次」就一次填好，不用建立完再一格一格點。（教學期間按下去不會真的建立，看看裡面長怎樣就好。）",
        advance: { on: "next" },
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

// ── 不在那一頁的時候: 指路, 不是幫他開 ──
//
// 2026-09-07 使用者:「你應該要指引使用者點哪裡可以連到那頁, 不是『幫我開』跟加一行廢話。
// 如果他不在那一頁, 那就從 header 點進那一頁開始, 之後使用者才知道去哪裡開。手機也是。」
//
// 所以: 步驟要框的東西不在畫面上時, **改成框「進去那一頁的入口」**, 等他自己點。
// 教學的價值就是讓人記得路怎麼走 —— 幫他開等於把那一段學習拿掉。
//
// wayTo 回的是一串**由內而外**的候選 (最靠近目的地的排前面), 由 runner 挑
// 第一個「現在真的看得見」的來框:
//   - 道館分頁只有進到某個道館之後才存在 → 人在 /pairs 時自動落到「道館」那一格;
//   - 「加入 / 建立道館」藏在道館切換器的選單裡 → 選單沒開就先框切換器本身。
// 同一個 data-tour 在桌機 (header) 與手機 (底部導覽列) 各有一份, findTarget 只挑
// 看得見的那個, 所以手機自動框到底部那排, 不必為手機另寫一套。

/**
 * 指路的一站。`to` = 點下去會到哪一頁 —— 用來擋掉「指回使用者已經在的那一頁」。
 *
 * 前科 (2026-09-08): 人停在 `/gyms` 而這一步的目標在 `/gyms/<id>/members` 時,
 * 候選鏈會退到最外層的「道館」那一格 —— 框住他剛剛才點過、而且現在就站在上面的入口,
 * 再點一次網址不變、畫面不變, 那一步永遠完成不了。有 `to` 就能跳過這種沒有意義的一站,
 * 降級成置中說明卡 (至少看得完內容, 也有「跳過這步」)。
 */
export type TourHop = { target: string; title: string; body: string; to?: string };

const HOP = {
  pairs: {
    target: "nav-pairs",
    to: "/pairs",
    title: "先進「拍組」",
    body: "框起來的就是入口 —— 桌機在最上面那排、手機在螢幕最下面那排。點它。",
  },
  gyms: {
    target: "nav-gyms",
    to: "/gyms",
    title: "先進「道館」",
    body: "框起來的就是入口 —— 桌機在最上面那排、手機在螢幕最下面那排。點它。",
  },
  resources: {
    target: "nav-resources",
    to: "/resources",
    title: "先進「我的背包」",
    body: "框起來的就是入口 —— 桌機在最上面那排、手機在螢幕最下面那排。點它。",
  },
  tabMembers: {
    target: "gym-tab-members",
    title: "切到「成員與拍組」",
    body: "道館裡面有三個分頁，這是第一個。",
  },
  tabBattles: {
    target: "gym-tab-battles",
    title: "切到「道館戰」",
    body: "道館裡面有三個分頁，道館戰在中間那個。",
  },
  switcher: {
    target: "gym-switcher",
    title: "點道館名稱打開切換器",
    body: "「加入 / 建立道館」藏在這個選單裡 —— 已經有道館的人要從這裡再開一個。",
  },
  switcherAdd: {
    target: "gym-switcher-add",
    title: "選「加入 / 建立道館」",
    body: "選單最下面那一項。",
  },
} as const satisfies Record<string, TourHop>;

/** 目的地在哪一頁 → 進去的路 (由內而外)。呼叫端挑第一個看得見的。 */
export function wayTo(at: string): TourHop[] {
  if (at.startsWith("/pairs")) return [HOP.pairs];
  if (at.startsWith("/resources")) return [HOP.resources];
  if (at.startsWith("/gyms")) {
    const chain: TourHop[] = [];
    if (at.includes("list=1")) chain.push(HOP.switcherAdd, HOP.switcher);
    else if (at.endsWith("/battles")) chain.push(HOP.tabBattles);
    else if (at.endsWith("/members")) chain.push(HOP.tabMembers);
    chain.push(HOP.gyms);
    return chain;
  }
  return [];
}

/** 現在就在那一頁嗎 (只比路徑, 不比查詢字串; 一律精確比對 —— 進到某個道館不算「在道館列表」) */
export function onPage(pathname: string, at: string): boolean {
  return pathname === at.split("?")[0];
}
