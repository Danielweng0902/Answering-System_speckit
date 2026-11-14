# 002 圖與程式一致性驗證（T053）

- **日期**：2026-11-12
- **範圍**：依 `specs/002-guided-notes-import/plan.md`「圖表與模組對應」核對 `diagrams/002-guided-notes-import-component.puml`、`diagrams/002-guided-notes-import-class.puml`、`diagrams/002-guided-notes-import-seq-import.puml`。
- **方法**：靜態讀取 `shared/`、`server/` 與 `web/` 目前程式，逐項比對圖中元件、型別、欄位、方法、HTTP 端點、socket 事件、錯誤代碼與資料關係；發現差異只修改 `.puml`。
- **執行限制**：本工作階段沒有 shell，無法執行 `scripts/render-diagrams.sh`、`scripts/check-diagrams.sh` 或 PlantUML。PNG 由監督者重新產生並檢查；本文件不宣稱已完成任何指令執行或 PNG 校驗。

## 1. 組件圖逐項核對

| 圖中項目／關係 | 程式位置 | 結果 | 差異說明與處理 |
|---|---|---|---|
| 標題為技術層 | `diagrams/002-guided-notes-import-component.puml` | 已修正 | 原圖標示「概念層」，改為「技術層」。 |
| 老師端畫面：`TeacherPage` | `web/src/features/teacher/TeacherPage.tsx:4-10, 48, 55-56` | 一致（已修圖後） | 原圖只有單一「老師端畫面」；實際由 `TeacherPage` 組合 `PhaseControl`、`QuestionImport`、`QuestionList`，圖已標出實際檔案。 |
| 老師端匯入 UI：`QuestionImport` | `web/src/features/teacher/QuestionImport.tsx:44-263` | 一致（已修圖後） | 實際負責連結／檔案讀取、摘要、提醒、取代提示、確認與取消；圖標示檔案與職責。 |
| 老師端題目清單：`QuestionList` | `web/src/features/teacher/QuestionList.tsx:13-37` | 一致（已修圖後） | 以 `QuestionSummary[]` 顯示題號、類型、空格數與敘述；圖已使用實際檔案與輸入型別。 |
| HTTP 客戶端 | `web/src/lib/api.ts:215-248` | 一致（已修圖後） | 實際方法是 `importFromFile(file)` 與 `importFromLink(url)`，均帶 `Authorization: Bearer`；圖標示方法名與端點外圍。 |
| Socket 客戶端事件 | `web/src/features/teacher/QuestionImport.tsx:94-115` | 一致（已修圖後） | `sendCommand('questions:confirm', { importId })` 名稱與參數吻合；圖標示 socket 客戶端。 |
| Import Gateway：HTTP 路由 | `server/src/infra/http/questionRoutes.ts:136-241` | 一致（已修圖後） | 圖已把概念元件改為 `questionRoutes.ts`，列出 `POST /api/questions/import/file` 與 `POST /api/questions/import/link`。 |
| HTTP 身分與階段檢查 | `questionRoutes.ts:88-117` | 一致（已修圖後） | `authorizeTeacher()` 使用 `resolveIdentity()` 與 `getActivity()`；失敗回 401 `UNAUTHORIZED`、403 `FORBIDDEN`、409 `INVALID_PHASE`；圖已標出。 |
| Import Gateway：讀取／確認用例 | `server/src/app/importService.ts:75-82, 101-287` | 一致（已修圖後） | 實際介面為 `previewFromFile()`、`previewFromLink()`、`confirm()`；讀取結果只在記憶體保留最近一次 15 分鐘，圖已註記。 |
| Import Gateway：socket 指令 | `server/src/index.ts:168-176`、`server/src/infra/socket/commandRouter.ts:90-129` | 一致（已修圖後） | 已註冊 `questions:confirm`；payload 以 `questionsConfirmSchema` 驗證，且只有 teacher 可執行。圖已標出實際檔案與事件名。 |
| Sheet Fetcher | `server/src/infra/sheets/googleSheetsFetcher.ts:35-49, 95-150, 153-271` | 一致（已修圖後） | 實際函式為 `parseSheetLink()`、`normalizeSheetUrl()`、`fetchSheetXlsx()`；只從 ID 組出 `/export?format=xlsx`，逐一檢查 HTTPS 與允許主機。圖已改為實際檔案與限制。 |
| Workbook Reader | `server/src/infra/xlsx/workbookReader.ts:102-169` | 一致（已修圖後） | `assertWorkbookSize()` 先檢查 ZIP 中央目錄 50 MB；`readWorkbook()` 以 exceljs 輸出 `SheetGrid[]`。圖已標出兩個函式。 |
| Guided Notes Parser | `server/src/domain/guidedNotesParser.ts:63-102, 208-246` | 一致（已修圖後） | 實際函式 `findHeader(grid)`、`parseGuidedNotes(grids)`；依同一列表頭與合併範圍，不使用固定座標。圖註記與程式一致。 |
| Import Validator | `server/src/domain/importValidator.ts:25-95` | 一致（已修圖後） | 實際函式 `validateImport(parsed)`；重複題號回 `DUPLICATE_QUESTION_NUMBER`，其他問題產生 `ImportWarning`。圖已標出。 |
| 讀取流程順序 | `importService.ts:110-170, 173-210`；`questionRoutes.ts:142-217` | 一致（已修圖後） | HTTP 先做身分／階段與檔案前置檢查；服務再 `readWorkbook()` → `parseGuidedNotes()` → `validateImport()` → 建立 `ImportSummary`。原圖略過實際檔案，已補。 |
| ImportSummary 暫存與 `replacesExisting` | `importService.ts:141-170, 42-57`；`server/src/app/questionBank.ts:42-47` | 一致（已修圖後） | `randomUUID()` 產生 `importId`、保留 `PendingImport`；`replacesExisting` 來自 `questionBank.hasQuestions()`。 |
| Question Bank 介面 | `server/src/app/questionBank.ts:18-52` | 一致（已修圖後） | 實際方法是 `replace()`、`listSummaries()`、`hasQuestions()`、`count()`、`guidedNotesInfo()`；圖已列出。 |
| Question repository | `server/src/infra/db/questionRepo.ts:70-208` | 一致（已修圖後） | 實際函式 `replaceAll()`、`list()`、`count()`、`getGuidedNotes()`；`replaceAll()` 使用 SAVEPOINT 刪舊寫新。 |
| 資料表 | `server/src/infra/db/database.ts:26-50` | 一致（已修圖後） | `guided_notes(id=1)`、`questions(number UNIQUE)`、`blanks(question_id, position)` 與 `ON DELETE CASCADE` 都存在；另有 `activity.revision`。 |
| 確認取代與 revision +1 | `importService.ts:213-285` | 一致（已修圖後） | `confirm()` 檢查準備中與 `importId` 後，在同一個 transaction 中 `questionBank.replace()` 並以 `updateActivity(... revision + 1)`；成功才回 `{ ok: true }`。圖已註記。 |
| 狀態快照內容 | `server/src/app/snapshot.ts:30-57`、`shared/src/protocol.ts:29-46` | 一致（已修圖後） | 老師快照有 `questions: QuestionSummary[]` 與 `guidedNotes: GuidedNotesInfo \| null`；學生／訪客沒有。圖已標出 `TeacherSnapshot` 與資料來源。 |
| 成功確認後廣播 | `commandRouter.ts:125-128`、`server/src/infra/socket/broadcaster.ts:74-87` | 一致（已修圖後） | 只有 `ack.ok` 才 `broadcastState()`；以 `state` 事件送角色過濾後快照。圖已加入 `broadcaster.ts`。 |
| 活動開啟的題目數檢查 | `server/src/domain/activity.ts:35-65`、`server/src/app/activityCommands.ts:117-127` | 一致（已修圖後） | `open()` 需要 `questionCount >= 1`，不足回 `QUESTIONS_REQUIRED`；`activityCommands` 直接呼叫 `questionRepo.count()`。圖標成這條實際關係，不再畫成經 `QuestionBank`。 |
| HTTP 錯誤代碼與狀態 | `questionRoutes.ts:36-47, 191-237` | 一致（已修圖後） | 400：`INVALID_INPUT`/`FILE_INVALID`/`LINK_INVALID`；413：`FILE_TOO_LARGE`；422：內容／連結未開放類；502：`LINK_UNREACHABLE`。圖註記錯誤與「錯誤不寫入」。 |

