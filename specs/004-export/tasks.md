---
description: "Task list for 004 匯出結果（export）"
---

# Tasks: 匯出結果（export）

**Input**: Design documents from `/specs/004-export/`

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/、quickstart.md

**Tests**: 必須包含。Constitution 原則 II 要求測試先行：每個 user story 先寫測試並確認失敗，再實作。

**Organization**: 依 user story 分 Phase。US1（把搶答成功答案寫回原 Guided Notes）為 P1 且是 MVP；US2（題組答案保留前綴）為 P2，是 US1 的延伸行為；US3（匯出活動結果 CSV）為 P2，與 US1 無相依、可平行。三個 story 都共用 Phase 2 的 xlsx 位元組層編輯器與匯出入口基礎設施。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、不依賴未完成的 task）
- **[Story]**: 對應 spec.md 的 user story
- 每個 task 都寫明檔案路徑；括號內是對應的 FR、AC 與 research 編號

## Path Conventions

沿用 001、002、003：npm workspaces `shared/`、`server/`、`web/`、`e2e/`（見 plan.md）。

## 每個 Phase 的完成條件（適用全部 Phase）

1. 該 Phase 的測試先寫、先確認失敗，實作後全部通過。
2. 執行 `npm test` 與 `npm run check`（含 e2e task 的 Phase 加 `npm run test:e2e`），回報指令與實際輸出。
3. 不修改本 Phase 範圍以外的檔案；發現規格有洞或與 Feature Contract 牴觕時停下回報，不自行決定行為。
4. 伺服器 log 只記錄事件名稱與檔案大小，不記錄 token、學生的答案內容或檔案位元組（原則 IV）。
5. 匯出是唯讀操作：不得改變 `guided_notes`、`questions`、`blanks`、`submissions`、`submission_answers`、`groups` 任何資料，也不得產生 Socket.IO 事件或遞增 `activity.revision`（FR-008、原則 VI）。

---

## Phase 1: Setup（基準確認）

**Purpose**: 004 不新增依賴（plan.md：沿用 001、002 的 `exceljs@4.4.0`、`jszip@3.10.2`）；確認起點是綠燈。

- [x] T001 在 `004-export` 分支執行 `npm test`、`npm run test:e2e`、`npm run check`，確認 001、002、003 全部通過並記下輸出作為基準；有任何失敗先停下回報，不開始實作

**Checkpoint**: 三個指令全綠。

---

## Phase 2: Foundational（所有 user story 的共同基礎）

**Purpose**: xlsx 位元組層編輯器與 HTTP 匯出入口的共用基礎設施。US1、US2、US3 都依賴它。

**⚠️ CRITICAL**: 本 Phase 完成前不得開始任何 user story。

### Tests for Foundational ⚠️ 先寫、先失敗

- [x] T002 [P] 寫 `server/tests/unit/xlsxEditor.test.ts`：以 `fixtures/guided-notes/02-official-group.xlsx` 為輸入——(a) 解析工作表名稱「學習單」到實際的 sheet XML 路徑，且**不依賴 XML 屬性順序**（`Target` 排在 `Id` 之前、`r:id` 排在 `name` 之後都要能解析；research R3）；(b) 把空殼 cell `<c r="G5" s="15"/>` 換成文字後，樣式索引 `s="15"` 保留；(c) 把有內容且已帶 `t="s"` 的 cell 換成文字後**不得產生重複的 `t` 屬性**，輸出仍是合法 XML、exceljs 讀得開（research R4）；(d) 寫入 `=1+1` 這類內容時不得產生 `<f>` 元素、讀回是字串不是公式（FR-006、research R6）；(e) 寫入內容含 `&`、`<`、`>` 時要正確跳脫；含前後空白時要加 `xml:space="preserve"`；(f) 替換後除目標 sheet XML 外，其餘 zip entry 全部 byte-identical（research R1、SC-002）；(g) 工作表名稱不存在時要回報明確錯誤，不得靜默產生錯的檔案
- [x] T003 [P] 寫 `server/tests/unit/exportCommands.test.ts` 的權限與階段案例（以 001 的 helpers 建測試伺服器）：沒有 token → `UNAUTHORIZED`；無效 token → `UNAUTHORIZED`；學生 token → `FORBIDDEN`；老師 token 但活動在 preparing → `INVALID_PHASE`；在 open → `INVALID_PHASE`；在 closed 但沒有匯入過學習單 → `NO_GUIDED_NOTES`（FR-016、FR-017、AC-004-05、AC-004-06）；每種失敗都不產生檔案、也不改變任何資料（原則 III）

