# 003 安全覆核（T047）

- **日期**：2026-11-14｜**分支**：`003-buzz-in`（HEAD `ee6326e`）
- **審查者**：GLM-5.3-max（NCHC；direct 執行，只回報、不改產品程式；playbook §8）
- **範圍**：003 全部實作（T002–T053）——`shared/src/schemas.ts`、`shared/src/protocol.ts`（作答部分）、`server/src/domain/answerValidation.ts`、`server/src/domain/answerRanks.ts`、`server/src/app/answerCommands.ts`、`server/src/app/answerProjections.ts`、`server/src/app/snapshot.ts`、`server/src/app/activityCommands.ts`（reset 掛鉤）、`server/src/app/importService.ts`（confirm 換 sessionId）、`server/src/infra/db/answerRepo.ts`、`server/src/infra/db/activityRepo.ts`、`server/src/infra/db/database.ts`（新表與索引）、`server/src/infra/socket/broadcaster.ts`、`server/src/infra/socket/commandRouter.ts`、`server/src/index.ts`（指令註冊）、`web/src/features/student/AnswerArea.tsx`、`StudentResults.tsx`、`answerDrafts.ts`、`web/src/features/teacher/AnswerBoard.tsx`、`web/src/lib/useSnapshot.ts`
- **對照**：`specs/003-buzz-in/spec.md`、`specs/003-buzz-in/contracts/socket-events.md`、`data-model.md`、`.specify/memory/constitution.md`（原則 III–VI）、中程複查 `003-security-review-midcourse.md`
- **執行證據**：本次實測 `npm test`（server 35 檔／287 測試、web 13 檔／67 測試，exit 0）、`npm run test:e2e`（13 passed／2 skipped 截圖，exit 0）、`npm run check`（exit 0），詳見 `003-automated.md`

## 結論

**沒有發現違反 spec、contracts 或 constitution 的缺陷**；中程複查的兩個採納項（多空格指令路徑整合測試、`findLatest` 語意）已正確落地。中程複查後新增的範圍（US3 作廢 T026/T028/T031/T053、US5 顯示 T039/T040、看板 T027/T029/T030/T032/T033）經逐項查核，與 contracts 的 `answer:void` 觸發順序、FR-029／FR-030 及可見範圍規則一致。

## 逐項查核（T047 清單）

### 1. 可見範圍（SC-002：快照與封包兩層）

- **快照層**：`server/src/app/snapshot.ts` 學生 open 分支（63–69 行）只輸出 `questions` 與 `myAnswers`（`buildMyAnswers` 以 `findLatest(questionId, groupId)` 只取本組，`answerProjections.ts` 42–61 行），型別 `StudentOpenAnswer`（`shared/src/protocol.ts` 106–111 行）**沒有 rank 欄位**；closed 分支（71–78 行）才有 `results` 與含 rank 的 `myAnswers`。guest 分支（51–52 行）只有 base。老師的 `board`／`progress`（103–104 行）只在 teacher 快照輸出。
- **revision 層**：`snapshot.ts` 32–37 行——teacher = `activity.revision + answerEventCount`、student = `activity.revision + 本組 answerRevision`、guest = `activity.revision`；作答事件不改 `activity.revision`（`answerCommands.ts` 93–97 行註解與實作一致）。
- **封包層**：`broadcaster.ts` `broadcastSubmissionChanged`（91–106 行）只對 `identity.role === 'teacher'` 或 `student && identity.groupId === groupId` 送 `state`；`index.ts` 185–208 行把 `answer:submit`／`answer:void` 成功後的廣播都接到這個定向通道，`answer:void` 用的 groupId 來自 zod 驗證後的 payload 且就是被作廢的組。
- **側通道**：錯誤代碼（`ALREADY_SUBMITTED` 只描述本組、`QUESTION_NOT_FOUND` 與作答狀態無關）、presence 變更（001 既有行為，所有人 revision +1 但內容不含其他組作答資料）、廣播時序，都查過沒有可讓他組推知作答事件的訊號。
- **測試**：`server/tests/integration/answerVisibility.test.ts` 三個案例（作答事件定向、看板即時更新與其他身分無 board/progress、作廢只送老師與該組）＋ `noLeak.test.ts`（學生快照不含 presence/guidedNotes；log 不含密碼與 token）。

### 2. rank 競態與 transaction 邊界