## 2. 類別圖逐項核對

| 圖中項目 | 程式位置 | 結果 | 差異說明與處理 |
|---|---|---|---|
| 標題為技術層 | `diagrams/002-guided-notes-import-class.puml` | 已修正 | 原圖標示「領域物件」，改為「技術層」。 |
| `QuestionKind` | `shared/src/protocol.ts:54` | 一致 | 實際型別是字串 union `'single' \| 'group'`；圖以 enum 表現兩個實際值。 |
| `CellRange` | `server/src/domain/sheetGrid.ts:4-9` | 一致（已納入） | 欄位 `top`、`left`、`bottom`、`right` 與程式一致。 |
| `SheetGrid` | `server/src/domain/sheetGrid.ts:11-15` | 一致（已納入） | 欄位 `name`、`cells: Map<string, string>`、`merges: CellRange[]` 與程式一致。 |
| `HeaderLocation` | `server/src/domain/guidedNotesParser.ts:12-17` | 一致 | 實際欄位為 `row`、`numberColumn`、`promptColumn`、`answerColumn`，取代原圖中文概念欄位。 |
| `ParsedQuestion` | `server/src/domain/guidedNotesParser.ts:30-37` | 一致（已修圖後） | 實際欄位 `number`、`kind`、`prompt`、`position`、`rows: number[]`、`blanks: ParsedBlank[]`。原圖「題目」改成此實際型別。 |
| `ParsedBlank` | `server/src/domain/guidedNotesParser.ts:19-27` | 一致（已修圖後） | 實際欄位 `position`、`prefix`、`cell`、`hasContent?: boolean`；原圖「空格」已加上實際欄位與 A1 說明。 |
| `ParseFailure` | `server/src/domain/guidedNotesParser.ts:39-43` | 一致（已納入） | parser 錯誤只含 `HEADER_NOT_FOUND` 或 `NO_QUESTIONS`，欄位 `ok:false`、`code`、`message`。 |
| `ImportValidationFailure` | `server/src/domain/importValidator.ts:10-14` | 一致（已納入） | validator 錯誤是 `DUPLICATE_QUESTION_NUMBER`。 |
| `CommandError` | `shared/src/protocol.ts:172-174` | 一致（已修圖後） | 程式沒有統一的 `ImportError` export；HTTP／socket 錯誤物件使用 `CommandError`。原圖「匯入錯誤」已改成實際型別與註記。 |
| `QuestionSummary` | `shared/src/protocol.ts:56-61` | 一致（已納入） | 實際欄位 `number`、`kind`、`prompt`、`blankCount`。 |
| `ImportSummaryBlank` | `shared/src/protocol.ts:86-89` | 一致（已納入） | 摘要中的空格只有 `prefix` 與 `cell`，沒有 `position`。 |
| `ImportSummaryQuestion` | `shared/src/protocol.ts:91-93` | 一致（已納入） | 是 `QuestionSummary & { blanks: ImportSummaryBlank[] }`；圖列出全部實際欄位。 |
| `ImportWarning` | `shared/src/protocol.ts:63-84` | 一致（已納入） | 實際是三種 union：各變體都有 `code`、`message`，並分別附 `numbers`、`number/cell`、`sheetName`；圖以 union note 表示。 |
| `ImportSummary` | `shared/src/protocol.ts:95-103` | 一致（已修圖後） | 欄位 `importId`、`sheetName`、`questionCount`、`blankCount`、`questions`、`warnings`、`replacesExisting` 全部與程式一致。 |
| `GuidedNotesInfo` | `shared/src/protocol.ts:29-35` | 一致（已納入） | 老師快照的學習單資訊欄位為 `sheetName`、`sourceKind`、`fileName`、`importedAt`；不含檔案位元組或 sourceUrl。 |
| `TeacherSnapshot` 的 002 延伸 | `shared/src/protocol.ts:41-46` | 一致（已納入） | `questions: QuestionSummary[]`、`guidedNotes: GuidedNotesInfo \| null` 與程式一致；圖 note 說明其餘 SnapshotBase 欄位沿用。 |
| `GuidedNotesSource` | `server/src/infra/db/questionRepo.ts:11-15` | 一致（已納入） | 欄位 `sourceKind: 'link' \| 'file'`、`sourceUrl: string \| null`、`fileName: string \| null`。 |
| `GuidedNotesRecord` | `server/src/infra/db/questionRepo.ts:17-21` | 一致（已修圖後） | 是寫入資料庫的完整學習單，含 `file: Uint8Array`、`sheetName`、`importedAt`；取代原圖不存在的 `GuidedNotes` 型別。 |
| `GuidedNotesMeta` | `server/src/infra/db/questionRepo.ts:24-27` | 一致（已納入） | 不含位元組；供 `guidedNotesInfo()` 使用，仍含內部的 `sourceUrl`。 |
| `BlankInput` | `server/src/infra/db/questionRepo.ts:29-33` | 一致（已修圖後） | 欄位 `position`、`prefix`、`cell` 與程式一致；取代原圖不存在的 `Blank` export。 |
| `QuestionInput` | `server/src/infra/db/questionRepo.ts:35-42` | 一致（已修圖後） | 欄位 `id`、`number`、`kind`、`prompt`、`position`、`blanks` 與程式一致；取代原圖不存在的 `Question` export。 |
| `StoredQuestion` | `server/src/infra/db/questionRepo.ts:44` | 一致（已納入） | 實際是 `type StoredQuestion = QuestionInput`；圖以 type alias 註記。 |
| 沒有獨立 `SourceKind` export | `questionRepo.ts:11-21`；`protocol.ts:29-35` | 差異已由圖修正 | 程式直接把 `sourceKind` 欄位寫成 `'link' \| 'file'`；原圖的 `來源種類` enum 已改為欄位型別，圖 note 明確記錄。 |
| `findHeader()` | `server/src/domain/guidedNotesParser.ts:63-102` | 一致 | 簽名 `(grid: SheetGrid) => HeaderLocation \| null`；圖已使用實際簽名。 |
| `parseGuidedNotes()` | `server/src/domain/guidedNotesParser.ts:208-246` | 一致 | 簽名 `(grids: SheetGrid[]) => ParseResult`；成功選第一個有表頭且有題目的工作表，可能附 `MULTIPLE_SHEETS_WITH_HEADER`。 |
| `validateImport()` | `server/src/domain/importValidator.ts:57-95` | 一致 | 簽名 `(parsed: ParsedImportInput) => ImportValidationResult`；重複題號失敗，其他狀況加入提醒。 |
| `ImportService` 介面 | `server/src/app/importService.ts:75-82` | 一致（已納入） | 三個實際方法 `previewFromFile()`、`previewFromLink()`、`confirm()`；圖已列出。 |
| `QuestionBank` 介面 | `server/src/app/questionBank.ts:18-27` | 一致（已修圖後） | 原圖方法「取代、題目清單、是否有題目」改成實際 `replace()`、`listSummaries()`、`hasQuestions()`、`count()`、`guidedNotesInfo()`。 |