### Implementation for Foundational

- [x] T004 新增 `server/src/infra/xlsx/xlsxEditor.ts`（讓 T002 通過）：用 `jszip` 讀寫 xlsx 位元組。函式包含——`resolveSheetPath(zip, sheetName)`（先取出完整的 `<sheet .../>` 與 `<Relationship .../>` 標籤再個別取屬性，**不得**用跨屬性的單一正規表示式；research R3）、`setCellText(sheetXml, a1, text)`（先移除原 `<c>` 標籤上的 `t="..."` 再補 `t="inlineStr"`，支援 self-closing 與 paired 兩種型態，XML 跳脫與 `xml:space="preserve"`，不寫 `<f>`；research R4、R6）、`replaceCellText(xlsxBytes, sheetName, a1, text)`（回傳新的 xlsx 位元組，未修改的 entry 保持 byte-identical；research R1）。**不得**修改 `sharedStrings.xml`
- [x] T005 新增 `server/src/app/exportCommands.ts` 的共用前置檢查與檔名產生（讓 T003 通過）：`authorizeExport(database, token)` 回傳老師身分或回錯誤代碼（`UNAUTHORIZED`／`FORBIDDEN`／`INVALID_PHASE`／`NO_GUIDED_NOTES`，依 contracts/http-api.md 的 HTTP 狀態對應）；`buildExportFileName(now)` 產生「搶答結果_YYYYMMDD_HHmm」加副檔名（FR-007、clarify 2026-11-14：統一格式，不使用原檔名，連結匯入時也相同）
- [x] T006 在 `shared/src/protocol.ts` 新增錯誤代碼 `NO_GUIDED_NOTES`（加入 `ERROR_CODES` 與 `ERROR_MESSAGES`，繁中訊息：「這個活動沒有匯入過學習單，請先匯入學習單」）；在 `shared/src/schemas.ts` 不需新增（匯出無使用者輸入）。**不得覆寫既有的 `NO_QUESTIONS`**——002 已用它表示「匯入的檔案裡找不到題號」且訊息不同，MUST 新增獨立代碼（憲法原則 I：不得使 002 的行為改變）
- [x] T007 新增 `server/src/infra/http/exportRoutes.ts`：掛載兩個 GET 端點 `/api/export/guided-notes` 與 `/api/export/results.csv`；沿用 `questionRoutes.ts` 的 `bearerToken()`、`resolveIdentity()` 與錯誤 JSON 格式（`{ error: { code, message } }`）；成功時以 `Content-Type` + `Content-Disposition: attachment` 回傳檔案位元組（檔名含 UTF-8 字元時一併提供 `filename*=UTF-8''<percent-encoded>`）；log 只記錄事件名稱與檔案大小（原則 IV）。本 Phase 只掛路由與共用檢查，Guided Notes 與 CSV 的內容組裝分別由 US1 與 US3 的 task 補上

**Checkpoint**: `npm test` 通過新增的 xlsxEditor 與 exportCommands 案例；`npm run check` 通過；此時端點會回明確錯誤但還不產生檔案。

---

## Phase 3: User Story 1 - 把搶答成功的答案寫回原 Guided Notes（Priority: P1）🎯 MVP

**Goal**: 活動結束後，老師下載到一份與原檔同格式、已在各題填空格寫入搶答成功組別答案的 xlsx。

