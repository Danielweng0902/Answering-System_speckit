# 廣播效能最佳化驗證｜2026-11-20

本輪依 `docs/verification/perf-audit-2026-11-20.md` 的優先序做純效能重構。目標是降低教室規模（50 組 × 20 題）產生與廣播快照時伺服器的同步工作。**沒有修改快照欄位內容、事件收件人、可見範圍、revision 語意、廣播時機、錯誤代碼或訊息，也沒有修改 `shared/` 與 `web/` 的程式，未新增第三方相依套件。**

## 修改內容

1. **作答資料一次批讀（審計 A1）**
   - `server/src/infra/db/answerRepo.ts` 的 `readAnswers()` 改為一次 `submissions JOIN questions LEFT JOIN submission_answers`，依題目位置、rank、blank position 排序後組回 `SubmissionRecord[]`。
   - 新查詢只由固定參數組合下題目、組別與有效狀態，不接受任意 SQL。
   - 新增 `listByGroup()`：一次讀回某組全部有效作答與作廢歷史；`buildMyAnswers()` 與 `buildClosedMyAnswers()` 共用同一種「有效／最新」索引。
   - `findValid()`、`findLatest()`、`listByQuestion()`、`listValidByGroup()` 不再先還原全場再在 JavaScript 過濾。

2. **投影索引化並共用同一份紀錄（審計 A4）**
   - `computeSettlementFromRecords()` 仍走既有的 `settleAll()` 純函式入口；`buildResults()` 與 `buildBoard()` 將同一份有序紀錄交給判定。
   - 建立「題目 → 組別 → 有效／最新作答」Map。winner **不**由最小 rank 推斷，仍由結算服務決定；公平順位改判的 `fairnessApplied` 與作廢歷史可比保留。

3. **進度只取有效題組配對（審計 A2）**
   - `buildProgress()` 改讀 `SELECT question_id, group_id FROM submissions WHERE voided_at IS NULL`，再依現有題目與組別補零；不再為計數讀回任何答案文字。

4. **零揭曉投影短路（審計 A3）**
   - `createProjectorSnapshot()` 先算揭曉數。揭曉 0 題時不讀作答、不跑結算，輸出維持 `questions: []`、非零題時 `groupWinCounts: null`。
   - 題目數本來就是 0 時，輸出仍與舊版相同：`groupWinCounts` 是空陣列，不是 null。

5. **T3 worktree 的靜態頁面相容（啟動驗證所需）**
   - 既有 E2E 在此 worktree 全部回 404，因 repo 位於隱藏目錄 `.t3/...`，Express 的 `send` 把絕對路徑中的隱藏段視為 dotfile。
   - 只對部署流程產生的明確 `web/dist` 靜態根加 `dotfiles: 'allow'`，即可服務既有 `/teacher`、`/student`、`/projector`；API 路由與其他檔案系統路徑不受影響。

6. **沒做審計 A5（同輪廣播共用資料）**
   - 沒做。A5 需要在同一輪不同 snapshot 之間共享活動、題庫、組別、明細與結算，同時保持不同角色的 revision 語意與公平判定時間。A1–A4 已讓所有指定門檻達標；本輪不引入這層額外語意風險。

## 基準前後對照

- 量測機器：同一台主機、同一工作目錄、無並行測試。
- 執行環境：**Node v26.7.0**（`engines` 要求 `>=24`）；審計原始數字是在 Node 24.22.3 量測。下列「改前」是我以審計提交後、未改任何 production 程式碼的前一狀態在本機重跑所得，與審計 Node 24 數字接近。
- 種子條件與腳本完全一致：50 組 × 20 題 × 每組每題一筆有效作答，共 1,000 筆。

| 函式／快照        |   改前平均 | 改後平均 | 約略倍率 | 本輪門檻 | 結果 |
| ----------------- | ---------: | -------: | -------: | -------: | :--- |
| computeSettlement |   4.274 ms | 2.763 ms |    1.54× | 未設門檻 | 改善 |
| buildResults      |  70.554 ms | 2.859 ms |   24.68× |   ≤25 ms | 通過 |
| buildBoard        |  76.602 ms | 2.884 ms |   26.56× |   ≤25 ms | 通過 |
| buildProgress     |  68.308 ms | 0.751 ms |   90.96× |   ≤25 ms | 通過 |
| 老師快照          | 145.466 ms | 4.013 ms |   36.25× |   ≤80 ms | 通過 |
| open 學生快照     |  68.525 ms | 0.283 ms |  242.14× |   ≤25 ms | 通過 |
| 零揭曉投影快照    |  78.321 ms | 0.135 ms |  580.16× |   ≤25 ms | 通過 |

### 改前完整輸出

```text
> @classroom/server@0.0.0 bench
> tsx scripts/bench-snapshot.ts

基準：50 組 × 20 題 × 每人每題都送出（1000 筆作答）

結算（computeSettlement）              4.274 ms/次
結果投影（buildResults）                 70.554 ms/次
看板（buildBoard）                     76.602 ms/次
進度（buildProgress）                  68.308 ms/次
老師快照（createSnapshot）               145.466 ms/次
學生快照（createSnapshot）               68.525 ms/次
投影快照（createProjectorSnapshot）      78.321 ms/次
```