## 3. 時序圖逐項核對

| 圖中步驟／事件 | 程式位置 | 結果 | 差異說明與處理 |
|---|---|---|---|
| 標題為技術層 | `diagrams/002-guided-notes-import-seq-import.puml` | 已修正 | 標題加上「技術層」。 |
| 連結讀取端點 | `web/src/lib/api.ts:234-248`、`server/src/infra/http/questionRoutes.ts:191-217` | 一致（已修圖後） | 圖使用實際 `POST /api/questions/import/link`，request body 為 `{ url }`，由 `importLinkRequestSchema` 驗證。 |
| 檔案讀取端點 | `web/src/lib/api.ts:215-232`、`questionRoutes.ts:142-188` | 一致（已修圖後） | 圖使用實際 `POST /api/questions/import/file`、`application/octet-stream`、`X-File-Name` URL 編碼與 xlsx bytes。 |
| Authentication 與 preparing 檢查 | `questionRoutes.ts:88-117` | 一致（已修圖後） | 檢查次序為 Bearer token → `resolveIdentity` → teacher role → activity phase；401 `UNAUTHORIZED`、403 `FORBIDDEN`、409 `INVALID_PHASE`。 |
| HTTP 請求格式錯誤 | `questionRoutes.ts:199-203` | 一致（已納入） | 連結 request 缺少或格式不符時直接 400 `INVALID_INPUT`。 |
| 連結格式驗證 | `importService.ts:183-188`、`googleSheetsFetcher.ts:35-45` | 一致（已納入） | `parseSheetLink()` 只接受 `https://docs.google.com/spreadsheets/d/<ID>/...`；失敗回 400 `LINK_INVALID`，且不發出下載。 |
| Google xlsx 下載 | `googleSheetsFetcher.ts:47-49, 153-228, 230-271` | 一致（已修圖後） | 由 ID 產生 `/export?format=xlsx`；手動檢查轉址主機、10 秒逾時、5 MB 串流上限與前幾位元 PK magic；失敗回 `LINK_NOT_SHARED`/`LINK_UNREACHABLE`/`FILE_INVALID`/`FILE_TOO_LARGE`。圖已列出。 |
| 上傳前置大小檢查 | `questionRoutes.ts:142-168`、`workbookReader.ts:102-132` | 一致（已納入） | `assertWorkbookSize()` 在 exceljs 展開前讀中央目錄；非 zip 或 50 MB 超過時由 Route 轉成 400/413。 |
| xlsx 解析 | `importService.ts:110-122`、`workbookReader.ts:134-169` | 一致（已修圖後） | `readWorkbook()` 輸出 workbook 順序的 `SheetGrid[]`；服務對讀取例外統一轉 `FILE_INVALID`，資料不變。 |
| 表頭與題目解析 | `importService.ts:124-128`、`guidedNotesParser.ts:63-205, 208-246` | 一致（已修圖後） | `findHeader()` 找同列「題號／題目／作答」；合併題號決定 `kind`；每列產生 `ParsedBlank`；失敗碼是 `HEADER_NOT_FOUND`/`NO_QUESTIONS`。圖使用實際型別。 |
| 匯入驗證 | `importService.ts:129-132`、`importValidator.ts:57-95` | 一致（已修圖後） | 題號重複回 422 `DUPLICATE_QUESTION_NUMBER`；非連續題號、既有內容、多表頭只加入 `ImportWarning[]`。 |
| 建立 preview | `importService.ts:141-170, 42-57` | 一致（已修圖後） | 隨機 `importId`、只保留最近一次 `PendingImport`、15 分鐘後失效；`replacesExisting` 來自 `hasQuestions()`。 |
| HTTP 成功摘要 | `questionRoutes.ts:172-178, 205-212`；`shared/src/protocol.ts:95-103` | 一致（已修圖後） | 200 回 `ImportSummary`；原圖「題數、空格數、每題類型、提醒」改成實際 `ImportSummary` 欄位與型別。 |
| 讀取錯誤不寫入 | `importService.ts:173-180, 213-245` | 一致（已納入） | preview 失敗時 `pending = null` 且不修改資料庫；確認前沒有任何題目或 `guided_notes` 寫入。圖保留此保證。 |
| Socket 事件與 payload | `shared/src/protocol.ts:195-217`、`shared/src/schemas.ts:50-66`、`QuestionImport.tsx:102-105` | 一致（已修圖後） | 事件名實際為 `questions:confirm`，payload 為 `{ importId: string }`；schema 驗證失敗 ack `INVALID_INPUT`，非老師 ack `FORBIDDEN`。 |
| 確認階段檢查 | `importService.ts:213-227` | 一致（已修圖後） | `phase !== 'preparing'` 時回 `INVALID_PHASE`，不讀取 preview，也不改資料。 |
| `importId` 有效性檢查 | `importService.ts:228-245, 42-43` | 一致（已修圖後） | 不存在、已被較新讀取取代，或滿 `PREVIEW_TTL_MS = 15 min` 都回 `IMPORT_EXPIRED`；資料不變。 |
| 確認寫入資料 | `importService.ts:246-284`、`questionRepo.ts:70-129` | 一致（已修圖後） | 組成 `GuidedNotesRecord` 與 `QuestionInput[]`；`replaceAll()` 刪除舊 `guided_notes`/`questions`（blanks cascade）並寫入新資料。 |
| revision +1 與 transaction | `importService.ts:270-281` | 一致（已修圖後） | `BEGIN` 中先 `questionBank.replace()`，再 `updateActivity(... revision + 1)`；例外 `ROLLBACK`。原圖只寫「完成」，已補實際行為。 |
| 成功後廣播 | `commandRouter.ts:125-128`、`broadcaster.ts:74-87` | 一致（已修圖後） | `ack.ok` 後先 `broadcastState()` 再回 ack；以 `state` 事件送各自角色快照。 |
| 新題目清單 | `snapshot.ts:35-57`、`QuestionList.tsx:13-37` | 一致（已修圖後） | 新 `TeacherSnapshot` 的 `questions`/`guidedNotes` 驅動 `QuestionList`；學生與訪客不收到這些欄位。 |
| 取消操作 | `QuestionImport.tsx:118-121` | 一致（已納入） | 取消只清畫面，不送任何指令；圖 note 明確標示。 |

