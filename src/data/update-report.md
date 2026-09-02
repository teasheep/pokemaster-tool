# 拍組資料更新報告

_2026-09-01 更新 (`npm run data:update:fast` + 修 3 個管線問題後重跑後段)。_

- catalog: 645 → 664 隻
- 新增 19 ・ 移除 0 ・ 欄位變動 17 (追蹤 20 個欄位)
- embedding: 620 筆 (catalog 中 48 隻尚無 embedding — 這次跑 --skip-embeddings)
- **對外不送 17 筆**: 10 筆來源未收錄 + 7 筆尚未上架 (判準見 `lib/pairs/loader.ts` 的 isUnreleasedPair)

> **series=upcoming** = pomatools 還沒收錄的新拍組 (「未分類」, 不是系列)。
> 這類拍組的資料之後可能還會變動; 等來源補上時下次更新會自動校正。
> 交叉驗證細節見 `db-reconcile-report.md`; EX 校正見 `wiki-ex-style-report.md`。

## 新增拍組

| pairId | 拍組 | 上架日 | 系列 | 來源 | 對外 |
| --- | --- | --- | --- | --- | --- |
| 10017000003 | 葉子 & 大針蜂 | 2026-09-01 | upcoming | wiki | ✓ |
| 10019000002 | 小悠 & 暴飛龍 | 2026-09-01 | upcoming | wiki | ✓ |
| 10021400000 | 青綠（2026週年慶） & 快龍 | 2026-08-28 | exmaster | wiki | ✓ |
| 10058000001 | 卡希麗 & 禿鷹娜 | 2026-08-28 | upcoming | wiki | ✓ |
| 10091000003 | 竹蘭 & 冰伊布 | 2026-09-12 | upcoming | wiki | ⛔ 尚未上架 |
| 10112000002 | 阿響 & 暴鯉龍 | 2026-09-01 | upcoming | wiki | ✓ |
| 10116900000 | 小光（冠軍） & 帕路奇亞 | 2026-09-12 | upcoming | wiki | ⛔ 尚未上架 |
| 10130410000 | 莎莉娜（2026週年慶） & 甲賀忍蛙 | 2026-08-28 | exmaster | wiki | ✓ |
| 10152000001 | 阿柳 & 毒粉蛾 | 2026-08-28 | upcoming | wiki | ✓ |
| 10162900000 | 明輝（冠軍） & 帝牙盧卡 | 2026-09-14 | upcoming | wiki | ⛔ 尚未上架 |
| 10194000001 | 赤日 & 瑪狃拉 | 2026-09-16 | upcoming | wiki | ⛔ 尚未上架 |
| 10201000000 | 神代 & 急凍鳥 | 2026-08-28 | master | wiki | ✓ |
| 10225000000 | 夥星 & 東施喵 | 2026-09-16 | upcoming | wiki | ⛔ 尚未上架 |
| 10226000000 | 歲星 & 坦克臭鼬 | 2026-09-16 | upcoming | wiki | ⛔ 尚未上架 |
| 10227000000 | 鎮星 & 毒骷蛙 | 2026-09-16 | upcoming | wiki | ⛔ 尚未上架 |
| 10249000001 | 露璃娜 & 戽斗尖梭 | 2026-08-28 | upcoming | wiki | ✓ |
| 10298000001 | 吉尼亞 & 重泥挽馬 | 2026-08-28 | upcoming | wiki | ✓ |
| 10367000001 | 蓋伊 & 冰岩怪 | 2026-09-01 | upcoming | wiki | ✓ |
| player-poipole | 主角 & 毒貝比 | 2026-08-28 | master | wiki | ✓ |

## ✏️ 欄位變動 (既有拍組)

- **鬥子（禮服） & 蒂安希** (10004400000) — exRoleName: null → "Tech"; exRole: null → "ROLE_004"; hasExRole: false → true
- **小悠 & 木守宮** (10019000000) — releaseDate: null → "2019-08-29"
- **麗姿 & 鬃岩狼人** (10051000000) — releaseDate: null → "2019-08-29"
- **默丹 & 貓老大** (10056000000) — releaseDate: null → "2019-08-29"
- **哈烏 & 雷丘** (10098000000) — releaseDate: null → "2019-08-29"
- **小照 & 魔尼尼** (10291000001) — series: "upcoming" → "general"
- **美極套裝烏栗 & 大尾立** (10357100000) — series: "general" → "exmaster"; pairKind: "none" → "exmaster"
- **主角 & 霜奶仙** (player-alcremie) — pairKind: null → "none"; acquisitions: null → ["event"]
- **主角 & 爆肌蚊** (player-buzzwole) — pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 勾帕路翁** (player-cobalion) — releaseDate: "2021-05-27" → "2021-05-31"; pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 艾姆利多** (player-mesprit) — pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 皮卡丘** (player-pikachu) — pairKind: null → "none"; acquisitions: null → ["story"]
- **主角 & 雷公** (player-raikou) — pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 雷吉洛克** (player-regirock) — releaseDate: "2021-05-27" → "2021-05-31"; pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 雷吉斯奇魯** (player-registeel) — pairKind: null → "master"; acquisitions: null → ["bp"]
- **主角 & 索爾迦雷歐** (player-solgaleo) — pairKind: null → "none"; acquisitions: null → ["legendary"]
- **主角 & 火稚雞** (player-torchic) — releaseDate: "2019-11-07" → "2019-11-06"; pairKind: null → "none"; acquisitions: null → ["story"]