### 改後完整輸出

```text
> @classroom/server@0.0.0 bench
> tsx scripts/bench-snapshot.ts

基準：50 組 × 20 題 × 每人每題都送出（1000 筆作答）

結算（computeSettlement）              2.763 ms/次
結果投影（buildResults）                 2.859 ms/次
看板（buildBoard）                     2.884 ms/次
進度（buildProgress）                  0.751 ms/次
老師快照（createSnapshot）               4.013 ms/次
學生快照（createSnapshot）               0.283 ms/次
投影快照（createProjectorSnapshot）      0.135 ms/次
```

## Part B：新增的邊緣案例與斷言

每案都加入指定檔案，且沒有刪除、跳過或放寬既有斷言。

1. **`server/tests/integration/answerCommands.test.ts`**：「50 組完成 20 題」
   - 1,000 筆 `submission` 全部有效；每題 rank 1–50 恰好各一次。
   - 老師 snapshot 每題已送出 50 組；每組有效送出 20 題。
   - 以 `SELECT COUNT(DISTINCT question_id)` 逐組再核對。

2. **同檔**：「同組連送五十次」
   - 1 次成功、49 次 `ALREADY_SUBMITTED`。
   - 只保留 1 筆有效紀錄與 1 筆空格答案；`answer_event_count` 與本組 `answer_revision` 都只為 1。
   - 失敗之後等待 state 超時，驗證沒有意外廣播。

3. **同檔**：「連續十輪作廢重送」
   - 原始 + 10 次重送共 11 筆歷史，末次有效 rank 11，恰好 10 筆已作廢、1 筆有效。
   - 每輪核對 open 學生 `voided/submitted`、老師 winner、cell rank 與進度仍為 1。

4. **`server/tests/integration/presence.test.ts`**：「50 組在線的定向送出與整房 presence」
   - teacher + 50 student + projector 共 52 連線。
   - 送出只送達 teacher／該組／projector 3 位；其餘 49 位學生收到 0 筆 state。
   - 第 50 組斷線時剩 51 位收到 state；重連時 52 位收到 state。
   - 最後 presence 每組為 1；投影未揭曉前不含答案、results 或看板。

5. **`server/tests/integration/countdown.test.ts`**：「滿場兩個倒數端點」
   - 手動時鐘先推進到截止前 1 ms：仍 `open` 且排程未觸發。
   - 再到截止點：51 份快照都只到 `closed`，revision 只 +1。
   - 觸發後再強制執行同一定時器 callback：狀態完全不變，也不再有 state。

6. **多空長答案（server 整合測試＋真瀏覽器）**
   - `answerCommands.test.ts`：20 題 × 4 空，每空 200 Unicode code point 且含 emoji；teacher board、closed 學生本組答案、winner 答案都逐格全文相符。另一組 open 學生看不到第一空長答案。任一空 201 code point 回 `ANSWER_TOO_LONG`，固定時鐘下 snapshot 完全一致，因此 revision 不動。
   - `e2e/tests/003-buzz-in.spec.ts`：動態產生結構合併的 xlsx，真瀏覽器走完「匯入 → 開啟 → 80 個答案欄位的伺服器狀態呈現 → 結束 → 20 題結果」。因既有 `<input maxlength=200>` 是按 **UTF-16 code units** 截斷（仍是此輪不得變更的行為），精準 200 code point 含 emoji 的字串由正式 `answer:submit` socket 送入；每格在瀏覽器作答區與結果區驗證全文。201 拒絕及 revision/server 狀態由 server 整合測試斷言。
   - 曾試作 1,000 筆 × 4,000 空的 server Socket 加乘變體；單測約 68 秒且關閉連線又超過 hook timeout，對本案非必要。1,000 筆規模已由第 1 案覆蓋，20×4×200 code point 由本案完整覆蓋，因此未把該加乘規模固定入套件。

7. **`server/tests/integration/reconnect.test.ts`**：「五十組重連期間結束活動」
   - 50 組各送第 1 題後全部斷線；老師在離線期間結束活動。
   - 50 組以原 token 重連，每人的首份 state 都是 `closed`，myAnswers 為自己正確答案。
   - 再開新 teacher 連線檢查 presence 每組 1，老師看板每格答案完整。

8. **`e2e/tests/001-activity-session.spec.ts`**：「10 秒自動關閉」
   - 真瀏覽器設定真倒數 10 秒；teacher、student 與 projector 頁面都在 15 秒內收到 `closed`。
   - 另以 guest socket 驗證未登入訪客也在同一輪收到 `closed`；guest 頁面仍在選組狀態、沒有憑證變化。