**Independent Test**: 整合測試匯入官方單題範本、兩組作答、結束、匯出，讀回產出檔確認每個答案都落在 `expected.json` 所列的空格位置，且填空格以外的內容與原檔相同。

### Tests for User Story 1 ⚠️ 先寫、先失敗

- [x] T008 [P] [US1] 寫 `server/tests/integration/exportCommands.test.ts` 的匯出內容案例（以 002 的 helpers 匯入 fixture、以 003 的 helpers 讓組別作答並結束）：(a) 單題搶答成功的答案寫入該題填空格（AC-004-01）；(b) 無人作答的題目填空格維持原內容（AC-004-02）；(c) 匯出檔除填空格外，文字內容、合併範圍、欄寬、列高、框線、字型、對齊與原檔相同（AC-004-03、FR-003、SC-002）；(d) 版面不同的 5 份 fixture（01～05）每個答案都落在 `expected.json` 所列位置，沒有寫到其他儲存格（AC-004-04、SC-001）；(e) 同一場活動匯出兩次，內容相同（AC-004-07、FR-008）；(f) 匯出後資料庫的 `guided_notes.file` BLOB 與 `submissions`、`questions`、`blanks` 完全未變（FR-008）；(g) 檔名為「搶答結果_日期時間.xlsx」（FR-007）；(h) 該題的作答被老師作廢且該組未再送出 → 該題填空格維持原內容（AC-004-16、003 D24）；(i) **量測匯出耗時**：以最多 50 組 × 30 題的作答規模，從呼叫匯出到取得完整位元組在 **5 秒內**完成（SC-003）

### Implementation for User Story 1

- [x] T009 [P] [US1] 新增 `server/src/app/guidedNotesExporter.ts` 的 `buildBlankContent()`：輸入該題的搶答成功答案陣列與該題各空格的 `prefix`，回傳每個空格的寫入內容——「前綴＋答案」；該題無人作答時回傳 `null` 表示不寫入、保持原內容（FR-004、FR-005、AC-004-08、research R5）。前綴是 cell 文字的一部分，不是獨立欄位
- [x] T010 [US1] 在 `server/src/app/exportCommands.ts` 實作 `exportGuidedNotes(database, now)`：取原檔（`getStoredGuidedNotes()` 回傳的 `file` 位元組與 `sheetName`）、取每題的搶答成功組別與答案（沿用 003 的 `buildResults`／`answerRanks.decideWinner`，**只取有效作答**）、逐空格用 T009 的結果呼叫 T004 的 `replaceCellText()`、回傳 `{ fileName, bytes, contentType }`（FR-001、FR-002、FR-008；research R2）
- [x] T011 [US1] 在 `server/src/infra/http/exportRoutes.ts` 完成 `/api/export/guided-notes` 的成功回應：200 + xlsx 的 `Content-Type` + `Content-Disposition` + 檔案位元組（contracts/http-api.md）
- [x] T012 [US1] 在 `web/src/features/teacher/TeacherPage.tsx` 加「匯出 Guided Notes」按鈕：只在老師身分且 `phase === 'closed'` 時顯示；點擊後透過 `web/src/lib/api.ts` 帶 token 下載檔案（瀏覽器下載，不開新視窗）；失敗時顯示伺服器的中文訊息。按鈕樣式只引用 `tokens.css` 的變數，不做視覺定稿（原則 IX）
- [x] T013 [US1] 寫 `e2e/tests/004-export.spec.ts`：老師匯入 fixture → 兩組作答 → 結束 → 按匯出 → 攔截下載並驗證檔案內容（答案位置正確、其他儲存格未變）；學生身分看不到匯出按鈕（AC-004-01、02、03、06；FR-016）

**Checkpoint**: US1 可獨立驗收：老師能下載格式正確、內容正確的 xlsx。

---

## Phase 4: User Story 2 - 題組答案保留前綴（Priority: P2）

**Goal**: 匯出時，題組的每個填空格是「（1）答案」「（2）答案」，而非只有答案。

