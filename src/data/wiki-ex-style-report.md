# EX Style 抓取與比對報告

> 來源: [Pokémon Masters EX Wiki](https://pokemon-masters-ex-game.fandom.com/wiki/6%E2%98%85_EX) — 6★ EX 頁面 + Sync Pairs/List
> 產生時間: 2026-09-01T02:26:08.250Z

## 抓取統計 (wiki 權威值)

| 項目 | 數量 |
| --- | ---: |
| 名冊總數 (roster) | 660 |
| 可達 6★ EX | 633 |
| └ **有 EX style (換裝)** | **458** |
| └ 無 EX style (僅升招) | 175 |
| 有 EX role | 366 |

## 與 pomatools 既有資料比對

| 項目 | 值 |
| --- | ---: |
| wiki roster ↔ pomatools 對上 | 643/660 |
| 主角拍組 (pomatools 不收錄) | 17 |
| 其他對不上 | 0 |
| pomatools 原 hasSixEx 為真 | 303 |
| **hasSixEx 修正後為真 (wiki 權威)** | **631** |

**關鍵發現**: pomatools 的 `hasSixEx` 與 `hasExRole` 同為 303, 實際上只追到 *EX role* 解鎖, 嚴重低估真正可達 6★ EX 的數量 (wiki: 598)。本次以 wiki 為準補正, 並新增 `hasExStyle` 欄位 (pomatools 原本完全沒有)。

## pomatools 補正後最終覆蓋

| 項目 | 值 |
| --- | ---: |
| pomatools 紀錄總數 | 653 |
| 直接由 wiki 補正 | 642 |
| 重複紀錄繼承手足 (wiki-sibling) | 1 |
| **hasExStyle 欄位覆蓋** | **653/653** |
| └ hasExStyle = true | 457 |
| hasSixEx = true (補正後) | 631 |
| 仍未覆蓋 (wiki 無此筆) | 10 |

### 仍未覆蓋的 10 筆 (wiki 不收錄)

多為主角學園共用 kit 變體 (19999 系) 與遊戲原創角色, fandom wiki 未列為獨立拍組:

- Parker & Cottonee (10074000000)
- Lillie & Squirtle (19999000009)
- Rosa & Bulbasaur (19999000010)
- Lillie & Totodile (19999000012)
- Rosa & Cyndaquil (19999000013)
- Lillie & Prinplup (19999000015)
- Lillie & Kommo-o (19999000022)
- Rosa & Hydreigon (19999000023)
- Dawn & Togepi (19999000026)
- Ethan & Togepi (19999000027)

## 無 EX style 的 6★ EX 拍組 (共 175 隻, wiki 標 \*)

這些拍組可達 6★ EX (升級沙招) 但沒有換裝立繪:

- Lt. Surge and Raichu
- Erika and Tangela
- Karen and Umbreon
- Zinnia and Salamence
- Morty and Mismagius
- Bugsy and Scyther
- Rosa and Dewott
- Blue and Exeggutor
- Cynthia and Gastrodon
- Silver and Feraligatr
- Lillie and Comfey
- N and Sigilyph
- May and Wailmer
- Professor Sycamore and Bulbasaur
- Marnie and Toxicroak
- Janine and Crobat
- Candice and Froslass
- Sophocles and Golem
- Clemont and Magneton
- Raihan and Gigalith
- Elesa and Joltik
- Kris and Jolteon
- Lyra and Vaporeon
- Lucas and Flareon
- Serena and Fletchling
- Dawn and Wormadam
- Morty and Gastly
- Gloria and Thwackey
- Steven and Cradily
- Lorelei and Cloyster
- Bruno and Onix
- Acerola and Banette
- Agatha and Arbok
- Lance and Dragonair
- Adaman and Vaporeon
- Irida and Flareon
- Kiawe and Arcanine
- Mallow and Shiinotic
- Calem and Fennekin
- Victor and Spectrier
- Barry and Roserade
- Olivia and Carbink
- Valerie and Mawile
- Falkner and Pidgeot
- Leaf and Clefable
- Giovanni and Rhydon
- Giovanni and Nidorino
- Thorton and Magnezone
- Noland and Ninjask
- Red and Venusaur
- Gladion and Golbat
- Selene and Umbreon
- Elio and Espeon
- Jasmine and Magnemite
- Volkner and Raichu
- Wally and Delcatty
- Falkner and Noctowl
- Skyla and Unfezant
- Volo and Gible
- Blue (Classic) and Charizard
- Rika and Whiscash
- Guzma and Ariados
- Plumeria and Gengar
- Cheren and Purrloin
- Wally and Altaria
- Gladion and Weavile
- Marnie and Scrafty
- Hugh and Unfezant
- Nemona and Lycanroc
- Kabu and Torkoal
- Blue and Alakazam
- Iono and Wattrel
- Professor Oak and Nidorino
- Will and Slowbro
- Cheryl and Wailord
- Lusamine and Lilligant
- Lillie (Anniversary 2024)
- Rose and Perrserker
- Leaf and Blastoise
- Lance and Kingdra
- Silver and Crobat
- Rachel and Gimmighoul
- Sawyer and Gimmighoul
- Barry and Floatzel
- Lear and Krookodile
- Shauna and Delcatty
- Tierno and Talonflame
- Hilbert and Glaceon
- Hilda and Leafeon
- Calem and Sylveon
- Cheren and Liepard
- Arven and Nacli
- Marnie and Cinderace
- Hop and Rillaboom
- Bede and Inteleon
- Lana and Lanturn
- Hop and Pincurchin
- Lucas and Torterra
- Brock and Kabutops
- Winona and Altaria
- Grusha and Beartic
- Diantha and Tyrantrum
- Shauna and Sylveon
- Clavell (Alt.)
- Steven and Skarmory
- Marnie and Liepard
- Hop and Zacian
- Iono and Kilowattrel
- Brendan and Swellow
- Hau and Crabominable
- Ethan and Ho-Oh
- Bianca and Chandelure
- Lacey and Alcremie
- Cynthia and Spiritomb
- Florian and Lechonk
- Whitney and Wigglytuff
- Korrina and Hawlucha
- Dawn and Empoleon
- N and Archeops
- Larry and Oinkologne
- Kabu and Ninetales
- Grimsley (Kimono) and Absol
- Iris and Druddigon
- Bede and Mawile
- Gordie and Barbaracle
- Melony and Frosmoth
- Leon and Seismitoad
- Main Character and Pikachu
- Roxie and Garbodor
- Fantina and Dusknoir
- Lusamine and Milotic
- Lana and Cloyster
- Phoebe and Sableye
- Flint and Rapidash
- Thorton and Regigigas
- Brycen and Walrein
- Bea and Hitmontop
- Nemona and Quaxly
- Juliana and Sprigatito
- Florian and Fuecoco
- Barry and Infernape
- Carmine and Swadloon
- Hilbert and Thundurus
- Hilda and Tornadus
- N and Landorus
- Piers and Skuntank
- Penny and Eevee
- Chase and Eevee
- Hilda and Mienfoo
- Lance and Charizard
- Elio and Decidueye
- Ball Guy and Voltorb
- Grimsley and Honchkrow
- Misty and Golduck
- Ingo and Boldore
- Arven and Skwovet
- Hau and Incineroar
- Emmet and Gurdurr
- Rika and Great Tusk
- Poppy and Iron Treads
- Akari and Mime Jr.
- Hau and Tauros
- Juliana and Chimecho
- Whitney and Girafarig
- Selene and Primarina
- Kahili and Mandibuzz
- Nessa and Barraskewda
- Aaron and Dustox
- Jacq and Mudsdale
- Brendan and Salamence
- Ethan and Gyarados
- Leaf and Beedrill
- Urbain and Avalugg
- Cynthia and Glaceon
- Cyrus and Weavile
