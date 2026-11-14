# Implementation Plan: 搶答作答與結果（buzz-in）

**Branch**: `003-buzz-in` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-buzz-in/spec.md`

**Note**: 技術架構沿用 [001 research](../001-activity-session/research.md) 與 [002 plan](../002-guided-notes-import/plan.md)。本計畫只描述 003 新增的作答、作廢、看板與結果功能。

## Summary

搶答開始後，學生以組別為單位送出每題的全部空格答案；伺服器依送達順序為每一題產生不重複的順位，有效作答中順位最小者為搶答成功。老師即時檢視題目 × 組別看板、進度與結果，並可在搶答中把某組某題作廢，讓該組重新送出。

技術做法：送出與作廢沿用 Socket.IO 指令路由；送出在同一個同步 transaction 完成驗證、檢查重複、分配順位與寫入。作答事件不移動 `activity.revision`，改用每組 `answerRevision` 與全域 `answerEventCount` 組成快照 revision，並只把 `state` 定向送給老師與相關組別，避免其他組從 revision 跳號得知作答事件。搶答成功判定是純函式；學生在搶答中只收到本組資料，結束後收到結果與本組順位；草稿存在裝置 localStorage，並以活動 `sessionId` 區分。

## Technical Context

**Language/Version**: 沿用 001（TypeScript 5.x、Node.js 24 以上）

**Primary Dependencies**: 沿用 001（Socket.IO、React/Vite、zod）與 002（SQLite repository）；不新增依賴

**Storage**: 沿用 001 的 SQLite（`node:sqlite`）；新增 `submissions`、`submission_answers`、`group_answer_revisions`，並延伸 `activity` 的 `session_id` 與 `answer_event_count`（data-model.md）

**Testing**: 沿用 001（vitest 單元與整合測試、Playwright E2E）；順位與驗證以純函式測試，revision、定向廣播與持久化以真實伺服器與 Socket.IO client 測試

**Target Platform**: 沿用 001（本機伺服器與瀏覽器）；老師與多個學生可分頁操作

**Project Type**: 沿用 001（npm workspaces：`shared`、`server`、`web`）

**Performance Goals**: 某組送出或作廢後，老師與該組學生 2 秒內看到新狀態；老師結束後 2 秒內看到結果（SC-003、SC-005）；單一題目作答 3 個操作步驟內完成（SC-004）

**Constraints**: 順位、階段與可見範圍由伺服器判定（原則 VI、FR-009）；同題同組同時只有一筆有效作答（FR-004）；學生不得從 payload 指定組別（FR-018）；搶答中不得讓其他組從內容或 revision 推知作答（FR-016、SC-002）；答案 trim 後 1–200 個 Unicode code point（FR-006）；介面只用 design tokens（原則 IX）

**Scale/Scope**: 最多 50 組；每份學習單通常 5–30 題；每題至多 50 筆有效作答並保留作廢歷史；本子功能 6 個 user story、30 條 FR

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
|---|---|---|
| I 規格是唯一真相來源 | 只實作 003 spec.md、Feature Contract D1–D10、D19、D22、D23 與 2026-11-12 clarifications；順位、作廢、草稿清除與可見範圍都以本檔與 contracts 為準，不另建行為文件 | 通過 |
| II 測試先行 | `answerValidation`、rank transaction、 `decideWinner`、快照 revision 與定向送出先寫失敗測試；每個 user story 至少一個正常案例與一個邊界案例；快速驗證指令列入 quickstart | 通過 |
| III 輸入驗證與清楚錯誤 | zod 檢查 payload，domain 檢查階段、題號、空格數、內容長度、重複送出與不存在作答；每種失敗有固定錯誤代碼與繁中訊息；失敗 ROLLBACK，不改資料、不廣播 | 通過 |
| IV 機敏資料零落地 | 不新增密碼、金鑰或 HTTP 身分；沿用 token 機制；送出答案與錯誤不寫入 log 的控制仍由指令路由把關 | 通過 |
| V 依結構定位 | 本功能不讀寫外部文件；只使用 002 已依結構保存的題目、空格順序與 prefix | 通過（不涉及） |
| VI 伺服器是唯一裁判 | rank 不採用學生裝置時間；每個 `answer:submit` 在同一同步 transaction 由伺服器判定；快照依身分產生；作答事件只送老師與相關組，不隱藏才沒送的資料 | 通過 |
| VII 圖表生成 | 003 的組件圖、類別圖與兩張時序圖已存在，本檔下方列出模組對應；本計畫補上 `answer:void` 與 R4 定向送出；tasks 最後必須重新產生 PNG 並執行圖表檢查 | 通過 |
| VIII 可追溯 | data-model 每條規則標 FR；contracts 指令、快照與錯誤標 FR/AC；quickstart 的步驟標 AC；子功能需求對應 C3–C4、C6–C11、E1 | 通過 |
| IX 設計規範先於介面實作 | 作答區、看板、確認作廢與結果畫面只做結構與功能，樣式只引用 `tokens.css`，不寫死色彩、字體或樣式 | 通過（同 001、002 的條件） |

**對 001、002 的影響**：`activity:reset` 會在同一 transaction 清空作答資料，並更新 `sessionId`；`questions:confirm` 在取代題目時也更新 `sessionId` 供草稿失效；原有廣播器需要新增「作答事件定向送 state」能力，既有指令仍維持全域送 state。這只是實作 003 已定的可見範圍與草稿規則，不改變 001、002 的使用者行為。

Phase 1 設計完成後重新檢查：結果相同，沒有違反項目。

## 圖表與模組對應（原則 VII）

| 組件圖（`diagrams/003-*-component.puml`） | 模組 |
|---|---|
| 作答受理（Submission Intake） | Socket 指令 `answer:submit`、`server/src/app/answerCommands.ts`、`server/src/infra/db/answerRepo.ts` |
| 作廢受理（Void Intake） | Socket 指令 `answer:void`、`server/src/app/answerCommands.ts` |
| 順位判定（Ranking） | `server/src/domain/answerRanks.ts` transaction 內的 `max(rank) + 1`、`decideWinner()` |
| 可見範圍過濾（Visibility Filter） | `server/src/app/snapshot.ts`，依身分與階段產生 student/teacher/guest 快照 |
| 作答狀況彙整（Board Builder） | `server/src/app/answerProjections.ts` 的老師 `board` 與 `progress` |
| 結果彙整（Result Builder） | `server/src/app/answerProjections.ts` 與 `server/src/domain/answerRanks.ts` 的 `decideWinner()` |
| 狀態同步（001） | `server/src/infra/socket/broadcaster.ts`；新增定向 `broadcastSubmissionChanged(groupId)` |
| 活動階段管理（001） | `server/src/app/activityCommands.ts`；reset 清空作答並更新 `sessionId` |
| 題目庫（002） | `server/src/app/questionBank.ts`、`questionRepo.ts`；提供題號、空格數、prefix |
| 老師端畫面 | `web/src/features/teacher/AnswerBoard.tsx`（看板、進度、作廢確認）、`TeacherPage.tsx` |
| 學生端畫面 | `web/src/features/student/AnswerArea.tsx`、`StudentResults.tsx`、`StudentPage.tsx` |

| 類別圖（`diagrams/003-*-class.puml`） | 程式中的型別 |
|---|---|
| 作答 | `SubmissionRecord`（id、groupId、questionId、rank、receivedAt、voidedAt） |
| 空格答案 | `SubmissionAnswerRecord`（blankPosition、answerText） |
| 作答簿 | `server/src/infra/db/answerRepo.ts` 的 find／insert／void／clear 函式 |
| 受理 | `server/src/domain/answerValidation.ts` 的純函式與 `answerCommands.ts` transaction |
| 順位規則／先到先得規則 | `decideWinner(submissions)`；005 可以更換此純函式 |
| 順位 | `rank: number`；作廢後保留但不參加搶答成功 |
| 作答狀況 | `AnswerBoard`、`AnswerBoardCell`、`AnswerProgress`（shared protocol） |
| 搶答結果 | `QuestionResult`（shared protocol） |
| 作廢 | `answer:void` 的 `VoidSubmissionInput` 與 `voided_at` 欄位 |
| 作答版本計數 | `group_answer_revisions` 與 `activity.answer_event_count` |

時序圖（`diagrams/003-*-seq-submit.puml`）對應：前端指令 → zod/身分 → transaction 驗證與寫入 → counter 更新 → 只送老師與該組 `state` → ack。作廢情境對應：老師確認 → `answer:void` → 同一 transaction 標示 `voided_at` 與 counter 更新 → 只送老師與該組 → 該組重新送出時使用 `max(rank)+1`。

時序圖（`diagrams/003-*-seq-results.puml`）對應：`activity:close` / 倒數到期的既有全域 `state` → closed 學生快照含 `results` 與本組 `rank`；closed 後的 `answer:submit`、`answer:void` 都回 `INVALID_PHASE`，不改資料、不送 `state`。

## Project Structure

### Documentation (this feature)

```text
specs/003-buzz-in/
├── plan.md                 # This file (/speckit-plan command output)
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output
├── quickstart.md           # Phase 1 output
├── contracts/
│   └── socket-events.md    # Phase 1 output
└── tasks.md                # /speckit-tasks 產生；本階段不建立
```

### Source Code（新增與修改的檔案）

```text
shared/src/
├── protocol.ts              # 修改：answer:submit/void、快照型別、作廢與作答錯誤代碼
└── schemas.ts               # 修改：answer:submit、answer:void 的 zod schema

