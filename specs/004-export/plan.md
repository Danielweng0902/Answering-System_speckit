# Implementation Plan: 匯出結果（export）

**Branch**: `004-export` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-export/spec.md`

**Note**: 技術架構沿用 [001 research](../001-activity-session/research.md)、[002 plan](../002-guided-notes-import/plan.md) 與 [003 plan](../003-buzz-in/plan.md)。本計畫只描述 004 新增的匯出功能。

## Summary

活動結束後，老師按下載即可取得兩份成果：一份是與當初匯入的 Guided Notes **同格式**、已在各題填空格寫入搶答成功組別答案的 xlsx；另一份是包含所有組別、所有題目有效作答明細的 CSV。

技術做法：原檔 BLOB 與每個空格的座標、前綴在 002 匯入時就存好了，匯出時**不再解析檔案**，直接沿用這些紀錄。xlsx 以 `jszip` 在位元組層手術式替換目標儲存格的 XML 節點，其餘內容 byte-identical——這是 Phase 0 實驗後的結論，`exceljs` 讀寫一輪會丟空殼 part 並把 inlineStr 轉成 sharedStrings。CSV 以字串自行組裝，欄位固定 7 欄（D13），含 BOM、完整引用轉義與公式字元防護。匯出是唯讀操作，不改變任何活動狀態，因此走 HTTP 下載而非 Socket.IO 指令，也不產生 `state` 廣播。

## Technical Context

**Language/Version**: 沿用 001（TypeScript 5.x、Node.js 24 以上）

**Primary Dependencies**: 沿用 001（Socket.IO、React/Vite、zod）、002（`exceljs@4.4.0`、`jszip@3.10.2`、SQLite repository）；**不新增依賴**

**Storage**: 沿用 001 的 SQLite（`node:sqlite`）；沿用 002 的 `guided_notes`（原檔 BLOB、`sheet_name`）與 `blanks`（`cell`、`prefix`）、003 的 `submissions`／`submission_answers`；**不新增資料表、不改變 schema**

**Testing**: 沿用 001（vitest 單元與整合測試、Playwright E2E）；xlsx 保真以「原檔 vs 匯出檔」逐項比對（位元組層 + exceljs 物件層）驗證；CSV 以字串斷言

**Target Platform**: 沿用 001（本機伺服器與瀏覽器）

**Project Type**: 沿用 001（npm workspaces：`shared`、`server`、`web`）

**Performance Goals**: 老師按下匯出到取得檔案在 5 秒內完成（SC-003）；匯出不因作答筆數增加而變慢（最多 50 組 × 數十題）

**Constraints**：
- 寫入位置 MUST 來自 002 依結構解析的紀錄，MUST NOT 寫死儲存格座標（原則 V、FR-002）
- 除填格外 MUST 保留合併範圍、欄寬、列高、框線、字型、對齊（FR-003、SC-002）
- 寫入值 MUST 為純文字，不得被試算表軟體當成公式（FR-006、FR-014）
- 只有老師、且只在「已結束」階段可匯出（FR-016）
- 被作廢的作答不列入匯出（003 D24、clarify 2026-11-14）
- CSV 欄位固定 7 欄，依 D13（clarify 2026-11-14）
- 介面只用 design tokens（原則 IX）

**Scale/Scope**: 最多 50 組；每份學習單 5–30 題；每題至多 50 筆有效作答；本子功能 3 個 user story、17 條 FR、17 個驗收情境

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
|---|---|---|
| I 規格是唯一真相來源 | 只實作 004 spec.md（含 2026-11-14 五項 clarification）、Feature Contract D12、D13；匯出行為以本檔與 contracts 為準，不另建行為文件 | 通過 |
| II 測試先行 | xlsx 保真、CSV 轉義、權限與階段檢查先寫失敗測試；每個 user story 至少一個正常案例與一個邊界案例；快速驗證指令列入 quickstart | 通過 |
| III 輸入驗證與清楚錯誤 | 匯出無使用者輸入，但必須驗證身分（老師）、階段（已結束）、是否有匯入過學習單；每種失敗有固定錯誤代碼與繁中訊息；失敗時不產生檔案、不改資料 | 通過 |
| IV 機敏資料零落地 | 不新增密碼、金鑰或憑證；沿用 001 的 teacher token 機制；匯出內容是學生的答案（教學資料，非機敏憑證），但不得寫入 log | 通過 |
| V 依結構定位 | 寫入位置直接使用 002 依結構（表頭 → 作答欄 → 合併範圍左上角）解析並存入 `blanks.cell` 的座標，MUST NOT 寫死座標；匯入與匯出都以 `fixtures/guided-notes/` 5 份版面不同的檔案驗證 | 通過 |
| VI 伺服器是唯一裁判 | 匯出的內容（哪些組搶答成功、順位、是否作廢）全部由伺服器從資料庫判定後輸出；前端不參與內容決定；權限與階段由伺服器檢查，不靠前端隱藏按鈕 | 通過 |
| VII 圖表生成 | 004 的組件圖、類別圖與時序圖已存在；本檔下方列出模組對應；tasks 最後必須重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh` | 通過 |
| VIII 可追溯 | data-model 每條規則標 FR；contracts 的端點、錯誤碼標 FR/AC；quickstart 的步驟標 AC；子功能需求對應 C5、E2 | 通過 |
| IX 設計規範先於介面實作 | 老師端只加「匯出 Guided Notes」「匯出 CSV」兩個按鈕與下載行為，不做視覺定稿，樣式只引用 `tokens.css` | 通過（同 001、002、003 的條件） |

