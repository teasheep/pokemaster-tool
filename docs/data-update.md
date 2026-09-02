# 新拍組資料更新流程

新拍組推出時, 用這套流程把資料更新進系統。核心原則是 **多來源交叉驗證, 不依賴單一網頁以免出錯**。

## 一鍵更新 (互動式)

```bash
npm run data:update         # 抓 → 列出新增拍組 → 問你「同意嗎? [Y/n]」→ 是才重算 embedding
npm run data:update:fast    # 同上但略過 embedding (快速預覽)
npm run data:update -- --yes  # 不問, 直接套用 (自動化 / CI)
```

預設流程是**自動抓 + 跑完問你是否同意**:

1. 自動抓主目錄 + 三方交叉驗證 (還不重算 embedding)。
2. 終端機列出「這次新增了哪些拍組」+ 每隻的來源背書, 然後問:
   `同意套用以上更新嗎? 否則重新抓。[Y/n]`
   - **是** (或直接 Enter) → 重算 embedding → 寫報告 → 完成。
   - **否** → 重新抓 (回步驟 1)。要放棄就 Ctrl+C, 再 `git checkout -- src/data public/reference` 還原。
   - 只要選是/否, **不需要逐隻挑**。

> 非 TTY (CI/被 pipe) 或加 `--yes` 時不會問, 直接套用。

跑完後**先看報告再 commit**:

- `src/data/update-report.md` — 這次新增/移除/變動了哪些拍組 + 每個新拍組的多來源把關
- `src/data/db-reconcile-report.md` — 三方來源的矛盾欄位、候選新拍組、缺圖清單
- `src/data/wiki-ex-style-report.md` — 6★EX / EX style 校正明細

確認沒問題後:

```bash
git add -A && git commit -m "data: <新拍組名稱> 等 N 隻"
# 部署 (新拍組不需要動資料庫 — catalog 是 JSON, user_collection 只存 pairId)
```

## 資料來源 (為什麼不靠單一來源)

| 來源 | 負責 | 權重 | 網址 |
| --- | --- | --- | --- |
| **brybry** (datamine) | **主目錄 (權威)** — 決定有哪些拍組 + pairId + 圖檔命名 | 主 | `pokemon.brybry.ch/masters/data/proto/` |
| **pomatools** | 驗證 (清單交叉比對 + 圖源) | 3 | `pomatools.github.io/assets/data/pairs.json` |
| **Fandom Wiki** | 驗證 + 補完 6★EX / EX style / EX role / roster | 2 | `pokemon-masters-ex-game.fandom.com` |
| **Serebii** | 驗證 太晶 / 超覺醒 / 6★EX | 1 | `serebii.net/pokemonmasters/*.shtml` |

> **為什麼 brybry 是主目錄而非 pomatools**: committed catalog (`source:brybry`) 與
> `pair-embeddings.json` 的 pairId 都是 brybry 的 11 碼 id (例 `10000000000`), 圖檔也用
> brybry actor id (`ch0000_00_red_128.png`)。App 的 `user_collection` 存的就是這套 pairId。
> 改用 pomatools (另一套 12 碼 id) 會讓**所有人的收藏 + 既有 embedding + 圖檔**全部對不上。
> 所以 pomatools/wiki/serebii 只當「驗證來源」。

`reconcile-db.mjs` 會把 pomatools / wiki / serebii 對 catalog 交叉比對, 在**每一筆** record 寫上:

- `verifiedSources` — 有哪些來源確認了這隻拍組
- `confirm` — 每個布林欄位 (hasSixEx / tera / hasAwakening …) 由哪些來源確認為真
- 互相矛盾的欄位會列進 `db-reconcile-report.md`

## 流程做了什麼 (階段)

`npm run data:update` 依序跑 (先快照舊 catalog, 結尾產生 diff 報告):

0. **`fetch-brybry-proto.mjs`** — 從 brybry 抓最新的 6 個核心 datamine proto (Trainer/Monster/Move…)。
   **這是新拍組進入系統的源頭** (soft: brybry 掛掉就沿用本機既有 datamine)。
1. **`scrape-brybry.mjs`** — 用 brybry datamine 產生 catalog (`pomatools-pairs.json`) + 下載拍組圖。
2. **`scrape-wiki-exstyle.mjs`** — 從 Wiki 撈 EX/role/roster (soft)。
3. **`scrape-wiki-ex-portraits.mjs`** — 下載新 EX 立繪 (soft)。
4. **`enrich-pomatools-exstyle.mjs`** — 用 Wiki 校正 `hasSixEx` / `hasExStyle` / `exRoleName`。
5. **`reconcile-db.mjs`** — 對 pomatools + wiki + serebii 交叉驗證, 標 `verifiedSources` / 矛盾。
6. **`build-embeddings.mjs`** — 用新圖重算 `pair-embeddings.json` (截圖辨識要用; 同意後才跑)。

> **在地化名稱**: brybry 的名稱檔 (`trainer_name_* / monster_name_*`) 不在可抓的 proto 路徑下,
> 所以**全新訓練家**的拍組名可能先是 placeholder (既有訓練家的新拍組則正常, 因名稱已在本機檔)。
> 報告會標出; 之後可由 wiki/pomatools 補名或手動補。

## 多來源把關 (寬鬆模式)

目前是**寬鬆**: 單一來源確認的新拍組仍會納入, 但在 `update-report.md` 標 **⚠** 提醒你人工確認。
報告會針對每隻新拍組標出:

- `⚠ 僅 N 個來源背書` — 建議去對一下另一個來源再放行
- `⚠ 缺 embedding` — 代表缺圖, 這隻**暫時無法被截圖辨識**, 需補圖後重跑階段 6

想要更嚴 (新拍組未達 2 來源就擋下 `exit 1`):

```bash
npm run data:update -- --strict
```

## 常見狀況 / 旗標

| 情況 | 做法 |
| --- | --- |
| 只想先看「新增了什麼」 | `npm run data:update:fast` (略過 embedding) |
| Wiki / Serebii 暫時掛掉 | `node scripts/update-catalog.mjs --skip-wiki` (沿用既有 wiki 資料) |
| 新拍組缺圖 → 缺 embedding | 確認 `public/reference/{trainer,pokemon}/` 有圖; 必要時手動補圖再重跑 `node scripts/build-embeddings.mjs` |
| 想嚴格把關 | 加 `--strict` |

## 加一個新來源 (擴充)

要再加第四個來源 (例如 PokemonMastersDB / 官方公告) 提高準確度:

1. 在 `reconcile-db.mjs` 的 sources 設定加一筆 `{ name, weight, fetch, roster }`。
2. 實作該來源的 fetch + 名稱正規化 (對齊現有的 `normalize()` / alias map)。
3. 它會自動進入 `verifiedSources` / `confirm` 的交叉比對, 不需改其他地方。

## 建議節奏

- pomatools 通常在新拍組上線後**數小時**內更新; Wiki 約 **1–2 天**。
- 實務上: 新拍組當天先跑一次 `data:update:fast` 看到拍組進來 (可能先缺 EX 資料/圖),
  等 Wiki 更新後再跑完整 `data:update` 補齊 EX + embedding。

## 之後若要自動化

目前是手動一鍵。下一步可加一個 GitHub Action 每週 (或手動觸發) 跑 scrape + reconcile,
把 `update-report.md` 開成 PR 給你審核合併 — **永遠經人工覆核, 不自動上線**, 維持「以免出錯」的把關。
需要時再說, 我幫你接。
