# Implementation Plan: Guided Notes 匯入（guided-notes-import）

**Branch**: `002-guided-notes-import` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-guided-notes-import/spec.md`

**Note**: 技術架構沿用 [001 plan](../001-activity-session/plan.md) 與 [001 research](../001-activity-session/research.md)。本計畫只描述 002 新增的部分。

## Summary

老師上傳 xlsx 或貼上 Google 試算表連結，伺服器依「題號／題目／作答」表頭與合併範圍辨識題目、題組與空格，回傳摘要；老師確認後才取代活動的題目。

技術做法：讀取與確認分成兩步。讀取走 HTTP，只解析、不寫入；確認走 001 的 Socket 指令路由，在一個 transaction 中取代題目並廣播。解析分成兩層：infra 把 xlsx（exceljs）轉成與套件無關的格子模型，domain 的解析器是純函式，以 fixtures 與手寫格子測試。原檔與每個空格的位置一併保存，供 004 匯出。

## Technical Context

**Language/Version**: 沿用 001（TypeScript 5.x、Node.js 24 以上）

**Primary Dependencies**: 沿用 001；新增 `exceljs` 4.4.0（伺服器，讀 xlsx），以 `overrides` 升級間接依賴 `uuid`（research R1）

**Storage**: 沿用 001 的 SQLite；新增 `guided_notes`、`questions`、`blanks` 三張表（data-model.md）

**Testing**: 沿用 001；解析器以 `fixtures/guided-notes/` 與 `expected.json` 做資料驅動測試

**Target Platform**: 沿用 001。以連結匯入需要網路；沒有網路時改用上傳

**Project Type**: 沿用 001（npm workspaces：`shared`、`server`、`web`）

**Performance Goals**: 官方範本大小的檔案，從送出到看到摘要 5 秒內（SC-003）

**Constraints**: 依結構定位，不寫死座標（原則 V）；讀取失敗不改資料（原則 III、FR-019）；Google 試算表不使用金鑰（FR-002、原則 IV）；伺服器只對 Google 試算表網域發出請求（research R4）；上傳 5 MB、解壓 50 MB 上限（research R5）

**Scale/Scope**: 一份學習單通常 5–30 題；本子功能 4 個 user story、21 條 FR

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
|---|---|---|
| I 規格是唯一真相來源 | 只實作 spec.md 與 Feature Contract D10、D11、D22；表頭比對與重設行為已在 clarify 確認 | 通過 |
| II 測試先行 | 解析器是純函式，先以 fixtures 寫失敗測試；每個 user story 先列測試 task | 通過 |
| III 輸入驗證與清楚錯誤 | 上傳的檔案與連結都驗證；每種失敗有錯誤代碼與含位置的中文訊息；讀取路徑沒有寫入，失敗不可能改資料 | 通過 |
| IV 機敏資料零落地 | 不使用 Google 金鑰；token 走 `Authorization` 標頭不進網址；log 不記錄 token、檔案內容、連結查詢字串 | 通過 |
| V 依結構定位 | 以表頭內容與合併範圍定位；空格位置是解析結果，不是寫死的座標；以 8 份版面不同的 fixtures 驗證 | 通過 |
| VI 伺服器是唯一裁判 | 身分與階段在伺服器檢查；學生與訪客快照不含題目（FR-016） | 通過 |
| VII 圖表生成 | specify 階段的 3 張圖已存在；對應見下方「圖表與模組對應」；tasks 最後含一致性檢查 | 通過 |
| VIII 可追溯 | contracts、tasks、測試標註 FR 與 AC 編號 | 通過 |
| IX 設計規範先於介面實作 | 匯入畫面只用 `tokens.css` 變數 | 通過（同 001 的條件） |

**對 001 的影響**：FR-020 讓 001 的 `activity:open` 多一個檢查（`QUESTIONS_REQUIRED`），001 的整合測試與 e2e 要先建立題目。這是 001 data-model 已預告的行為（「002 完成後另需要至少一題」），不是新的行為決定。

Phase 1 設計完成後重新檢查：結果相同，沒有違反項目。

## 圖表與模組對應（原則 VII）

| 組件圖（`diagrams/002-*-component.puml`） | 模組 |
|---|---|
| 匯入入口 (Import Gateway) | `server/src/infra/http/questionRoutes.ts`（讀取）、`server/src/app/importService.ts`（讀取結果暫存、確認）、Socket 指令 `questions:confirm` |
| 試算表取得 (Sheet Fetcher) | `server/src/infra/sheets/googleSheetsFetcher.ts` |
| 學習單解析 (Guided Notes Parser) | `server/src/infra/xlsx/workbookReader.ts`（xlsx → `SheetGrid`）、`server/src/domain/guidedNotesParser.ts` |
| 匯入驗證 (Import Validator) | `server/src/domain/importValidator.ts` |
| 題目庫 (Question Bank) | `server/src/app/questionBank.ts`、`server/src/infra/db/questionRepo.ts` |
| 活動階段管理（001） | 沿用；`server/src/domain/activity.ts` 的 `open` 增加題目檢查 |
| 老師端畫面 | `web/src/features/teacher/QuestionImport.tsx`、`QuestionList.tsx` |

| 類別圖（`diagrams/002-*-class.puml`） | 程式中的型別 |
|---|---|
| 學習單、來源種類 | `GuidedNotesSource`、`GuidedNotesRecord`、`GuidedNotesMeta`（`questionRepo.ts`）；`sourceKind` 為 `'link' \| 'file'` |
| 表頭位置 | `HeaderLocation` |
| 題目、題目類型 | `QuestionKind`；解析 `ParsedQuestion`；寫入／讀取 `QuestionInput`／`StoredQuestion` |
| 空格 | 解析 `ParsedBlank`；寫入 `BlankInput`；摘要 `ImportSummaryBlank` |
| 匯入摘要 | `ImportSummary` |
| 匯入錯誤 | domain 的 `ParseFailure`、`ImportValidationFailure`；服務的 `PreviewFailure`；HTTP／socket 的 `{ error: { code, message } }` |
| 老師快照 | `TeacherSnapshot` 的 `questions: QuestionSummary[]`、`guidedNotes: GuidedNotesInfo \| null` |
| 學習單解析器 | `parseGuidedNotes()`、`findHeader()`（`guidedNotesParser.ts`）；輸入 `SheetGrid[]` 由 `workbookReader` 產生 |
| 題目庫 | `QuestionBank`（`questionBank.ts`） |

時序圖（`diagrams/002-*-seq-import.puml`）的步驟依序對應：`questionRoutes` 檢查身分與階段 → `googleSheetsFetcher`（連結）或大小檢查（檔案）→ `workbookReader` → `parseGuidedNotes` → `validateImport` → 回傳摘要 → `questions:confirm` → `QuestionBank.replace`。

## Project Structure

### Documentation (this feature)

```text
specs/002-guided-notes-import/
├── plan.md
├── research.md          # 002 新增的決策
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # 讀取端點與錯誤代碼
│   └── socket-events.md # questions:confirm、快照延伸
└── tasks.md             # /speckit-tasks 產生
```

### Source Code（新增與修改的檔案）

```text
shared/src/
├── protocol.ts              # 修改：新錯誤代碼、QuestionSummary、TeacherSnapshot 延伸、ImportSummary
└── schemas.ts               # 修改：questions:confirm、import/link 請求

