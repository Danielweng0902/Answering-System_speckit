---

description: "Task list for 002 Guided Notes 匯入"
---

# Tasks: Guided Notes 匯入（guided-notes-import）

**Input**: Design documents from `/specs/002-guided-notes-import/`

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/、quickstart.md

**Tests**: 必須包含。Constitution 原則 II 要求測試先行：每個 user story 先寫測試並確認失敗，再實作。

**Organization**: 依 user story 分 Phase。US1、US2 同為 P1：US1 先做完整的「讀取 → 摘要 → 確認」流程（以官方單題範本 01 驗證），US2 再讓解析器處理不同版面。US3（題組）、US4（失敗說明）為 P2。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、不依賴未完成的 task）
- **[Story]**: 對應 spec.md 的 user story
- 每個 task 都寫明檔案路徑；括號內是對應的 FR、AC 與 research 編號

## Path Conventions

沿用 001：npm workspaces `shared/`、`server/`、`web/`、`e2e/`（見 plan.md）。

## 每個 Phase 的完成條件（適用全部 Phase）

1. 該 Phase 的測試先寫、先確認失敗，實作後全部通過。
2. 執行 `npm test` 與 `npm run check`，回報指令與實際輸出。
3. 不修改本 Phase 範圍以外的檔案；發現規格有洞時停下回報，不自行決定行為。
4. 解析器不得寫死儲存格座標（原則 V）；測試中的格子座標只出現在測試資料與 `expected.json` 比對。

---

## Phase 1: Setup

**Purpose**: 加入 xlsx 套件。

- [x] T001 在 `server/package.json` 加入 `exceljs` 4.4.0；在根目錄 `package.json` 加 `overrides` 把 `uuid` 升到已修正的版本；執行 `npm install` 與 `npm audit`，確認 exceljs 沒有帶入新的風險（research R1）

**Checkpoint**: `npm test`、`npm run check` 仍全部通過；`npm audit` 沒有來自 exceljs 的風險（既有的 lint 工具 `minimatch` 風險見 `docs/verification/001-automated.md`）。

---

## Phase 2: Foundational（所有 user story 的共同基礎）

**Purpose**: 協定型別、資料表、格子模型、xlsx 讀取。

**⚠️ CRITICAL**: 本 Phase 完成前不得開始任何 user story。

- [x] T002 [P] 在 `shared/src/protocol.ts` 新增：錯誤代碼 `UNAUTHORIZED`、`FILE_INVALID`、`FILE_TOO_LARGE`、`HEADER_NOT_FOUND`、`NO_QUESTIONS`、`DUPLICATE_QUESTION_NUMBER`、`LINK_INVALID`、`LINK_NOT_SHARED`、`LINK_UNREACHABLE`、`IMPORT_EXPIRED`、`QUESTIONS_REQUIRED`；型別 `QuestionKind = 'single' | 'group'`、`QuestionSummary = { number, kind, prompt, blankCount }`、`ImportWarning`（`code`：`NUMBERS_NOT_SEQUENTIAL`、`BLANK_HAS_CONTENT`、`MULTIPLE_SHEETS_WITH_HEADER`，附中文 `message`）、`ImportSummary = { importId, sheetName, questionCount, blankCount, questions: { number, kind, prompt, blankCount, blanks: { prefix, cell }[] }[], warnings, replacesExisting }`（contracts/socket-events.md、data-model.md）。`TeacherSnapshot` 的延伸放在 T021，避免本 Phase 讓 `snapshot.ts` 編譯失敗
- [x] T003 [P] 在 `shared/src/schemas.ts` 新增 `questions:confirm` 的 `{ importId: string }` 與 `POST /api/questions/import/link` 的 `{ url: string }` schema
- [x] T004 [P] 寫 `server/tests/unit/database.test.ts` 的新案例：建立 `guided_notes`（`id INTEGER PRIMARY KEY CHECK (id = 1)`）、`questions`（`number INTEGER UNIQUE`）、`blanks`（`REFERENCES questions(id) ON DELETE CASCADE`，`PRIMARY KEY (question_id, position)`）三張表；刪除題目時空格一起刪除
- [x] T005 在 `server/src/infra/db/database.ts` 依 data-model.md「SQLite 資料表」建立三張表並開啟 foreign keys（讓 T004 通過）
- [x] T006 [P] 寫 `server/tests/unit/sheetGrid.test.ts`：A1 與（列, 欄）互轉（含 `AA` 以後的欄）、查詢某格所屬的合併範圍、取合併範圍左上角的值
- [x] T007 在 `server/src/domain/sheetGrid.ts` 定義 `SheetGrid = { name, cells: 依（列, 欄）查文字, merges: { top, left, bottom, right }[] }` 與上述工具函式；列與欄以 1 起算，與試算表一致（research R2）
- [x] T008 [P] 寫 `server/tests/unit/workbookReader.test.ts`：讀 `fixtures/guided-notes/02-official-group.xlsx` 得到工作表名稱、合併範圍含題號欄的垂直合併、儲存格文字含「（1）」；讀 `05-two-sheets.xlsx` 得到兩個工作表且順序與活頁簿相同；數字格 `1` 轉成文字「1」
- [x] T009 在 `server/src/infra/xlsx/workbookReader.ts` 以 exceljs 把 xlsx 位元組轉成 `SheetGrid[]`（依活頁簿順序）；不把 exceljs 型別洩漏到 domain（research R2）