**Independent Test**: 匯入官方題組範本，某組搶答成功後匯出，確認兩個填空格分別是「（1）＋答案」與「（2）＋答案」；該題無人作答時維持原前綴。

### Tests for User Story 2 ⚠️ 先寫、先失敗

- [x] T014 [P] [US2] 寫 `server/tests/integration/exportCommands.test.ts` 的題組案例（以 `fixtures/guided-notes/02-official-group.xlsx`）：(a) 第 1 題搶答成功時，兩個填空格分別是「（1）CPU」「（2）作業系統」（AC-004-08、FR-005）；(b) 該題無人作答時，兩個填空格維持原前綴「（1）」「（2）」（AC-004-09）；(c) 前綴與答案在同一個儲存格內、不是寫進兩個儲存格（research R5）；(d) 前綴為空字串的單題只寫答案，不多寫任何符號（AC-004-01）

### Implementation for User Story 2

- [x] T015 [US2] 在 `server/src/app/guidedNotesExporter.ts` 補上前綴的邊界處理：單題空格 `prefix` 為空字串時只寫答案；題組空格 `prefix` 為「（1）」這類文字時寫「前綴＋答案」；前綴以 002 存入 `blanks.prefix` 的值為準，不重新解析原檔、不寫死（FR-005、principle V；research R5）
- [x] T016 [US2] 在 `server/tests/unit/guidedNotesExporter.test.ts` 補單元案例：`buildBlankContent()` 在前綴為空、有前綴、該題無人作答（回傳 `null`）三種情況的輸出；答案本身以 `=` 開頭時輸出仍是「前綴＋=開頭的答案」的純文字（FR-006、FR-014）

**Checkpoint**: US1 與 US2 都可獨立驗收；題組匯出保留前綴。

---

## Phase 5: User Story 3 - 匯出活動結果 CSV（Priority: P2）

**Goal**: 老師下載到一份包含所有組別、所有題目有效作答明細的 CSV，每個空格一列。

**Independent Test**: 兩組各送出數題後結束並匯出 CSV，逐列比對與老師看板一致，中文不亂碼。

### Tests for User Story 3 ⚠️ 先寫、先失敗