## 4. 本次修改的圖與原因

| 檔案 | 修改內容 | 原因 |
|---|---|---|
| `diagrams/002-guided-notes-import-component.puml` | 標題改技術層；元件改為 `TeacherPage/QuestionImport/QuestionList/api/socket/questionRoutes/importService/googleSheetsFetcher/workbookReader/guidedNotesParser/importValidator/commandRouter/questionBank/questionRepo/activityRepo/broadcaster/snapshot/database.ts`；補實際方法、HTTP 端點、socket 事件、SQLite 表、錯誤代碼、transaction 與 revision +1。 | 原圖只有概念名稱，且缺少 15 分鐘 preview、`ImportSummary.replacesExisting`、角色過濾快照、HTTP／socket 驗證與實際錯誤路徑。 |
| `diagrams/002-guided-notes-import-class.puml` | 標題改技術層；以 `ParsedQuestion`、`ParsedBlank`、`ImportSummary`、`ImportWarning`、`QuestionSummary`、`GuidedNotesInfo`、`GuidedNotesRecord`、`QuestionInput`、`StoredQuestion`、`BlankInput`、`ParseFailure`、`ImportValidationFailure`、`CommandError` 等實際型別與欄位取代概念類別；列實際函式與 `QuestionBank` 方法。 | 原圖使用程式不存在的 `GuidedNotes`、`SourceKind`、`Question`、`Blank`、`ImportError` 名稱與概念欄位。 |
| `diagrams/002-guided-notes-import-seq-import.puml` | 使用實際 HTTP 端點、標頭、request body、方法、檔案、`questions:confirm` payload、HTTP 狀態與錯誤代碼（`UNAUTHORIZED`、`FORBIDDEN`、`INVALID_PHASE`、`INVALID_INPUT`、`FILE_INVALID`、`FILE_TOO_LARGE`、`LINK_INVALID`、`LINK_NOT_SHARED`、`LINK_UNREACHABLE`、`HEADER_NOT_FOUND`、`NO_QUESTIONS`、`DUPLICATE_QUESTION_NUMBER`、`IMPORT_EXPIRED`）；補 15 分鐘 preview、同事務取代與 `revision +1`、成功後 `state` 廣播。 | 原圖是抽象「讀取／確認」流程，無法依 plan.md 把介面名稱、錯誤與 revision 行為追溯到實作。 |