**Checkpoint**: 001 的所有測試仍通過；`workbookReader` 能讀出 8 份 fixtures 而不拋錯（90–92 也只是內容不符，不是檔案損壞）。

---

## Phase 3: User Story 1 - 老師匯入學習單並確認題數（Priority: P1）🎯 MVP

**Goal**: 老師上傳 xlsx 或貼 Google 試算表連結 → 看到摘要 → 確認後題目取代活動題目並同步到所有老師分頁；沒有題目不能開啟搶答。

**Independent Test**: 上傳 `01-official-single.xlsx`，摘要 6 題 6 空格、題號 1–6；確認後老師端顯示題號清單，學生快照沒有題目。

### Tests for User Story 1 ⚠️ 先寫、先失敗

- [x] T010 [P] [US1] 寫 `server/tests/unit/guidedNotesParser.test.ts` 的基本案例（手寫 `SheetGrid`）：同一列有「題號」「題目」「作答」三格才是表頭，三欄位置以該列為準；表頭以下題號欄每個正整數是一題，一題一個空格，空格位置是作答欄該列的格子（作答欄橫向合併時取左上角，例如合併 `G5:J5` 得 `G5`）；題目敘述取題目欄同一列文字，空白時為空字串；`position` 依由上而下的順序（FR-005–007、011）
- [x] T011 [P] [US1] 寫 `server/tests/unit/activity.test.ts` 的新案例：題目數為 0 時 `open` 回 `QUESTIONS_REQUIRED`；檢查順序 `NO_GROUPS` → `QUESTIONS_REQUIRED` → `COUNTDOWN_OUT_OF_RANGE`（FR-020；contracts/socket-events.md）
- [x] T012 [P] [US1] 寫 `server/tests/integration/questionImport.test.ts`：上傳 01 得到 `ImportSummary`（6 題、6 空格、題號 1–6、`replacesExisting = false`），且資料庫題目仍為空；`questions:confirm` 後老師快照 `questions` 為題號 1–6、`guidedNotes.sheetName = '學習單'`、`revision` +1，另一個老師分頁同步收到；不確認（取消）時題目不變；已有題目再讀取時 `replacesExisting = true`，確認後完全取代；確認不存在、已被較新讀取取代、或超過 15 分鐘的 `importId` 回 `IMPORT_EXPIRED` 且資料不變（以注入的時鐘測試）；學生與訪客快照不含 `questions`、`guidedNotes`；沒有 token 回 401 `UNAUTHORIZED`、學生 token 回 403 `FORBIDDEN`、搶答中或已結束讀取回 409 `INVALID_PHASE`、確認回 `INVALID_PHASE`，題目不變；重設活動後題目保留；重新啟動伺服器後題目保留，且資料庫中的原檔位元組與上傳的完全相同、每個空格的 `cell` 與 `prefix` 與摘要一致（AC-002-01–03、05、06；FR-010、013–016、021；research R6、R7、R9）
- [x] T013 [P] [US1] 寫 `server/tests/integration/googleSheetsLink.test.ts`（注入假的 fetch，不連網路）：`https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0` 會被轉成 `https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx` 下載；回傳 01 的位元組時摘要與上傳 01 完全相同（AC-002-04；FR-001、002；research R4）
- [x] T014 [P] [US1] 在 `server/tests/integration/fixtures.test.ts` 建立資料驅動測試：讀 `fixtures/guided-notes/expected.json`，對每筆有效檔案比對工作表、題數、空格數、題號、每個空格的 `cell` 與 `prefix`；本 Phase 只啟用 01，其他檔案以 `it.todo` 標示由後續 Phase 啟用（AC-002-01；SC-001）