- [x] T017 [P] [US3] 寫 `server/tests/unit/csvBuilder.test.ts`：(a) 欄位名稱列依序為 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間`（FR-010、D13）；(b) 一筆作答的每個空格各一列（FR-011）；(c) 排序為題號 → 順位 → 空格序（FR-011）；(d) 內容含逗號時用雙引號包住、含雙引號時雙引號加倍、含換行時用雙引號包住（FR-013、AC-004-13）；(e) 內容以 `=`、`+`、`-`、`@` 開頭時前面加單引號（FR-014、AC-004-14）；(f) 檔案開頭是 UTF-8 BOM（FR-012、AC-004-12）；(g) 空資料時只有欄位名稱列（AC-004-15）；(h) 「是否搶答成功」為「是」或「否」
- [x] T018 [P] [US3] 寫 `server/tests/integration/exportCommands.test.ts` 的 CSV 案例：(a) 匯出內容與老師看板的每題每組答案、順位、搶答成功標示完全一致（AC-004-11、FR-015、SC-004）；(b) 被作廢的作答不產生任何列（AC-004-17、FR-009、003 D24）；(c) 沒有任何有效作答時只有欄位名稱列（AC-004-15）；(d) CSV 的「空格序」與 002 匯入時存入 `blanks.position` 的順序一致（兩者是不同的來源，必須對齊）；(e) CSV 的「送出時間」輸出為 ISO 8601 字串（含時區與毫秒，例如 `2026-11-14T09:30:00.123Z`），可直接對照 `submissions.received_at`

### Implementation for User Story 3

- [x] T019 [P] [US3] 在 `server/src/infra/db/answerRepo.ts` 新增 `listValidSubmissionsWithAnswers()`：回傳所有**有效**作答（`voided_at IS NULL`）連同每個空格的答案、組別名稱、順位與送出時間，依題號 → 順位 → 空格序排序；**不得**包含已作廢的作答（FR-009、FR-011；003 D24）
- [x] T020 [US3] 新增 `server/src/app/csvBuilder.ts`：`ResultRow` 型別（題號、空格序、組別、答案、順位、是否搶答成功、送出時間）、`escapeCsvField()`（逗號／引號／換行）、`safeFormulaGuard()`（`=`、`+`、`-`、`@` 開頭加前導單引號）、`buildCsv()`（欄位名稱列＋資料列＋UTF-8 BOM）；「送出時間」輸出為 ISO 8601 字串（`submissions.received_at` 已是 ISO 格式，直接輸出即可）（FR-010～FR-014；contracts/http-api.md「轉義規則」）
- [x] T021 [US3] 在 `server/src/app/exportCommands.ts` 實作 `exportResultCsv(database, now)`：呼叫 T019 取得有效作答、呼叫 T020 組裝 CSV、回傳 `{ fileName, bytes, contentType }`（FR-009、FR-015）
- [x] T022 [US3] 在 `server/src/infra/http/exportRoutes.ts` 完成 `/api/export/results.csv` 的成功回應：200 + `text/csv; charset=utf-8` + `Content-Disposition` + 含 BOM 的位元組（contracts/http-api.md）
- [x] T023 [US3] 在 `web/src/features/teacher/TeacherPage.tsx` 加「匯出 CSV」按鈕：只在老師身分且 `phase === 'closed'` 時顯示；點擊後帶 token 下載；失敗時顯示伺服器的中文訊息（原則 IX）
- [x] T024 [US3] 在 `e2e/tests/004-export.spec.ts` 補 CSV 流程：老師結束後按匯出 CSV → 攔截下載 → 驗證 BOM、欄位名稱列、每個空格一列、內容與看板一致、中文正確（AC-004-10、11、12、15；FR-010、012）

**Checkpoint**: 三個 user story 都可獨立驗收。

---

## Phase 6: Polish 與驗證

**Purpose**: 跨 user story 的收尾：文件、圖表一致性、安全覆核、自動驗證紀錄、截圖與人工驗證。

- [x] T025 [P] 在 `server/src/infra/db/answerRepo.ts` 與 `server/src/app/exportCommands.ts` 補上「匯出不改變資料、不產生 Socket.IO 事件、不遞增 `activity.revision`」的整合測試案例，斷言匯出前後資料庫與快照 revision 完全相同（FR-008、原則 VI）
- [x] T026 [P] 更新根目錄 `README.md`：操作流程加入「活動結束後匯出 Guided Notes／匯出 CSV」步驟；測試說明加入 004
- [x] T027 派工給 GLM 做安全覆核（只回報不改程式）：可見範圍（學生與訪客不得取得匯出檔案）、身分與階段檢查是否只在伺服器強制、log 是否含答案內容或 token、原檔 BLOB 是否可能被改壞、CSV 是否有公式注入風險；監督把發現整理成修正 task 或記入 `docs/verification/004-security-review.md`
- [ ] T027b **另一位組員審查（憲法要求的合併關卡）**：由非實作者的組員在 PR 上留下 review，審查重點為匯出檔的內容正確性（答案是否落在正確的空格）、權限與階段檢查、CSV 轉義；審查結果與待辦記錄在 `docs/verification/004-security-review.md` 或 PR 的 review 中。**此項完成前不得合併**（憲法「合併前 MUST 通過：另一位組員的審查」）
- [x] T028 **圖與程式一致性檢查（原則 VII）**：依 plan.md「圖表與模組對應」逐列核對 `diagrams/004-export-*.puml` 的元件與型別在程式中存在、名稱與關係一致；有差異時修正 `.puml` 並重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh`（優先），或修正程式（若程式真的偏離契約——先停下回報）。結果寫入 `docs/verification/004-diagram-consistency.md`
- [x] T029 執行 `npm test`、`npm run test:e2e`、`npm run check`、`npm audit`，把指令與輸出記錄在 `docs/verification/004-automated.md`（含 SC-001～SC-005 各由哪個測試涵蓋的對照表）
- [ ] T030 [P] **畫面截圖（constitution 原則 IX）**：以 Playwright 擷取老師端「已結束」時的兩個匯出按鈕、以及下載後開啟的檔案畫面，存到 `docs/verification/004-screenshots/`，交設計負責人驗收
- [ ] T031 **人工驗證**：依 `specs/004-export/quickstart.md` 的 18 個步驟操作，結果記錄在 `docs/verification/004-manual.md`；問題另開 GitHub issue。由設計與驗證負責人執行，**不可用自動測試或截圖替代**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 無相依，可立即開始
- **Foundational (Phase 2)**: 依賴 Setup，**阻擋所有 user story**
- **User Stories (Phase 3–5)**: 都依賴 Foundational 完成
  - US1、US3 彼此無相依，可平行（不同檔案）
  - US2 依賴 US1 的 `guidedNotesExporter.ts`（同一檔案，實際上會在同一個 Phase 一起完成）