## 5. 未解決差異與待執行驗證

1. **圖—程式差異**：靜態核對後，三張 `.puml` 中列出的元件、型別、方法、事件與欄位均可在上述程式位置找到；沒有已知的未解決圖—程式差異。
2. **PlantUML／PNG 待驗證**：本輪無法執行指令，尚未實際渲染或執行 `scripts/check-diagrams.sh`。監督者重新產生 PNG 後，必須執行：
   - `scripts/render-diagrams.sh`（或用既有流程只重建三張 002 PNG）
   - `scripts/check-diagrams.sh`
   - 如有 PlantUML 直接語法檢查流程，也應一併執行；本文件不使用「已執行」的表述。
3. **文件範圍**：依本輪限制未修改 `tasks.md`、`plan.md` 或任何程式與 PNG。

## 6. plan.md 對應表的建議修正（不自行修改 plan.md）

以下不是執行錯誤，而是 plan.md 以資料模型／概念名稱對應到目前 TypeScript 實作時名稱不完整或不一致。建議把「類別圖」對應表改成：

| plan.md 目前文字 | 程式實際狀況 | 建議的 plan.md 修正 |
|---|---|---|
| `學習單、來源種類 \| GuidedNotes、SourceKind` | 程式沒有這兩個 export；資料庫層有 `GuidedNotesSource`、`GuidedNotesRecord`、`GuidedNotesMeta`，老師快照有 `GuidedNotesInfo`，`sourceKind` 是 inline union。 | 改為 `學習單、來源種類｜GuidedNotesSource／GuidedNotesRecord／GuidedNotesMeta；TeacherSnapshot 另用 GuidedNotesInfo；sourceKind 為 'link' \| 'file' inline union` |
| `題目、題目類型 \| Question、QuestionKind` | 有 `QuestionKind`；沒有具名 `Question` export。解析用 `ParsedQuestion`，寫入用 `QuestionInput`，讀取用 `StoredQuestion`，對外摘要用 `QuestionSummary`。 | 改為 `題目、題目類型｜QuestionKind；解析 ParsedQuestion；寫入／讀取 QuestionInput／StoredQuestion；快照 QuestionSummary` |
| `空格 \| Blank` | 沒有具名 `Blank` export；解析用 `ParsedBlank`，寫入用 `BlankInput`，HTTP 摘要用 `ImportSummaryBlank`。 | 改為 `空格｜解析 ParsedBlank；寫入 BlankInput；摘要 ImportSummaryBlank` |
| `匯入錯誤 \| ImportError` | 沒有統一具名 `ImportError` export；socket／HTTP 共用 `CommandError`；domain 分別有 `ParseFailure`、`ImportValidationFailure`；服務另有 `PreviewFailure`。 | 改為 `匯入錯誤｜API／socket 用 CommandError；domain 用 ParseFailure／ImportValidationFailure；服務用 PreviewFailure` |
| 對應表沒有老師快照型別 | `TeacherSnapshot` 明確含 `questions: QuestionSummary[]` 與 `guidedNotes: GuidedNotesInfo \| null`。 | 新增一列 `老師快照｜TeacherSnapshot、QuestionSummary、GuidedNotesInfo` |
| `學習單解析器 \| parseGuidedNotes()、findHeader()` | 兩個函式存在，但 `workbookReader` 會先產生 `SheetGrid[]`；類別圖已另外標示。 | 可補成 `學習單解析器｜parseGuidedNotes()、findHeader()、SheetGrid／CellRange（grid 由 workbookReader 產生）` |

另有一項實作層級的可追溯性觀察：`server/src/app/questionBank.ts` 的檔頭註解說「讀取端（快照、activity:open）…都經過這裡」，但程式目前 `snapshot.ts` 直接呼叫 `questionRepo.list()/getGuidedNotes()`、`activityCommands.ts` 直接呼叫 `questionRepo.count()`，未經 `QuestionBank`。這不是 plan.md 的對應文字錯誤，也不是本輪依限制可修改的行為；建議後續由規格或程式負責人確認要修正註解、改走 `QuestionBank`，或在 plan.md 明確記錄此直接 repo 讀取。