### Implementation for User Story 1

- [x] T015 [US1] 在 `server/src/domain/guidedNotesParser.ts` 實作 `findHeader()` 與 `parseGuidedNotes(grids)` 的基本規則（讓 T010 通過）：回傳 `{ ok: true, sheetName, questions: { number, kind, prompt, position, blanks: { position, prefix, cell }[] }[], warnings }` 或 `{ ok: false, code, message }`；表頭比對去除前後空白後完全相等（research R3）
- [x] T016 [P] [US1] 在 `server/src/infra/db/questionRepo.ts` 實作：`replaceAll(guidedNotes, questions)` 在同一個 transaction 刪除舊的 `guided_notes`、`questions`、`blanks` 再寫入（題目 `id` 隨機）；`list()` 依 `position` 回傳；`count()`；`getGuidedNotes()` 不含原檔位元組（research R9）
- [x] T017 [US1] 在 `server/src/app/questionBank.ts` 實作 `QuestionBank`：`replace`、`listSummaries`、`hasQuestions`、`guidedNotesInfo`，包住 `questionRepo`
- [x] T018 [US1] 在 `server/src/app/importService.ts` 實作：`preview(source, bytes)` 呼叫 `workbookReader` → `parseGuidedNotes`（本 Phase 不經驗證器；T034 再接上 `validateImport`）→ 產生隨機 `importId` 並在記憶體保留最近一次結果（原檔位元組＋解析結果）15 分鐘，回傳 `ImportSummary`（`replacesExisting` 依 `questionBank.hasQuestions()`）；`confirm(importId)` 檢查準備中與 `importId` 有效後呼叫 `questionBank.replace` 並把 `activity.revision` +1；時鐘可注入（research R6）
- [x] T019 [US1] 在 `server/src/domain/activity.ts` 的 `open` 加入題目數參數與 `QUESTIONS_REQUIRED` 檢查；`server/src/app/activityCommands.ts` 傳入 `questionBank` 的題目數（讓 T011 通過；FR-020；research R8）
- [x] T020 [US1] 更新 001 既有的整合測試：在 `server/tests/integration/helpers.ts` 加入以 `questionRepo` 直接寫入一題的工具，並在所有會開啟搶答的 001 測試（`phaseSync`、`countdown`、`reset`、`restart`、`reconnect` 等）於開啟前呼叫；確認 001 測試全部恢復通過（research R8）
- [x] T021 [US1] 在 `shared/src/protocol.ts` 的 `TeacherSnapshot` 加 `questions: QuestionSummary[]` 與 `guidedNotes: { sheetName, sourceKind: 'link' | 'file', fileName: string | null, importedAt: string } | null`；在 `server/src/app/snapshot.ts` 的老師快照加入 `questions` 與 `guidedNotes`；學生、訪客快照不加（FR-016；原則 VI）；同步更新 `server/tests/unit/snapshot.test.ts`
- [x] T022 [P] [US1] 在 `server/src/infra/sheets/googleSheetsFetcher.ts` 實作連結驗證與下載的成功路徑：只接受 `https://docs.google.com/spreadsheets/d/<ID>/...`，由 `<ID>` 自行組出匯出網址，不使用連結的其他部分；fetch 可注入（research R4）
- [x] T023 [US1] 在 `server/src/infra/http/questionRoutes.ts` 實作 `POST /api/questions/import/file`（`express.raw({ limit: '5mb' })`，`X-File-Name` 以 URL 解碼）與 `POST /api/questions/import/link`；以 `Authorization: Bearer` 經 001 的 `resolveIdentity` 解析身分（401／403），檢查準備中（409）；在 `server/src/infra/http/app.ts` 掛上（contracts/http-api.md；research R5、R7）
- [x] T024 [US1] 在 `server/src/infra/socket/commandRouter.ts` 與 `server/src/index.ts` 註冊 `questions:confirm`（老師、準備中），成功後廣播（讓 T012、T013 通過）
- [x] T025 [P] [US1] 在 `web/src/lib/api.ts` 新增 `importFromFile(file)`、`importFromLink(url)`，以 `Authorization: Bearer` 帶老師 token
- [x] T026 [US1] 新增 `web/src/features/teacher/QuestionImport.tsx`（＋`.module.css`，只用 `tokens.css` 變數）：連結輸入與「讀取」、檔案選擇；摘要顯示工作表、總題數、總空格數、每題題號、提醒事項；`replacesExisting` 時提示「確認後會取代現有題目」；「確認匯入」送 `questions:confirm`、「取消」只清除畫面；只在準備中顯示可操作狀態（FR-013–015）
- [x] T027 [US1] 新增 `web/src/features/teacher/QuestionList.tsx`（＋`.module.css`）：依快照 `questions` 顯示題號清單與題目敘述；沒有題目時顯示「尚未匯入題目」；在 `web/src/features/teacher/TeacherPage.tsx` 加入 `QuestionImport` 與 `QuestionList`；`PhaseControl` 收到 `QUESTIONS_REQUIRED` 時顯示「請先匯入題目」（FR-016、020）
- [x] T028 [US1] 更新 `e2e/tests/001-activity-session.spec.ts`：開啟搶答前由老師上傳 `fixtures/guided-notes/01-official-single.xlsx` 並確認（research R8）
- [x] T029 [US1] 新增 `e2e/tests/002-guided-notes-import.spec.ts`：老師未匯入時開啟被拒絕並看到提示；上傳 01、看到 6 題摘要、取消後清單仍為空；再上傳並確認後看到題號 1–6；學生頁面看不到題目；開啟搶答成功