server/src/
├── domain/
│   ├── sheetGrid.ts         # 新增：SheetGrid 型別與儲存格工具（A1 轉換、合併範圍查詢）
│   ├── guidedNotesParser.ts # 新增：找表頭、選工作表、逐列讀題目與空格、前綴
│   ├── importValidator.ts   # 新增：重複題號、提醒事項（找不到表頭、沒有題目由解析器判定）
│   └── activity.ts          # 修改：open 檢查題目數
├── app/
│   ├── importService.ts     # 新增：讀取（解析＋暫存）、確認（取代＋revision）
│   ├── questionBank.ts      # 新增：取代、清單、是否有題目
│   ├── activityCommands.ts  # 修改：open 傳入題目數
│   └── snapshot.ts          # 修改：老師快照加 questions、guidedNotes
├── infra/
│   ├── xlsx/workbookReader.ts        # 新增：exceljs → SheetGrid；解壓大小檢查
│   ├── sheets/googleSheetsFetcher.ts # 新增：連結驗證、下載、轉址與大小限制
│   ├── http/questionRoutes.ts        # 新增：兩個讀取端點、Bearer 身分
│   ├── http/app.ts                   # 修改：掛上 questionRoutes
│   └── db/database.ts、questionRepo.ts # 修改／新增：三張表
└── index.ts                 # 修改：註冊 questions:confirm

server/tests/
├── unit/guidedNotesParser.test.ts    # 手寫 SheetGrid 的邊界情況
├── unit/importValidator.test.ts
├── integration/fixtures.test.ts      # 逐一比對 expected.json（SC-001、SC-002）
├── integration/questionImport.test.ts # HTTP 讀取、確認、取消、取代、權限、階段
└── integration/googleSheetsLink.test.ts # 以假的 fetch 測連結驗證、未開放、逾時、轉址

web/src/features/teacher/
├── QuestionImport.tsx       # 新增：連結／上傳、摘要、確認／取消、取代提示、錯誤
├── QuestionList.tsx         # 新增：題號清單
└── TeacherPage.tsx          # 修改：加入上面兩個元件
web/src/lib/api.ts           # 修改：importFromFile、importFromLink

e2e/tests/002-guided-notes-import.spec.ts # 新增：上傳 01、確認、開啟搶答
```

**Structure Decision**: 沿用 001 的三層結構。解析規則放在 domain，輸入是與 exceljs 無關的 `SheetGrid`，讓 004 匯出與之後換套件都不影響解析器。

## Complexity Tracking

沒有違反 constitution 的項目，不需填寫。