- **Polish (Phase 6)**: 依賴所有要交付的 user story 完成

### User Story Dependencies

- **User Story 1 (P1)**: Foundational 完成後可開始，不依賴其他 story
- **User Story 2 (P2)**: 依賴 US1 的 `guidedNotesExporter.ts`；但因共用檔案，實作上與 US1 合併進行
- **User Story 3 (P2)**: Foundational 完成後可開始，與 US1 可平行

### Within Each User Story

- 測試 MUST 先寫並確認失敗，再實作
- 純函式（`buildBlankContent()`、`buildCsv()`）before 端點
- 端點 before 前端按鈕
- 核心實作 before 整合測試

### Parallel Opportunities

- Phase 2 的 T002、T003 可平行
- US1 的 T008 與 US3 的 T017、T018 可平行（不同測試檔的案例，但同一檔案時需合併編輯）
- US3 的 T019、T020 可平行
- Polish 的 T025、T026、T030 可平行

---

## Implementation Strategy

### MVP First（US1 only）

Phase 1 → Phase 2 → Phase 3。完成後老師就能下載到填好搶答成功答案的 xlsx，這是課程核心需求 C5。

### Incremental Delivery

1. **MVP（US1）**：xlsx 位元組層編輯器 + 匯出端點 + 老師按鈕 + 整合與 e2e 測試
2. **US2**：在既有寫入器上補前綴處理與邊界測試
3. **US3**：CSV 產生器 + 有效作答查詢 + 第二個端點與按鈕
4. **Polish**：安全覆核、圖表一致性、自動驗證紀錄、截圖、人工驗證

---

## Notes

- **本子功能是唯讀的**：不新增資料表、不改變 schema、不改變任何既有指令或快照欄位、不產生新的 Socket.IO 事件。唯一的對外新增是兩個 HTTP 下載端點。
- **匯出檔的位元組保真**是本子功能的核心風險與核心價值。Phase 0 的實驗結論（research R1～R6）已驗證 jszip 手術式替換可行；實作時若發現與實驗不符，停下回報並更新 research.md，不要自行改變路線。
- **兩個已知陷阱**必須有測試覆蓋：目標 cell 原本帶 `t="s"` 時不能產生重複屬性（research R4）；工作表名稱到 sheet 檔案的解析不能依賴 XML 屬性順序（research R3）。
- **格式驗收採分層標準**（clarify 2026-11-14）：內容、合併範圍、欄寬、列高、框線、字型、對齊皆必須保留；驗收以逐項比對原檔與匯出檔為準。若讀寫路線無法達成，MUST 改用能保留的寫入方式，不得放寬驗收標準。
- **待兩組決策的事**（不阻擋本子功能實作，但結果畫面與匯出的一致性需留意）：換組／token 設計（001 層）、看板是否顯示原前綴（teacher protocol 變更）。