**對 001、002、003 的影響**：**無**。004 是唯讀功能——不新增資料表、不改變 schema、不改變任何既有指令或快照欄位、不產生新的 `state` 事件。唯一的對外新增是兩個 HTTP 下載端點。

Phase 1 設計完成後重新檢查：結果相同，沒有違反項目。補充兩點確認：

- **原則 VII**：Phase 1 產出的 `research.md`、`data-model.md`、`contracts/http-api.md`、`quickstart.md` 與既有三張圖一致；`scripts/check-diagrams.sh` 通過（無需重繪，圖未修改）。
- **原則 V**：Phase 0 實測確認 5 份 fixture 的 36 個空格儲存格**全部已存在**於對應的 sheet XML（8 個空殼、28 個有內容），匯出只需替換內容、不需插入儲存格或列；寫入位置直接沿用 002 依結構解析存入的 `blanks.cell`。

## 圖表與模組對應（原則 VII）

| 組件圖（`diagrams/004-export-component.puml`） | 模組 |
|---|---|
| 匯出入口（Export Gateway） | `server/src/app/exportCommands.ts`（身分與階段檢查）；`server/src/infra/http/exportRoutes.ts`（HTTP 下載端點） |
| Guided Notes 寫入（Guided Notes Writer） | `server/src/app/guidedNotesExporter.ts`（組合「前綴＋答案」、決定哪些空格要寫）＋ `server/src/infra/xlsx/xlsxEditor.ts`（jszip 位元組層替換 cell XML） |
| CSV 產生（CSV Builder） | `server/src/app/csvBuilder.ts`（欄位、排序、引用轉義、公式字元防護、BOM） |
| 結果彙整（003） | `server/src/app/answerProjections.ts` 的 `buildResults`（各題搶答成功組別）與 `server/src/infra/db/answerRepo.ts`（所有有效作答與順位，明確排除 `voided_at IS NOT NULL`） |
| 題目庫（002） | `server/src/infra/db/questionRepo.ts` 的 `getStoredGuidedNotes()`（原檔 BLOB 與 `sheetName`）、`blanks` 表（`cell`、`prefix`） |
| 活動階段管理（001） | `server/src/infra/db/activityRepo.ts` 的 `getActivity()`；匯出由 `authorizeExport()` 檢查，只在 `closed` 允許 |
| 老師端畫面 | `web/src/features/teacher/TeacherPage.tsx`（兩個匯出按鈕與下載觸發）、`web/src/lib/api.ts`（帶 token 的下載請求） |