**Checkpoint**: `npm test`、`npm run test:e2e`、`npm run check` 全部通過；可以實機示範匯入官方單題範本並開啟搶答（MVP）。

---

## Phase 4: User Story 2 - 版面不同的學習單也能正確匯入（Priority: P1）

**Goal**: 表頭位置、欄位順序、間隔列、作答欄寬度、工作表順序不同都能辨識。

**Independent Test**: 匯入 03、05，題數、空格數、空格位置與 `expected.json` 相同。

### Tests for User Story 2 ⚠️ 先寫、先失敗

- [x] T030 [P] [US2] 在 `server/tests/unit/guidedNotesParser.test.ts` 新增版面案例：表頭在任意列與欄、三欄之間有其他欄、題目之間有空白列；表頭文字前後有半形或全形空白（U+3000）仍算表頭，「作答區」「題目說明」不算；題號為數字 `1`、`1.0`、文字「1」「 1 」都是題號 1，空白、文字、小數 `1.5`、`0`、負數不是題目；第一個工作表沒有表頭時使用第二個；多個工作表都有表頭且有題目時使用第一個並產生 `MULTIPLE_SHEETS_WITH_HEADER` 提醒（附使用的工作表名稱）；有表頭但沒題目的工作表被略過（FR-005、006、012；Edge Cases；research R3）
- [x] T031 [P] [US2] 在 `server/tests/unit/importValidator.test.ts` 寫提醒案例：題號不是從 1 開始或不連續（例如 1、2、4）產生 `NUMBERS_NOT_SEQUENTIAL`（附 `numbers`）；單題空格已有內容產生 `BLANK_HAS_CONTENT`（附 `number`、`cell`）；提醒不阻擋匯入（Edge Cases）
- [x] T032 [US2] 在 `server/tests/integration/fixtures.test.ts` 啟用 03、05（AC-002-07、08；SC-001、004）