- `answerCommands.ts` 136／154 行：兩個用例都以 `BEGIN IMMEDIATE` 開始，成敗各自 `COMMIT`／`ROLLBACK`（141、159 行），例外也 `ROLLBACK` 後 rethrow（143–146、161–164 行）；`node:sqlite` 同步執行且用例內無 await，transaction 期間不可能交錯。
- 順位在 transaction 內取 `maxRank(questionId) + 1`（`answerCommands.ts` 89 行；`answerRepo.ts` 171–179 行，`MAX(rank)` 含已作廢），號碼不重用；資料庫另有兩個唯一索引當最後防線（`database.ts` 69–77 行：`UNIQUE(question_id, rank)`、`(question_id, group_id) WHERE voided_at IS NULL` partial unique）。
- `insertSubmission` 以 SAVEPOINT 包住（`answerRepo.ts` 86–121 行），失敗回滾到 savepoint 再由外層 ROLLBACK。
- 結束瞬間送出：close 與 submit 都在同步 transaction 內讀寫 phase，到達順序決定結果（`INVALID_PHASE`）；倒數到期與手動 close 共用 `closeCurrent()`。
- **測試**：SC-001 十組並發 rank 1–10 各一次（`answerCommands.test.ts` 510 行起）、同組 `Promise.all` 只有先到者成功、作廢後重送得 `max+1` 且他組 rank 不變（`answerCommands.test.ts`、e2e「US3 作廢」）。

### 3. payload 偽造與身分檢查

- `answerSubmitSchema` 是 `z.strictObject`（`shared/src/schemas.ts` 55–58 行）：學生 payload 多帶 `groupId` 即 `INVALID_INPUT`（FR-018）；`answerVoidSchema`（61–64 行）同理。
- 組別一律取自連線身分：`commandRouter.ts` 117–121 行先以 stored connection identity 檢查角色（student 才能送 `answer:submit`、teacher 才能送 `answer:void`），`answerCommands.ts` 130–133／148–151 行在用例內再檢查一次；身分來自 token hash → `sessions` 表（`access.ts` 51–71 行），無法由 payload 指定。
- 前端只送 `{ questionNumber, answers }`（`AnswerArea.tsx` 123–126 行）、`{ groupId, questionNumber }`（`AnswerBoard.tsx` 79–82 行），與 schema 一致。

### 4. 輸入驗證（原則 III）

- 觸發順序與 contracts 完全一致：zod 格式 → 角色 → transaction 內 phase → 題號 → 空格數 → 每格 trim 與 1–200 code point → 重複檢查 → 寫入（`answerCommands.ts` 53–99 行）。`validateAnswer`（`answerValidation.ts` 15–27 行）先 trim（含 U+3000）再以 `Array.from` 計 code point，不用 `String.length`。
- 失敗一律 ROLLBACK：不保存作答、rank 或 counter 變化；整合測試對每種失敗後的作答數、rank 與快照完全不變有斷言。
- 前端在送出前先檢查缺填空格並指出（`AnswerArea.tsx` 107–117 行），但伺服器仍獨立驗證（不信任前端）。

### 5. log 不含答案內容（原則 IV）

- 全伺服器只有 4 處 `console.*`（grep 2026-11-14 實查）：`commandRouter.ts` 130 行只記事件名稱（`Command ${event} failed.`，不含 payload 或例外內容）、`index.ts` 139／282–283／290／297 行為啟動與關閉訊息。作答內容、token、密碼都不會進 log。
- `noLeak.test.ts` 164 行起以實際啟動的伺服器驗證 log 不含老師密碼與回傳的 token。

### 6. localStorage 草稿存取

- `answerDrafts.ts`：key 命名空間固定為 `classroom.buzz-in.drafts.<sessionId>.<groupId>`（8–14 行）；`activateDraftSession`（75–98 行）只刪命名空間內**非目前 session** 的 key，不用整體 `clear()`；`parseStoredDrafts`（20–39 行）對損壞內容容錯。草稿只在送出指令時以驗證後的答案送出，不整份上傳。
- `sessionId` 輪替：`activity:reset`（`activityCommands.ts` 160–165 行）與 `questions:confirm`（`importService.ts` 275–289 行）都在同一 transaction 換新 `sessionId`；e2e US6 驗證重設後草稿清除且不帶到新活動。

### 7. 其他憲法原則

- **原則 V（不寫死儲存格位置）**：003 產品程式只使用 002 已依結構保存的題號、空格 position 與 prefix，無任何儲存格座標。
- **原則 VI（伺服器是唯一裁判）**：rank、可見範圍、作廢全部在伺服器 transaction 內判定；`receivedAt` 用伺服器時鐘（`answerCommands.ts` 50 行），不採用戶端時間。
- **答案顯示**：`AnswerArea`、`AnswerBoard`、`StudentResults` 都以 React 文字節點輸出答案，無 `dangerouslySetInnerHTML`（spec Edge Cases：特殊字元照原字顯示）。

## 觀察（非缺陷，不需修改）