| 類別圖（`diagrams/004-export-class.puml`） | 程式中的型別 |
|---|---|
| 匯出服務 | `server/src/app/exportCommands.ts` 的 `exportGuidedNotes()`、`exportResultCsv()` |
| 學習單寫入器 | `server/src/app/guidedNotesExporter.ts` 的 `buildBlankContent()`（前綴＋答案）與 `server/src/infra/xlsx/xlsxEditor.ts` 的 `setCellText()` |
| 匯出的學習單 | `server/src/app/exportCommands.ts` 的 `ExportFile`（檔名、位元組、mime type；xlsx 與 CSV 共用） |
| 結果紀錄列 | `server/src/app/csvBuilder.ts` 的 `ResultRow`（題號、空格序、組別、答案、順位、是否搶答成功、送出時間） |
| CSV 產生器 | `server/src/app/csvBuilder.ts` 的 `buildCsv()`、`escapeCsvField()`、`safeFormulaGuard()` |
| 學習單 <<002>> | `GuidedNotesRecord`（含 `file: Uint8Array`、`sheetName`） |
| 空格 <<002>> | `blanks` 表的 `cell`、`prefix` |
| 搶答結果 <<003>> | `QuestionResult`（各題 winner 與答案） |
| 作答 <<003>> | `SubmissionRecord`、`SubmissionAnswerRecord`（僅取有效作答） |

| 時序圖（`diagrams/004-export-seq-export.puml`） | 對應流程 |
|---|---|
| 匯出 Guided Notes | `GET /api/export/guided-notes` → `exportGuidedNotes()` → `getStoredGuidedNotes()` + `buildResults()` → 逐空格 `setCellText()` → jszip 重新封裝 → 下載 |
| 匯出 CSV | `GET /api/export/results.csv` → `exportResultCsv()` → 有效作答明細 → `buildCsv()` → 下載 |
| 檢查：老師身分、階段為已結束、有題目 | `exportCommands.ts` 的前置檢查；失敗回明確錯誤代碼 |

## Project Structure

### Documentation (this feature)

```text
specs/004-export/
├── spec.md              # 規格 + 2026-11-14 clarifications
├── plan.md              # 本檔（/speckit-plan 輸出）
├── research.md          # Phase 0 輸出（xlsx 保真實驗與九項決策）
├── data-model.md        # Phase 1 輸出
├── quickstart.md        # Phase 1 輸出
├── contracts/           # Phase 1 輸出
│   └── http-api.md      # 兩個匯出端點、錯誤碼、CSV 欄位
└── tasks.md             # Phase 2 輸出（/speckit-tasks 產生）
```

### Source Code（新增與修改的檔案）

```text
server/src/
├── app/
│   ├── exportCommands.ts        # 新增：匯出用例（身分／階段檢查、組裝輸出）
│   ├── guidedNotesExporter.ts   # 新增：前綴＋答案組合、決定要寫哪些空格
│   └── csvBuilder.ts            # 新增：CSV 欄位、排序、轉義、公式防護、BOM
├── infra/
│   ├── http/
│   │   └── exportRoutes.ts      # 新增：兩個 HTTP 下載端點
│   └── xlsx/
│       └── xlsxEditor.ts        # 新增：jszip 位元組層 cell 替換、sheet 路徑解析
└── infra/db/
    └── answerRepo.ts            # 修改：新增「有效作答明細」查詢（排除作廢）

web/src/
├── features/teacher/
│   └── TeacherPage.tsx          # 修改：匯出按鈕與下載觸發
└── lib/
    └── api.ts                   # 修改：帶 token 的檔案下載

server/tests/
├── unit/
│   ├── csvBuilder.test.ts       # 新增：CSV 轉義、排序、公式防護、BOM
│   └── xlsxEditor.test.ts       # 新增：cell 替換、屬性順序、t 屬性移除
└── integration/
    └── exportCommands.test.ts    # 新增：權限、階段、內容正確性、原檔保真

e2e/tests/
└── 004-export.spec.ts           # 新增：老師下載兩種檔案的完整流程
```

**Structure Decision**: 沿用 001 既有的 `server/src/{domain,app,infra}` 三層與 `web/src/features` 結構，不引入新目錄層級。004 的核心邏輯放在 `server/src/app/`（與 003 的 `answerCommands.ts`／`answerProjections.ts` 同層），位元組層的 xlsx 操作放 `server/src/infra/xlsx/`（與 `infra/sheets/`、`infra/xlsx/` 既有位置一致）。

## Complexity Tracking

> Constitution Check 無違規項目，本節不填。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| （無） | | |