### Implementation for User Story 2

- [x] T033 [US2] 擴充 `server/src/domain/guidedNotesParser.ts`：題號正規化、工作表選擇、`MULTIPLE_SHEETS_WITH_HEADER` 提醒（讓 T030 通過）
- [x] T034 [US2] 新增 `server/src/domain/importValidator.ts` 的 `validateImport(parsed)`：產生 `NUMBERS_NOT_SEQUENTIAL`、`BLANK_HAS_CONTENT` 提醒；在 `server/src/app/importService.ts` 的 `preview` 接上（讓 T031、T032 通過）
- [x] T035 [US2] `web/src/features/teacher/QuestionImport.tsx` 的摘要顯示每則提醒的 `message`，以及使用的工作表名稱（FR-013）

**Checkpoint**: 01、03、05 的 fixtures 測試通過；001 與 US1 測試仍通過。

---

## Phase 5: User Story 3 - 題組匯入（Priority: P2）

**Goal**: 題號垂直合併辨識為題組，每列一個空格並保留前綴。

**Independent Test**: 匯入 02，摘要 4 題、6 空格，第 1、2 題各 2 空格，前綴「（1）」「（2）」。

### Tests for User Story 3 ⚠️ 先寫、先失敗

- [x] T036 [P] [US3] 在 `server/tests/unit/guidedNotesParser.test.ts` 新增題組案例：題號格垂直合併 2 列與 3 列 → `kind = 'group'`，合併範圍內每列一個空格、順序依列；空格開頭符合 `（數字）` 或 `(數字)` 的部分記為前綴並保留原字元；某小題沒有前綴時前綴為空字串；前綴之後還有文字時產生 `BLANK_HAS_CONTENT`；作答欄跨列合併時同一題重複的位置只算一次；題組的題目敘述取第一列（FR-008、009；Edge Cases；research R3）
- [x] T037 [US3] 在 `server/tests/integration/fixtures.test.ts` 啟用 02、04；至此 5 份有效檔案全部比對（AC-002-09–12；SC-001）

### Implementation for User Story 3

- [x] T038 [US3] 擴充 `server/src/domain/guidedNotesParser.ts`：題組判斷、每列空格、前綴擷取與去重（讓 T036、T037 通過）
- [x] T039 [US3] `web/src/features/teacher/QuestionImport.tsx` 摘要與 `QuestionList.tsx` 標示每題是「單題」或「題組」與空格數；題組列出各空格前綴（AC-002-13）
- [x] T040 [US3] 在 `e2e/tests/002-guided-notes-import.spec.ts` 加入：已有 01 的題目時上傳 02，看到取代提示與「第 1、2 題是題組」，確認後清單變成 4 題（AC-002-05、11）

**Checkpoint**: 5 份有效 fixtures 全部通過（SC-001）。

---

## Phase 6: User Story 4 - 匯入失敗時清楚說明（Priority: P2）

**Goal**: 每種失敗都有錯誤代碼、含位置的中文說明與修正方式，且資料完全不變。

**Independent Test**: 匯入 90、91、92 各自得到對應錯誤，題目不變。

### Tests for User Story 4 ⚠️ 先寫、先失敗