| # | 觀察 | 評估 |
|---|---|---|
| 1 | `answerRepo.readAnswers()`（25–48 行）載入全部 submissions 再以 JS 過濾；`buildBoard`／`buildProgress`／`buildMyAnswers` 對每題各呼叫一次，單次快約為 O(題數 × 總作答數) 次查詢，且每次作答事件都會重產 teacher 與該組快照 | 效能觀察。50 組 × 30 題的課堂上限約 1,500 筆有效作答，實測（e2e SC-003）遠在 2 秒內；005 投影看板若需要更大規模，建議另開 task 改 SQL 層過濾。不影響 003 行為 |
| 2 | 同一瀏覽器設定檔中，其他組的草稿 key 會留到 sessionId 輪替才清 | spec FR-027 定義草稿屬裝置、非機敏資料；UI 永遠只讀自己組的 key（`readAnswerDrafts` 以 groupId 定位），不同組成員在同一裝置互換看不到彼此草稿。無需處理 |
| 3 | `answerSubmitSchema` 的 `answers` 無陣列長度上限 | 中程複查第 4 項，結論不變：筆數由 `BLANK_COUNT_MISMATCH` 擋下（空格數由 002 匯入驗證上限），Socket.IO 預設 1MB 訊息上限，不構成行為缺漏 |
| 4 | 用例拋出例外時 `commandRouter` 不回 ack（contracts 無內部錯誤代碼），前端 10 秒後顯示「伺服器沒有回應」 | 001 起的已知記錄（README §9 第 4 項），非 003 新增問題，資料已由 ROLLBACK 保護 |

## 給後續子功能的注意點

- 005 `FairRankingRule` 只替換 `decideWinner`（`answerRanks.ts`），呼叫端（`buildResults`、`buildBoard`）已以它為唯一判定入口（FR-014）。
- 005 投影看板（`/projector`）需要與 003 相同形式的「不外洩」測試；依觀察 1，建議一併把 `readAnswers` 的全表掃描改為 SQL 過濾。

## 監督覆核補充（2026-11-14）

發現文件矛盾，尚待使用者釐清：quickstart 第 1 步以老師 T 送 answer:submit 卻預期 INVALID_PHASE；contracts/socket-events.md 第 25 行明定非學生先回 FORBIDDEN，commandRouter.ts 亦先檢查身分。003-manual.md 複製同一矛盾。建議將此準備中送出測試的操作者改為學生 A1，另保留老師送出得到 FORBIDDEN 的身分測試；未經確認不更改規格或產品行為。上方 worker 的無缺陷結論不代表文件全數一致。

使用者於 2026-11-14 同意以上修正。已將 quickstart 與人工驗證表第 1 步的作答操作者改為學生 A1，作廢操作者仍為老師 T；預期 INVALID_PHASE 不變，與既有契約及程式一致。此文件矛盾已解除，未變更產品行為。

## Phase 11 修正補充（T059–T061，2026-11-14）

Phase 11 三項修正觸及本覆核的範圍（草稿存取、指令路由的 log 與 ack、人工驗證的 token 處理），補記如下；執行證據見 `003-automated.md`。

- **T059（草稿 sparse array）**：`AnswerArea.tsx` 的 `updateAnswer` 改以 `question.blanks.map` 補空字串，先填後格不再產生 hole。storage 驗證（`parseStoredDrafts` 只接受 string 陣列）**未放寬**，因此舊資料中已存的 `null` 草稿仍會整題丟棄（容錯行為不變）；新寫入的草稿必為每格字串。可見範圍不變：草稿只在裝置 localStorage，不上傳。
- **T060（廣播例外）**：`commandRouter.ts` 只 catch 用例成功後的廣播（全域與定向），例外不再逃出 socket 事件迴圈成為未捕捉例外；log 維持只記事件名稱（`Command <event> broadcast failed.`），不含 payload、答案或例外內容（原則 IV 不變）。已 COMMIT 的用例結果仍回覆原 ack 恰一次，不重送、不吞掉（contracts: ack）；用例本身拋例外時「不回 ack、transaction ROLLBACK」的既有行為完全不變。新增測試斷言 ack 恰一次、連線存活、log 不含 payload 與 secret。
- **T061（測試 client 文件）**：quickstart.md 與 003-manual.md 的測試 client 作法基於實際位置（本機伺服器提供的 `/socket.io/socket.io.js`、`web/src/lib/session.ts` 的 sessionStorage key `classroom.session.token`、`shared/src/protocol.ts` 的 payload 型別）。token 只在分頁內由程序自行讀取，文件明文禁止複製、貼上或寫入檔案／指令／log；因此不採用需要把 token 傳入 shell 或腳本的本機 node 替代做法。文件中的欄位說明（`answer:submit` 不得帶 `groupId`、ack 無 requestId）與 schemas 及 contracts 一致。