9. **效能回歸測試**
   - `server/tests/unit/answerProjectionEfficiency.test.ts` 共 7 案，計算每次投影的 SQL `all/get` 次數而不做時間斷言：
     - open / closed 學生本組、results、board、progress、零揭曉投影都須少於 100 次。
     - 另外直接以 `prepare` 攔截，斷言零揭曉投影不準備任何 `FROM submissions` 查詢。
   - 先寫測試時 6 案全部如預期失敗，舊實作分別讀 2,045 到 21,089 次；加入零揭曉攔截測試後也以 `true !== false` 如期失敗，然後才改 production。

## 驗證結果

### `npm test`

```text
> classroom-response-system@0.0.0 test
> npm run build --workspace @classroom/shared && npm test --workspaces --if-present

> shared：0 個測試檔，vitest passWithNoTests
> server：Test Files 50 passed (50)；Tests 422 passed (422)
> web：Test Files 24 passed (24)；Tests 125 passed (125)
```

原始 server 測試是 408 項；新增 7 項效能回歸單元測試與 7 項 Part B server 邊緣案例後為 422 項。web 未修改，125 項全過。

### `npm run test:e2e`

```text
Running 23 tests using 1 worker
21 passed (35.9s)
2 skipped
```

兩項 skipped 是原本即條件略過的 screenshots 案例，不是本次改動放寬。新增的「10 秒自動關閉」與「多空長答案」都在 21 項 passed 之中。

### `npm run check`

```text
> npm run typecheck && npm run lint && bash scripts/check-diagrams.sh

shared typecheck：通過
server typecheck：通過
web typecheck：通過
e2e typecheck：通過
ESLint --max-warnings=0：通過
圖表檢查：PASS 圖表檢查通過
```

### 環境安裝註記

此 worktree 原本沒有 `node_modules`，以既有 lockfile 執行了一次 `npm ci`；沒有修改 `package.json`。npm 回報既有 transitive deps 有 7 項 moderate vulnerability 警告，本輪未用 `npm audit fix`，避免趁效能工作改相依版本。

## Part C 狀態

**未完成，未交付 `e2e/load/http.mjs` 或 `socket.mjs`。**

原因：滿足需求的 Part C 不只是產生 RPS：每次 round 必須由另一個 process 重啟 server 並使用新的拋棄式 SQLite，同時量測多種 socket 狀態、不同 transport、握手到首次 state、送達延誤以及 process RSS/CPU。只把負載產生器寫出來但讓它重複打同一個資料庫，會產生誤導性指標。A、B 完成後我優先保留時間完成全量 E2E、基準、驗收與文件，而不是交付一個只能做 demo 的半套工具。

建議下一步以獨立任務完成 Part C：

- 由 scripted runner spawn server子程序和暫時資料夾（同一電腦上仍分離 server與負載 process，報告註明同機）。
- 確保 token／密碼只讀 environment、不落盤、不輸出。
- 每輪啟動後先驗證全新 DB 的 activity revision與預設 sessionId，再跑負載。
- 固定一個可重跑的資料種子與落後門檻，再用 3 次完整 120 秒階段校準 p50/p95/p99。

## 仍然存在的瓶頸與建議

1. **同輪資料仍未跨 snapshot 共讀（A5）**
   - 每份快照目前仍各自讀 activity、questions、groups。以本基準看已很便宜，但全房 `closed` 快照的主要成本仍是各角色每份 snapshot 各自讀／組 results。
   - 建議另開可回滾的工作，先加入 snapshot-context 型別與週期斷言，只做「同輪惰性共用」，不可跨公平判定時間或寫入。

2. **`computeSettlement()` 仍還原答案文字**
   - 判定只需要 questionId、groupId、rank、receivedAt、voidedAt；目前 `listAllSubmissions()` 以同一 JOIN取得 answer 文字，是所有 projection 共用最小的安全實作。
   - 可以做「判定用 metadata query」與「呈現用 answers query」分離；要重做公平模式、作廢改判、長文答案歷史測試後再改。

3. **老師 closed 全房廣播**
   - 50 組進入 closed 後每位學生沿 `buildResults()` 讀全場有效 winner answers，teacher 讀完整看板；資料是必然的，但可以透過同輪 results cache減少 DB/JS redundant work。

4. **questionRepo 的 N+1 blanks 查詢與 metadata BLOB（審計 A6）**
   - 本輪未做。50×20 的 benchmark顯示已非熱點，但大檔或更多空白時是老師 snapshot尾端成本。
   - 可以改成 blanks 一次批讀，`getGuidedNotes()` metadata不再 SELECT file BLOB；因不影響行為，可作小型 follow-up。

5. **網路、序列化與真實客戶端延遲尚未量測**
   - 本輪基準涵蓋伺服器同步組裝成本，不涵蓋 JSON serialization、Socket.IO frame queue、網路或瀏覽器渲染。
   - Part C完成後再以 p95/p99校準，不能用同步 benchmark代替線上尾端延遲。

## 結論

本輪不使用同輪快取、不動契約，已把每個指定函式／快照降到原來的 0.2%～4.1%，全部遠低於要求門檻；server 422 項、web 125 項、E2E 21 項全部通過，`npm run check` 也通過。剩餘可優化點都能再減少重複工作，但都需要另一輪獨立測試與成品界線，以免錯把快取語意或資料可見範圍改掉。