- [x] T041 [P] [US4] 在 `server/tests/unit/importValidator.test.ts` 與 `guidedNotesParser.test.ts` 新增錯誤案例：沒有表頭 → `HEADER_NOT_FOUND`，訊息列出「題號」「題目」「作答」；有表頭沒題目 → `NO_QUESTIONS`；題號重複 → `DUPLICATE_QUESTION_NUMBER`，訊息含題號與所有出現的列號（1 起算，與試算表一致）（FR-017、018；research R3）
- [x] T042 [US4] 在 `server/tests/integration/fixtures.test.ts` 啟用 90、91、92：分別得到 `HEADER_NOT_FOUND`、`DUPLICATE_QUESTION_NUMBER`（訊息含題號 3）、`NO_QUESTIONS`（AC-002-14–16；SC-002）
- [x] T043 [P] [US4] 在 `server/tests/integration/questionImport.test.ts` 新增：上傳 PDF 位元組與損壞的 zip → 400 `FILE_INVALID`；超過 5 MB → 413 `FILE_TOO_LARGE`；解壓後超過 50 MB 的 xlsx（測試中動態產生）→ 413 `FILE_TOO_LARGE`；422 的三種內容錯誤；每種失敗後題目、`guidedNotes`、`revision` 都與失敗前相同（AC-002-17、19；FR-003、019；SC-005；research R5）
- [x] T044 [P] [US4] 在 `server/tests/integration/googleSheetsLink.test.ts` 新增：一般網址、`http://`、其他網域、`docs.google.com/document/...` → 400 `LINK_INVALID` 且沒有發出任何請求；被導到 `accounts.google.com` 或回應不是 xlsx → 422 `LINK_NOT_SHARED`；轉址到 `docs.google.com` 與 `*.googleusercontent.com` 以外的主機 → 拒絕且不讀取內容；逾時 10 秒（注入的計時）與連線失敗 → 502 `LINK_UNREACHABLE`；下載超過 5 MB 中止 → 413 `FILE_TOO_LARGE`；缺少 `url` → 400 `INVALID_INPUT`；每種失敗資料不變（AC-002-18、19；research R4）

### Implementation for User Story 4

- [x] T045 [US4] 錯誤分工：`server/src/domain/guidedNotesParser.ts` 產生 `HEADER_NOT_FOUND`、`NO_QUESTIONS`（選工作表時就需要判斷）；`server/src/domain/importValidator.ts` 產生 `DUPLICATE_QUESTION_NUMBER` 與提醒事項（讓 T041、T042 通過）
- [x] T046 [US4] `server/src/infra/xlsx/workbookReader.ts` 在解析前以 JSZip 讀中央目錄，解壓後總大小超過 50 MB 拒絕；非 zip 或 exceljs 讀取失敗轉成 `FILE_INVALID`（research R5）
- [x] T047 [US4] `server/src/infra/sheets/googleSheetsFetcher.ts` 補上錯誤路徑：轉址主機檢查、10 秒逾時、5 MB 串流上限、登入頁判斷（讓 T044 通過；research R4）
- [x] T048 [US4] `server/src/infra/http/questionRoutes.ts` 依 contracts/http-api.md 對應錯誤代碼與 HTTP 狀態；`express.raw` 超過上限的錯誤轉成 413 `FILE_TOO_LARGE` 的 JSON，而不是 Express 預設頁；`Content-Type` 不是兩種允許值時回 400 `FILE_INVALID`；`X-File-Name` 只取最後一段檔名、最多 255 字；log 只記錄事件名稱與錯誤代碼，不記錄 token、檔案內容、連結查詢字串（讓 T043 通過；原則 IV）
- [x] T049 [US4] `web/src/features/teacher/QuestionImport.tsx` 顯示錯誤訊息；連結類錯誤附上兩個替代做法：「把共用設定改成知道連結者可檢視」「下載成 xlsx 後上傳」；檔案類錯誤說明可接受 xlsx、5 MB 以內（AC-002-17、18；FR-018）
- [x] T050 [US4] 在 `e2e/tests/002-guided-notes-import.spec.ts` 加入：已有題目時上傳 91，看到題號 3 重複的訊息，題目清單不變（AC-002-15、19）

**Checkpoint**: 3 份無效 fixtures 全部被拒絕並有對應訊息（SC-002）；所有失敗後資料不變（SC-005）。

---

## Phase 7: Polish 與驗證

**Purpose**: 安全覆核、圖與程式一致性、文件、驗證紀錄。