server/src/
├── domain/
│   ├── answerValidation.ts  # 新增：空格數、trim、Unicode code point 長度
│   └── answerRanks.ts       # 新增：decideWinner() 純函式，未來 005 替換
├── app/
│   ├── answerCommands.ts    # 新增：submit／void 的同步 transaction 用例
│   ├── answerProjections.ts # 新增：myAnswers、board、progress、results 投影
│   ├── activityCommands.ts  # 修改：reset 清空作答並更換 sessionId
│   ├── importService.ts     # 修改：questions:confirm 更換 sessionId
│   └── snapshot.ts          # 修改：三種身分與階段的作答欄位、revision 計算
├── infra/
│   ├── db/database.ts       # 修改：新表、索引與 activity 欄位 migration
│   ├── db/activityRepo.ts   # 修改：sessionId 與 answerEventCount
│   ├── db/answerRepo.ts     # 新增：作答讀寫、rank、作廢、counter
│   └── socket/
│       ├── broadcaster.ts   # 修改：作答事件定向送 state
│       └── commandRouter.ts # 修改：支援指令自訂廣播範圍
└── index.ts                 # 修改：註冊 answer:submit、answer:void、reset 掛鉤

server/tests/
├── unit/answerValidation.test.ts       # 題號、空格、Unicode 長度
├── unit/answerRanks.test.ts            # decideWinner、作廢後最小 rank
├── integration/answerCommands.test.ts  # transaction、重複、作廢再送
├── integration/answerVisibility.test.ts # 快照內容、revision、定向送出
└── integration/answerPersistence.test.ts # 重啟與 reset 後資料

web/src/
├── lib/
│   └── useSnapshot.ts       # 修改：維持 revision 單調接受規則
└── features/
    ├── student/
    │   ├── StudentPage.tsx       # 修改：掛上作答區與結果區
    │   ├── AnswerArea.tsx        # 新增：題號、空格、草稿、送出具鎖定狀態
    │   ├── StudentResults.tsx    # 新增：各題搶答成功與本組順位
    │   └── answerDrafts.ts       # 新增：localStorage 草稿與 sessionId 清理
    └── teacher/
        ├── TeacherPage.tsx       # 修改：掛上作答看板
        └── AnswerBoard.tsx       # 新增：題 × 組表格、進度、作廢二次確認

e2e/tests/003-buzz-in.spec.ts # 新增：US1–US6 與作廢、可見範圍、結果流程
```

**Structure Decision**: 沿用 001 的三層結構。驗證與搶答成功判定放 domain，資料一致性放 app transaction 與 repository，Socket.IO 只負責指令入口與依身分定向送出，前端只依完整快照重畫。

## Complexity Tracking

沒有違反 constitution 的項目，不需填寫。
