// 使用教學的兩條路 (使用者指定): 「我是到館負責人 → 我要建立道館」與
// 「我是成員 → 我要管理拍組資訊」。
//
// 每一步指三件事: 要在哪一頁 (path)、要框哪個東西 (target = DOM 上的 data-tour)、
// 說什麼。**target 找不到就降級成置中的說明卡**, 步驟不會卡住 —— 這很重要, 因為
// 「我要建立道館」這條路的讀者通常**還沒有道館**, 後面那幾步要框的東西根本還不存在。
//
// 內容一律講站內真的有的規則 (邀請碼佔不佔名額、★ 怎麼設、點左下角循環寶數),
// 不要寫成行銷文案 —— 教學的價值在於講出「不講就沒人會發現」的那幾件事。

export type TourTrack = "leader" | "member";

export type TourContext = {
  /** 使用者的道館 (沒有就是 null — 後面幾步會自動降級成說明卡) */
  gymId: string | null;
};

export type TourStep = {
  /** DOM 上的 data-tour 值; 沒給 = 純說明卡 */
  target?: string;
  /** 只框目標的左下角 (拍組卡的寶數) */
  region?: "corner";
  title: string;
  body: string;
  /** 這一步要在哪一頁; 回 null = 留在原地 */
  path: (ctx: TourContext) => string | null;
};

export const TRACKS: { id: TourTrack; title: string; hint: string }[] = [
  { id: "leader", title: "我是到館負責人", hint: "我要建立道館" },
  { id: "member", title: "我是成員", hint: "我要管理拍組資訊" },
];

/** /gyms 在只有一個道館時會直接轉導進去 —— 要停在「建立/加入」那頁必須帶 list=1 */
const GYM_LIST = () => "/gyms?list=1";
const gymSub = (sub: string) => (ctx: TourContext) => (ctx.gymId ? `/gyms/${ctx.gymId}/${sub}` : null);

export const TOURS: Record<TourTrack, TourStep[]> = {
  leader: [
    {
      target: "gym-create",
      path: GYM_LIST,
      title: "建立道館",
      body: "只要填一個館名。建館的人就是管理員, 之後可以把其他人也升成管理員 (最後一位管理員動不了)。",
    },
    {
      target: "invite-codes",
      path: gymSub("members"),
      title: "把人找進來",
      body: "標題旁邊有兩組邀請碼。成員碼佔 20 人名額; 顧問碼加入後是唯讀顧問, 不佔名額。對方只要貼上碼就加入, 名字用他自己設定的。",
    },
    {
      target: "gym-pairs-row",
      path: gymSub("members"),
      title: "選出道館要練的拍組",
      body: "名冊第一項「全館拍組」列出道館指定的拍組與全館持有率。在那裡點灰卡就能把它設成道館拍組 (★), 大家的「道館重點拍組」分頁就會跟著出現。",
    },
    {
      target: "battle-create",
      path: gymSub("battles"),
      title: "開一場道館戰",
      body: "填賽期就好 —— 狀態 (籌備中/進行中/已結束) 由日期自己推導, 沒有手動開關。開好之後成員在看板上登記出刀, 挑戰券會自動扣。",
    },
  ],
  member: [
    {
      target: "gym-join",
      path: GYM_LIST,
      title: "加入道館",
      body: "跟館主要一組邀請碼, 貼上就加入 —— 只要填邀請碼, 名字是你「個人設定」裡的那組, 不用每個道館重填。",
    },
    {
      target: "nav-pairs",
      path: () => "/pairs",
      title: "你的拍組在這一頁",
      body: "「拍組」只有你自己的資料。別人持有什麼要去道館的「成員與拍組」看。",
    },
    {
      target: "pairs-tabs",
      path: () => "/pairs",
      title: "兩個子分頁 + 一個開關",
      body: "道館重點拍組 = 館裡指定要練的; 所有遊戲拍組 = 全圖鑑。右邊的「顯示全部 / 只看我持有的」是另一件事 —— 沒有的拍組會顯示成灰卡。",
    },
    {
      target: "pair-card",
      path: () => "/pairs",
      title: "點卡片 = 開設定側板",
      body: "側板裡設星數與寶數。星數只能從原始星級升到 6★EX, 灰卡 (沒持有的) 一樣點得開。",
    },
    {
      target: "pair-card",
      region: "corner",
      path: () => "/pairs",
      title: "點左下角 = 直接調寶數",
      body: "寶1 → 寶5 → 超覺醒1 → 超覺醒5 → 歸零。不用開側板, 一整排調練度用這個最快。",
    },
    {
      target: "nav-resources",
      path: () => "/resources",
      title: "糖果與資源方向",
      body: "糖果庫存記在這裡。另外可以複選「想投入資源的屬性」與「已投入較多資源的屬性」, 安排道館戰的人看得到。",
    },
  ],
};

export function stepsFor(track: TourTrack): TourStep[] {
  return TOURS[track];
}