- [x] T051 [P] **安全覆核**（GLM worker，只回報不改程式）：檢查上傳與連結路徑的 SSRF、轉址、壓縮炸彈、記憶體用量、log 外洩、身分與階段檢查；監督者把發現整理成修正 task 或記入 `docs/verification/002-security-review.md`
- [x] T052 [P] 在 `server/tests/integration/questionImport.test.ts` 新增效能檢查：上傳 01 到收到摘要在 5 秒內（SC-003）
- [x] T053 **圖與程式一致性檢查（原則 VII）**：依 plan.md「圖表與模組對應」逐列核對 `diagrams/002-guided-notes-import-*.puml` 的元件與型別在程式中存在、名稱與關係一致；有差異時修正程式，或修正 `.puml` 並重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh`；結果寫入 `docs/verification/002-diagram-consistency.md`
- [x] T054 [P] 更新根目錄 `README.md`：操作流程加入「匯入學習單」步驟、測試腳本加入 002 的步驟、說明 Google 試算表需設為「知道連結者可檢視」
- [x] T055 執行 `npm test`、`npm run test:e2e`、`npm run check`、`npm audit`，把指令與輸出記錄在 `docs/verification/002-automated.md`
- [x] T056 [P] **畫面截圖（constitution 原則 IX）**：以 Playwright 擷取匯入摘要（單題與題組）、取代提示、錯誤訊息（91 題號重複、連結未開放）、題目清單，存到 `docs/verification/002-screenshots/`，交設計負責人驗收
- [ ] T057 **人工驗證**（由設計與驗證負責人執行）：依 quickstart.md 的 13 個步驟操作，結果記錄在 `docs/verification/002-manual.md`；問題另開 GitHub issue

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：無依賴（001 已完成）。
- **Phase 2 Foundational**：依賴 Phase 1；擋住所有 user story。
- **Phase 3 US1**：依賴 Phase 2。
- **Phase 4 US2**、**Phase 5 US3**：依賴 Phase 3；兩者都改 `guidedNotesParser.ts` 與 `fixtures.test.ts`，須依序（建議 US2 → US3）。
- **Phase 6 US4**：依賴 Phase 3；與 US2、US3 只在 `guidedNotesParser.ts`、`importValidator.ts`、`fixtures.test.ts`、`QuestionImport.tsx` 重疊，這些檔案的修改須依序合併；`workbookReader`、`googleSheetsFetcher`、`questionRoutes` 的錯誤路徑（T046–T048）可與 US2、US3 平行。
- **Phase 7 Polish**：依賴前面所有 Phase。

### Within Each User Story

- 測試 task 先做，確認失敗後才做實作 task。
- domain → app → infra → web → e2e。
- 同一檔案的 task 不可平行：`guidedNotesParser.ts`、`guidedNotesParser.test.ts`、`fixtures.test.ts`、`questionImport.test.ts`、`QuestionImport.tsx`、`002-guided-notes-import.spec.ts` 被多個 task 修改。

### Parallel Opportunities

- Phase 2：T002、T003、T004、T006、T008 可平行。
- Phase 3：T010–T014 可平行；T016、T022、T025 可平行。
- Phase 6：T043、T044 可平行；T046、T047 可平行。
- Phase 7：T051、T052、T054、T056 可平行。

## Implementation Strategy

1. Phase 1、2 完成後驗證 Checkpoint（001 測試不受影響）。
2. Phase 3 完成即為 MVP：官方單題範本可以匯入並開啟搶答，可推上分支讓組員實機測試。
3. Phase 4 → 5 → 6 逐一加入，每個 Phase 完成都跑一次全部測試；Phase 5 完成時 SC-001 達成，Phase 6 完成時 SC-002、SC-005 達成。
4. Phase 7 收尾後執行 `/speckit-converge`，補齊缺漏後開 PR 合併到 `main`，合併前由另一位組員審查。

## Notes

- 每個 task 完成後在本檔勾選 `[x]`。
- 連結匯入的自動測試一律注入假的 fetch，不連網路；真實 Google 試算表只在人工驗證步驟 9、10 使用。
- 學生在搶答中看到的題目內容由 003 定義，不在本 tasks 範圍。
