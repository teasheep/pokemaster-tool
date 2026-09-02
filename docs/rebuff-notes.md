# 降抗 (屬性抵抗 / Type Rebuff) — 重做前的調查筆記

2026-08-16。舊的降抗**數值**已從程式移除 (見下方「已經拔掉什麼」)，這份筆記留著，
等重新設計時直接用。

## 遊戲裡實際是什麼

官方繁中用語是**「屬性抵抗」**(EN: Type Rebuff)。降低對手的「◯屬性抵抗」= 全隊打那個屬性
的傷害變高；提高我方的則是防禦向。敘述長這樣 (官方原文)：

- 全體：`首次上場時，會降低對手全體拍組的龍屬性抵抗1階段。` (阿爾套裝阿渡「龍之制裁」)
- 單體：`首次使出招式攻擊成功時，會降低對手的妖精屬性抵抗1階段。` (牡丹 & 仙子伊布)
- 依弱點：`首次使出招式攻擊成功時，會降低對手的弱點屬性的屬性抵抗1階段。` (青木 & 土龍節節)
- 依招式：`降低的屬性抵抗與使出的拍組極巨化招式的屬性相同。` (小優競技服、大麗)
- 清單型：`首次使出拍組招式時，會分別降低對手全體拍組的下列所有屬性抵抗1階段。・一般・火…`
  (小驅 & 伊布，9 個屬性)

所以一條降抗效果至少要記四件事：**屬性**(固定/依弱點/依招式)、**範圍**(對手全體 / 對手單體)、
**階數**、**觸發時機**(首次上場 / 首次攻擊命中 / 首次拍組招式命中 / 每次攻擊命中 / 使出此招式)，
外加**來源**(被動 / 招式 / 能力盤格子——能力盤的要花能量，不是每個人都點)。

## 資料哪裡來

`https://pomatools.github.io/assets/data/` 底下就是遊戲內文字與結構：

| 檔案 | 內容 |
|---|---|
| `pairs.json` | 每組拍組的 move ids / passive ids (含各形態) |
| `moves.json` / `skills.json` | 招式與被動的結構 (kind: MV 招式 / SN 拍組招式) |
| `pairgrids.json` | 能力盤格子 (含 `skill` id、`orbs` 能量、`value`) |
| `i18n/zh.json` | **官方繁中**名稱與敘述 (`DATA.MOVES` / `DATA.SKILLS` 的 `NAME`/`DESC`) |

`{{value}}` 由 `pairs.json` 的 skill 第二個值 (被動) 或格子的 `value` (能力盤) 代入。
與本站 catalog 的對照用「訓練家編號+變體 → 形態 id」，對不到再退回英文名比對
(同 `scripts/patch-pomatools-meta.mjs` 的規則)。

## 這次抽出來的結果

- **47 組拍組 / 69 條降抗效果**：對手全體 29、單體 40；階數幾乎都 1
  (白露冠軍 2、小優競技服 2、小青週年慶 3)；來源 被動 47 / 招式 16 / 能力盤 6。
- 只有點能力盤才有降抗的 3 組：阿修(學院)&炒炒豬、小優&蒼響、小春&愛吃豚。
- 與道館舊登記 (member_debuffs, 35 組) 對照：**26 組一致**、
  **9 組其實不是降抗**(伊布家族那批是「領域/場地」，卡露妮是「妖精屬性威力提升」，也慈是劇毒領域)、
  **21 組是新找到的**(多為阿爾套裝的「◯之制裁」，一上場降對手全體)。
- 舊資料的 3 / 6 / 7 這些數字在遊戲裡沒有對應物。

### 盲區

pomatools 收錄到 588/645 組，沒收的多是 2026 年新拍組。其中
**阿爾套裝卡露妮 & 沙奈朵 (10158900000, 2026-07-18)** 與
**阿爾套裝也慈 & 晶光花 (10295900000, 2026-07-19)** 要注意：道館舊資料裡的「卡露妮 妖精」
「也慈 毒」很可能講的是這兩隻新的，但 pair_id 記在 2021/2024 年的舊版上。

要補齊新拍組得改吃 brybry datamine (`https://pokemon.brybry.ch/masters/data/`)：
`lsd/passive_skill_description_zh-TW.json` 是模板參照，要再接
`passive_skill_description_parts_zh-TW.json` 與 `proto/MoveAndPassiveSkillDigit.json`
組字，且屬性名是 `[Name:ReferencedMessageTag]` — 比 pomatools 多一層工。

## 已經拔掉什麼 (2026-08-16)

程式**不再讀** `member_debuffs`：

- `lib/gym/assign.ts` — 拿掉「降抗先手 (每關 1 人 1 券)」階段與 R1-3 的降抗手優先排序；
  `AssignmentSuggestion` 不再有 `role`，一律主力券數。
- `battles/[battleId]/*` — 不再抓 member_debuffs；看板拿掉「＋降抗」派人選單與「降抗手」標記。
  (舊資料裡 `stage_assignments.role = 'debuff'` 的列仍照原樣顯示，不改寫別人的紀錄。)
- `lib/gym/aggregate.ts` / `components/gym/type-matrix.tsx` — 屬性戰力矩陣先拿掉紅黃綠燈號
  (`lightOf` / `LightDot` / `debuffSum` 全刪)，只留主打手分數。

緊接著 (同日) 使用者要求連整個「全體屬性戰力」面板也先收掉，之後要再加 →
`type-matrix-panel.tsx` / `type-matrix.tsx` / `aggregate.ts(+test)` / `TypeCell` 一併刪除，
`/gyms/[id]` 現在只有賽事一覽。要復原：`git show 73c2c1a` 是拔掉燈號後的版本，
`git show 73c2c1a~1` 是含燈號的原版。

**後續 (2026-08-17)**：使用者明訂「ref 只是 input, 系統不要存 ref 才有的資訊」→ 0039 把
`member_debuffs` / `member_type_scores` / `gym_pair_tags` / `strategy_pairs` 四張表與
`gym_pairs.tag`/`source_kind` 兩欄整批 drop (資料備份在 ref/archive-ref-tables-2026-08-17.json)。
重做降抗時資料一律從遊戲文字重抽 (上面「資料哪裡來」那節), 不要回去讀舊表。

分析用的腳本與 JSON 在該次工作階段的 scratchpad (`extract-rebuff4.mjs` / `rebuff4.json` /
`compare-rebuff.mjs`)，確認頁：<https://claude.ai/code/artifact/0bb2f581-a15a-4c80-8092-e0cca580fb56>
