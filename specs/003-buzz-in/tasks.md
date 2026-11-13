---
description: "Task list for 003 搶答作答與結果"
---

# Tasks: 搶答作答與結果（buzz-in）

**Input**: Design documents from `/specs/003-buzz-in/`

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/、quickstart.md

**Tests**: 必須包含。Constitution 原則 II 要求測試先行：每個 user story 先寫測試並確認失敗，再實作。

**Organization**: 依 user story 分 Phase。US1–US4 同為 P1，依核心價值排序：US1 送出與順位（MVP）→ US2 可見範圍 → US3 老師看板與作廢 → US4 結果。US5（題組）、US6（保存與草稿）為 P2。US1 先以既有全域廣播與 `activity.revision + 1` 達成本組同步，US2 再依 research R4 換成分開 counter 與定向送出（SC-002）；這是計畫好的中間狀態，不是 US1 的驗收範圍。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、不依賴未完成的 task）
- **[Story]**: 對應 spec.md 的 user story
- 每個 task 都寫明檔案路徑；括號內是對應的 FR、AC 與 research 編號

## Path Conventions

沿用 001、002：npm workspaces `shared/`、`server/`、`web/`、`e2e/`（見 plan.md）。

## 每個 Phase 的完成條件（適用全部 Phase）

1. 該 Phase 的測試先寫、先確認失敗，實作後全部通過。
2. 執行 `npm test` 與 `npm run check`（含 e2e task 的 Phase 加 `npm run test:e2e`），回報指令與實際輸出。
3. 不修改本 Phase 範圍以外的檔案；發現規格有洞或與 Feature Contract 牴觸時停下回報，不自行決定行為。
4. 伺服器 log 沿用 commandRouter 現有做法：只記錄事件名稱與錯誤代碼，不記錄答案內容（原則 III、IV）。

---

## Phase 1: Setup（基準確認）

**Purpose**: 003 不新增依賴（plan.md：沿用 001、002）；確認起點是綠燈。

- [x] T001 在 `003-buzz-in` 分支執行 `npm test`、`npm run test:e2e`、`npm run check`，確認 001、002 全部通過並記下輸出作為基準；有任何失敗先停下回報，不開始實作

**Checkpoint**: 三個指令全綠。

---

## Phase 2: Foundational（所有 user story 的共同基礎）

**Purpose**: 共用型別、schema、資料表與兩個純函式領域模組。

**⚠️ CRITICAL**: 本 Phase 完成前不得開始任何 user story。

- [x] T002 在 `shared/src/protocol.ts` 新增：錯誤代碼 `QUESTION_NOT_FOUND`、`BLANK_COUNT_MISMATCH`、`ANSWER_EMPTY`、`ANSWER_TOO_LONG`、`ALREADY_SUBMITTED`、`SUBMISSION_NOT_FOUND`（加入 `ERROR_CODES` 與 `ERROR_MESSAGES`，繁中訊息照 contracts/socket-events.md「新增錯誤代碼」表）；型別 `AnswerState = 'not_submitted' | 'submitted' | 'voided'`、`StudentQuestion`、`StudentOpenAnswer`、`StudentClosedAnswer`、`QuestionResult`、`AnswerBoardCell`、`AnswerBoardQuestion`、`AnswerProgress`（contracts/socket-events.md）；`COMMAND_EVENTS` 與 `CommandPayloads` 加入 `answer:submit`、`answer:void`。`StudentSnapshot` 的 phase union 重整在 T016、`TeacherSnapshot` 的 `board`/`progress` 在 T030 進行，避免本 Phase 讓 `snapshot.ts` 編譯失敗
- [x] T003 在 `shared/src/schemas.ts` 新增 `answer:submit` 的 `{ questionNumber: 正整數, answers: string[] }` 與 `answer:void` 的 `{ groupId: string, questionNumber: 正整數 }` schema；兩者都拒絕多餘欄位，學生 payload 帶 `groupId` 即 `INVALID_INPUT`（FR-018；research R1）
- [x] T004 [P] 寫 `server/tests/unit/database.test.ts` 新案例：`submissions`（`rank > 0` CHECK、`UNIQUE(question_id, rank)`、`(question_id, group_id) WHERE voided_at IS NULL` partial unique、groups/questions 外鍵 ON DELETE CASCADE）、`submission_answers`（`PRIMARY KEY (submission_id, blank_position)`、`blank_position > 0`）、`group_answer_revisions`（`group_id` 主鍵、`answer_revision >= 0`）；`activity` 增加 `session_id` 與 `answer_event_count INTEGER NOT NULL DEFAULT 0`；既有資料庫 migration 後舊 activity 列補隨機 `session_id`（data-model.md「SQLite 資料表」）
- [x] T005 在 `server/src/infra/db/database.ts` 實作 migration（讓 T004 通過）：新資料庫直接建表；既有資料庫 `ALTER TABLE` 補欄，`session_id` 補隨機值
- [x] T006 [P] 寫 `server/tests/unit/answerValidation.test.ts`：trim 半形與全形空白（U+3000）後以 Unicode code point 計 1–200；200 個 BMP 字元通過、1 個代理對 emoji（2 個 UTF-16 code unit）算 1 個字元通過、201 code point 拒絕；空字串與純空白拒絕；trim 後才計長度；答案含 `<script>`、反引號等特殊字元時照原字保留（FR-006；research R6）
- [x] T007 在 `server/src/domain/answerValidation.ts` 實作（讓 T006 通過）：Unicode trim、以 code point 計長度（不得用 `String.length`）、回傳 `ANSWER_EMPTY`／`ANSWER_TOO_LONG`（FR-006；research R6）
- [x] T008 [P] 寫 `server/tests/unit/answerRanks.test.ts`：`decideWinner` — 無作答 → null；rank 1 有效 → rank 1；rank 1 已作廢、rank 2 有效 → rank 2；中間順位作廢 → 最小有效 rank；全部作廢 → null（FR-010、FR-014；research R3）
- [x] T009 在 `server/src/domain/answerRanks.ts` 實作 `decideWinner(submissions)` 純函式（讓 T008 通過）：輸入一題所有 Submission，輸出最小有效 rank 的作答或 null；005 的公平機制只替換此函式（FR-014；research R3）

**Checkpoint**: 001、002 的測試仍全綠；`npm test` 通過新增的 database、answerValidation、answerRanks 案例。

---

## Phase 3: User Story 1 - 學生以組別送出答案，最快者搶答成功（Priority: P1）🎯 MVP

**Goal**: 學生在搶答中看到所有題號並以組別送出；伺服器在同一 transaction 給出每題獨立、不重複的順位；同組成員 2 秒內看到已送出與答案。

**Independent Test**: 整合測試兩組先後送出同一題，rank 為 1、2；同組另一成員收到新快照顯示已送出。老師端看板呈現屬 US3，本 Phase 以資料庫與學生快照驗證順位。

### Tests for User Story 1 ⚠️ 先寫、先失敗

- [x] T010 [P] [US1] 寫 `server/tests/integration/answerCommands.test.ts`（以 002 的 helpers 建立組別與題目）：準備中送出 → `INVALID_PHASE`（AC-003-02）；open 單空格題送出成功、ack `{ ok: true }` 且不含 rank；題號不存在 → `QUESTION_NOT_FOUND`；`answers` 長度不等於空格數 → `BLANK_COUNT_MISMATCH`；空答案與純空白 → `ANSWER_EMPTY`；超過 200 code point → `ANSWER_TOO_LONG`；同組重複送出 → `ALREADY_SUBMITTED` 且原 rank 不變（AC-003-04；SC-007）；兩組先後送出 → rank 1、2（AC-003-03）；不同組在不同題目各自最先送出 → 各題 rank 從 1 獨立計算（AC-003-07）；同組兩連線以 `Promise.all` 幾乎同時送出 → 只有先送達的成功（AC-003-06）；10 個組別對同一題送出 → rank 1–10 各出現一次（SC-001）；guest 與 teacher 送 `answer:submit` → `FORBIDDEN`；payload 多帶 `groupId` → `INVALID_INPUT`（FR-018）；每種失敗後作答數、rank 與快照完全不變（原則 III）
- [x] T011 [P] [US1] 寫 `server/tests/unit/snapshot.test.ts` 新案例：學生 preparing 快照只有 `sessionId`，沒有 `questions`、`myAnswers`（FR-002；002 FR-016）；open 快照有 `sessionId`、`questions`（題號、kind、prompt、每空格 prefix）與 `myAnswers` 每題一筆（未送出 `state: 'not_submitted'`、`answers: []`；已送出含本組最新答案），絕不含 `rank` 欄位（AC-003-01；FR-002、FR-005、FR-015、FR-017）；guest 快照沒有 `sessionId`、`questions`、`myAnswers`（FR-016）

### Implementation for User Story 1

- [x] T012 [P] [US1] 新增 `server/src/infra/db/answerRepo.ts`：`insertSubmission`（同一 transaction 寫入 submission 與全部 submission_answers）、`findValid(questionId, groupId)`、`maxRank(questionId)`（含已作廢）、`listByQuestion(questionId)`、`listValidByGroup(groupId)`；新 rank 一律 `max(rank) + 1`（FR-009、FR-011；research R2）
- [x] T013 [P] [US1] 在 `server/src/infra/db/activityRepo.ts` 新增 `getSessionId()` 與 `newSessionId()`（隨機字串；data-model「Activity 延伸」）
- [x] T014 [US1] 新增 `server/src/app/answerCommands.ts` 的 submit 用例：依 contracts「answer:submit 觸發順序」在同一同步 transaction 完成 phase → 題號 → 空格數 → 每格 trim 與長度 → 重複檢查 → `max(rank)+1` → 寫入（FR-001、FR-003–FR-009）；組別一律取自連線身分（FR-018）。US1 先以 `activity.revision + 1` 與既有全域 role-filtered 廣播讓本組與老師即時更新（AC-003-05）；US2 的 T022–T024 依 research R4 換成分開 counter 與定向送出
- [x] T015 [US1] 新增 `server/src/app/answerProjections.ts` 的 `buildMyAnswers(groupId)`：每題一筆 `StudentOpenAnswer`，依題目 position 順序（research R5）
- [x] T016 [US1] 在 `server/src/app/snapshot.ts` 把學生快照改為 contracts 的 phase union：preparing 加 `sessionId`；open 加 `sessionId`、`questions`、`myAnswers`（不含 rank）；closed 分支先只有基礎欄位（`sessionId` 等），US4 的 T035 補上 `questions`、`results` 與 `myAnswers`（contracts/socket-events.md「快照」）
- [x] T017 [US1] 在 `server/src/infra/socket/commandRouter.ts` 與 `server/src/index.ts` 註冊 `answer:submit`（student；open 由用例檢查），成功後廣播 state、回 ack（讓 T010、T011 通過）
- [x] T018 [P] [US1] 新增 `web/src/features/student/AnswerArea.tsx`（＋`.module.css`，只用 `tokens.css` 變數）：題號與題目敘述、每空格 input（標示前綴）、送出按鈕、已送出後鎖定不能再輸入、伺服器錯誤以繁中訊息顯示（AC-003-01、08；SC-004：填寫 → 送出在 3 個操作步驟內；research R9）
- [x] T019 [US1] 在 `web/src/features/student/StudentPage.tsx` 依 phase 掛上 `AnswerArea`（open 時）；`web/src/lib/useSnapshot.ts` 的 revision 單調接受規則維持不變（plan.md）
- [x] T020 [US1] 新增 `e2e/tests/003-buzz-in.spec.ts` 基本流程：老師以 `fixtures/guided-notes/01-official-single.xlsx` 匯入並開搶答；兩組學生作答送出、2 秒內顯示已送出與答案並鎖定；重複送出與空答案被拒並顯示訊息（AC-003-01、03、04、05、08）

**Checkpoint**: `npm test`、`npm run test:e2e`、`npm run check` 全部通過；MVP — 學生可送出、順位每題獨立且不重複、本組即時同步。

---

## Phase 4: User Story 2 - 搶答結束前，學生看不到其他組的狀況（Priority: P1）

**Goal**: SC-002 三個層面都不洩漏：快照內容、revision 與封包。作答事件只送老師與該組，其他組與 guest 的 revision 不變。

**Independent Test**: 第一組送出第 1 題後，第二組連線收到的 `state` 封包數為 0、revision 不變、快照沒有任何第一組資訊；guest 亦同。

### Tests for User Story 2 ⚠️ 先寫、先失敗

- [x] T021 [P] [US2] 寫 `server/tests/integration/answerVisibility.test.ts`：A 組送出前先在 B 組與 guest 連線掛 `state` 事件計數器；A 組送出成功後等待一小段時間，B 組與 guest 收到的 `state` 封包數為 0（AC-003-09；contracts「revision 與誰收到 state」）；B 組快照 revision 不因 A 組事件改變（= `activity.revision` + 本組 `answerRevision`），A 組與老師各自 +1（FR-005、FR-016、FR-021；SC-002）；B 組送出後只看到 `submitted` 與自己的答案，快照與 ack 都沒有 rank（AC-003-11；FR-017）；B 組 payload 帶 A 組 `groupId` 或以其他身分讀取 → `INVALID_INPUT`／`FORBIDDEN`（AC-003-12；FR-018）；學生快照沒有 `board`、`progress`、`results` 欄位（FR-016）

### Implementation for User Story 2

- [x] T022 [US2] 分開計數：`answerRepo`/`activityRepo` 提供 `group_answer_revisions` 的讀取與 +1、`answer_event_count` 的 +1；`answerCommands` submit 成功後該組 `answerRevision +1`、全域 `answerEventCount +1`，不再修改 `activity.revision`（data-model「GroupAnswerRevision」「Activity 延伸」；research R4）
- [x] T023 [US2] 在 `server/src/app/snapshot.ts` 依身分計算 revision：teacher = `activity.revision + answerEventCount`；student = `activity.revision + 本組 answerRevision`；guest = `activity.revision`（contracts「revision 與誰收到 state」；research R4）
- [x] T024 [US2] 在 `server/src/infra/socket/broadcaster.ts` 新增 `broadcastSubmissionChanged(groupId)`：只對所有 teacher 連線與該組 student 連線送 `state`；`server/src/infra/socket/commandRouter.ts` 支援指令自訂廣播範圍（既有指令仍全域）；`answerCommands` submit 成功後改用定向廣播（讓 T021 通過；FR-016；research R4）
- [x] T025 [US2] 修正學生離場的 revision 倒退（2026-11-13 使用者決策；contracts 未定義降級連線客戶端行為的規格洞）：在 `web/src/lib/useSnapshot.ts` 讓快照 role 變換（student→guest）時重設 revision 比較基準（把既有「身分改變時 revision 可能不變，所以新連線要重設比較基準」的原則延伸到同連線的身分變換）；在 `web/tests/useSnapshot.test.tsx` 新案例：先接受 student 快照（revision 較大）後收到 role 為 guest 的較小 revision 快照，必須被接受；在 `e2e/tests/003-buzz-in.spec.ts` 補「送出 → 結束 → 重設 → 離開」流程：該組曾有作答後，學生按離開，畫面回到選組畫面（FR-026、FR-028 的客戶端行為）

**Checkpoint**: SC-002 以封包層測試通過；001、002 測試仍全綠（既有指令的廣播行為不變）。

---

## Phase 5: User Story 3 - 老師即時檢視作答狀況（Priority: P1）

**Goal**: 老師即時看到題 × 組看板（狀態、答案、rank、搶答成功）與進度，並可在搶答中作廢某組某題讓該組重新送出。

**Independent Test**: 看板開啟中兩組陸續送出，2 秒內更新且 rank 正確；作廢第一組後第二組成為搶答成功，第一組重送得到排在最後的新 rank。

**2026-11-13 拆分**：看板與進度屬 Feature Contract 既有 C4／D9 共識（Default），先行實作（T027、T029、T030、T032、T033）；作廢（FR-029、FR-030）是 11/12 新增行為，等 OpenSpec 組同意後實作（T026、T028、T031、T053）。

### Tests for User Story 3 ⚠️ 先寫、先失敗

- [ ] T026 [P] [US3] **（作廢，等 OpenSpec）** 在 `server/tests/integration/answerCommands.test.ts` 新增作廢案例：老師作廢成功 → ack `{ ok: true }`、`voided_at` 已設定、Submission 與 SubmissionAnswer 保留；組別或題號不存在 → `GROUP_NOT_FOUND`／`QUESTION_NOT_FOUND`；該組該題未送出或已作廢 → `SUBMISSION_NOT_FOUND`；非 open 階段 → `INVALID_PHASE`（AC-003-31）；作廢後其他組 rank 不變、該組重送得到 `max(rank)+1`（AC-003-29、30）；同筆作廢兩次 → `SUBMISSION_NOT_FOUND`（Edge Cases）；student 送 `answer:void` → `FORBIDDEN`；每種失敗後資料不變（原則 III）；看板的作廢顯示（原 T027 案例，2026-11-13 移入）：某組作廢未重送 → board cell 顯示最新作廢作答 `state: 'voided'`、progress 不計（FR-029）；作廢事件只送老師與該組，其他組封包數 0（FR-030）
- [x] T027 [P] [US3] 寫 `server/tests/unit/snapshot.test.ts` 與 `server/tests/integration/answerVisibility.test.ts` 的看板案例：老師快照任何階段都有 `board`（每題每組 cell：state、answers、rank；`winnerGroupId` = `decideWinner` 結果）與 `progress`（perQuestion 有效送出組數、perGroup 有效送出題數）（AC-003-13、15；FR-019–FR-022）；題組 cell 的 `answers` 依 blank position 順序（AC-003-25 老師側）；closed 後看板維持結束當下內容（AC-003-16）；作答事件送出後老師快照即時更新（FR-021）

### Implementation for User Story 3

- [ ] T028 [US3] **（作廢，等 OpenSpec）** 在 `server/src/infra/db/answerRepo.ts` 新增 `voidSubmission(questionId, groupId, now)`（同一 transaction 設 `voided_at`）與 `findLatest(questionId, groupId)`（含已作廢，取最新一筆；語意與 `buildClosedMyAnswers` 的 `.at(-1)`（rank 最大＝最新）一致，見 docs/verification/003-security-review-midcourse.md）（FR-029；research R2）
- [x] T029 [US3] 在 `server/src/app/answerProjections.ts` 新增 `buildBoard()` 與 `buildProgress()`：board 每題每組固定一筆 cell 並以 `decideWinner` 標示 winner；cell 依契約取該組最新 Submission（有有效作答顯示之；最新作廢判定與 `findLatest` 同語意，作廢資料在 T026 範圍才會出現）；progress 只計 `voided_at IS NULL`（FR-019、FR-020；research R3、R5）
- [x] T030 [US3] 在 `shared/src/protocol.ts` 的 `TeacherSnapshot` 加 `board` 與 `progress`，並在 `server/src/app/snapshot.ts` 的老師快照（任何階段）輸出（FR-019–FR-022）
- [ ] T031 [US3] **（作廢，等 OpenSpec）** 在 `server/src/app/answerCommands.ts` 新增 void 用例並在 `commandRouter`/`index.ts` 註冊 `answer:void`（teacher；open 由用例檢查）：依 contracts「answer:void 觸發順序」在同一 transaction 完成檢查與作廢、兩個 counter +1、定向廣播（讓 T026 通過；FR-029、FR-030）
- [x] T032 [US3] 新增 `web/src/features/teacher/AnswerBoard.tsx`（＋`.module.css`，只用 `tokens.css`）：題 × 組表格（狀態、每空格答案、rank、搶答成功標示）與進度摘要（research R9）；在 `web/src/features/teacher/TeacherPage.tsx` 掛上（作廢按鈕在 T053）
- [x] T033 [US3] 在 `e2e/tests/003-buzz-in.spec.ts` 加入：看板在送出後 2 秒內更新、各題 rank 與搶答成功標示、進度摘要正確（AC-003-13–15；quickstart 步驟 9、10 的看板部分）
- [ ] T053 [US3] **（作廢，等 OpenSpec；2026-11-13 自 T032、T033 拆出）** 作廢的 UI 與 e2e：`AnswerBoard.tsx` 已送出格加「作廢」按鈕 — 按第一次展開「確認／取消」，確認才送 `answer:void`，ack 失敗顯示訊息（research R9）；e2e 補作廢 → 取消 → 再按作廢與確認、第二組成為搶答成功、進度更新、同組重送得到新 rank 的流程（AC-003-29、30；quickstart 步驟 14–17）

**Checkpoint（看板）**: AC-003-13–16 通過；老師可即時檢視每題各組狀態、答案、順位與進度。
**Checkpoint（作廢，等 OpenSpec）**: AC-003-29–31 通過；老師端完整，可實機示範完整搶答課堂流程。

---

## Phase 6: User Story 4 - 搶答結束後檢視結果（Priority: P1）

**Goal**: 老師結束後，學生看到每題搶答成功組別與答案，以及自己組每題的答案與順位；重新整理後不變。

**Independent Test**: 兩組送出數題後結束搶答，兩組學生畫面顯示各題 winner、自己的答案與 rank；未送出題目顯示未作答、無人作答題目顯示無人作答。

### Tests for User Story 4 ⚠️ 先寫、先失敗

- [x] T034 [P] [US4] 寫整合測試（`server/tests/integration/answerCommands.test.ts` 新案例或新檔）：closed 後 `answer:submit` 與 `answer:void` → `INVALID_PHASE` 且結果不變（AC-003-20、31；FR-013）；closed 學生快照有 `questions`、`results`（每題 `winner`＝`decideWinner`，含組名與每空格答案；無有效作答為 null）與 `myAnswers`（每題 state、answers、`rank`；未送出或作廢為 null）（AC-003-17–19；FR-023–FR-025）；`activity:close` 後學生連線收到含 results 的 closed 快照（SC-005）；重新連線後內容相同（AC-003-21）

### Implementation for User Story 4

- [x] T035 [US4] 在 `server/src/app/answerProjections.ts` 新增 `buildResults()`（`QuestionResult[]`，只以 `decideWinner` 判定）；在 `shared/src/protocol.ts` 完成 `StudentClosedSnapshot`（`questions`、`results`、含 rank 的 `myAnswers`）並在 `server/src/app/snapshot.ts` 輸出 closed 學生快照（FR-023–FR-025；research R3、R5）
- [x] T036 [US4] 新增 `web/src/features/student/StudentResults.tsx`（＋`.module.css`，只用 `tokens.css`）：每題搶答成功組別與每空格答案、本組答案與順位、未作答與無人作答標示（AC-003-17–19）；在 `web/src/features/student/StudentPage.tsx` closed 時掛上
- [x] T037 [US4] 在 `e2e/tests/003-buzz-in.spec.ts` 加入：結束搶答 → 2 秒內切到結果（AC-003-17；SC-005）、各組看到自己答案與 rank（AC-003-18）、重新整理後結果不變（AC-003-21）、結束後送出與作廢都被拒（AC-003-20、31；quickstart 步驟 18–21）

**Checkpoint**: AC-003-17–21 通過；US1–US4 的 P1 需求全部完成。

---

## Phase 7: User Story 5 - 題組必須整題一起送出（Priority: P2）

**Goal**: 題組（一題多空格）所有空格填滿才能送出，整題一起記錄、只占一個順位；顯示時依前綴順序。

**Independent Test**: 以 `fixtures/guided-notes/02-official-group.xlsx` 匯入，第 1 題只填一個空格送出被拒並指出未填的空格；兩個空格都填後送出成功且該題只有一個 rank。

### Tests for User Story 5 ⚠️ 先寫、先失敗

- [x] T038 [P] [US5] 在 `server/tests/integration/answerCommands.test.ts` 新增題組案例（helpers 增加建立題組題目的工具）：2 空格題只送 1 個答案 → `BLANK_COUNT_MISMATCH`；答案含空值 → `ANSWER_EMPTY` 且不占用 rank（AC-003-23）；兩個空格都填 → 兩個答案一起記錄、該題只有一個 rank（AC-003-24）；closed 學生快照 results 與 myAnswers 的 `answers` 依 blank position 順序（AC-003-25 學生側；老師看板側在 T027，2026-11-13 中程複查後調整）；題組與單題混合時各題順位獨立（AC-003-07）

### Implementation for User Story 5

- [x] T039 [P] [US5] `web/src/features/student/AnswerArea.tsx`：題組每個空格顯示前綴「（1）」「（2）」的輸入欄（AC-003-22）；送出前檢查並指出還沒填的空格（AC-003-23）
- [x] T040 [P] [US5] `web/src/features/teacher/AnswerBoard.tsx` 與 `web/src/features/student/StudentResults.tsx`：題組的每個空格答案依前綴順序顯示（AC-003-25）
- [x] T041 [US5] 在 `e2e/tests/003-buzz-in.spec.ts` 加入：以 02 匯入後第 1、2 題顯示兩個前綴輸入欄（AC-003-22）；只填一格送出被拒並指出未填空格、填滿後送出成功（quickstart 步驟 3、5 的題組版）

**Checkpoint**: AC-003-22–25 通過。

---

## Phase 8: User Story 6 - 作答中斷後不遺失（Priority: P2）

**Goal**: 已送出的答案與順位在重新整理、斷線重連、系統重啟後不變；未送出草稿留在裝置上，重設活動或題目被取代後清除。

**Independent Test**: 送出後重新整理仍顯示已送出與原答案；重啟伺服器後 rank 不變；重設活動後作答清空、學生草稿被清除。

### Tests for User Story 6 ⚠️ 先寫、先失敗

- [x] T042 [P] [US6] 寫 `server/tests/integration/answerPersistence.test.ts`：多組送出後重啟伺服器（沿用 001 restart 測試做法）→ Submission、rank、`answerRevision`、`answerEventCount`、`sessionId` 與重啟前完全相同（AC-003-27；SC-006；FR-026）；`activity:reset` → Submission 與 SubmissionAnswer 全部刪除、`sessionId` 換新、兩個 counter 不歸零且快照 revision 不回頭（FR-028；data-model「狀態與轉換」）；`questions:confirm` 取代題目 → `sessionId` 換新（AC-003-32；FR-027）

### Implementation for User Story 6

- [x] T043 [US6] 在 `server/src/infra/db/answerRepo.ts` 新增 `clearAll()`，並在 `server/src/app/activityCommands.ts` 的 reset 以同一 transaction 呼叫、換新 `sessionId`，counter 不歸零（FR-028；research R8）
- [x] T044 [P] [US6] 在 `server/src/app/importService.ts` 的 `questions:confirm` 成功取代題目時換新 `sessionId`（AC-003-32；research R8）
- [x] T045 [P] [US6] 新增 `web/src/features/student/answerDrafts.ts`：草稿存 localStorage，key 為 `classroom.buzz-in.drafts.<sessionId>.<groupId>`，依題號存尚未送出的答案；快照 `sessionId` 與前次不同時移除非目前 `sessionId` 的草稿 key（不得使用整體 `clear()`）；`AnswerArea.tsx` 接上草稿讀寫（AC-003-28、32；FR-027；research R7）
- [x] T046 [US6] 在 `e2e/tests/003-buzz-in.spec.ts` 加入：填到一半重新整理 → 未送出內容還在、已送出仍顯示（AC-003-26、28）；重設活動 → 草稿清除、作答區是空的（AC-003-32；quickstart 步驟 12、22、23）

**Checkpoint**: AC-003-26–28、32 通過；SC-006 達成。

---

## Phase 9: Polish 與驗證

**Purpose**: 安全覆核、圖與程式一致性、文件、驗證紀錄。

- [ ] T047 [P] **安全覆核**（GLM worker，只回報不改程式）：可見範圍（SC-002 的封包與快照兩層）、rank 競態與 transaction 邊界、payload 偽造與身分檢查、輸入驗證、log 不含答案內容、localStorage 草稿存取；監督者把發現整理成修正 task 或記入 `docs/verification/003-security-review.md`
- [ ] T048 **圖與程式一致性檢查（原則 VII）**：依 plan.md「圖表與模組對應」逐列核對 `diagrams/003-buzz-in-*.puml` 的元件與型別在程式中存在、名稱與關係一致；有差異時修正程式，或修正 `.puml` 並重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh`；結果寫入 `docs/verification/003-diagram-consistency.md`
- [ ] T049 [P] 更新根目錄 `README.md`：操作流程加入學生作答、老師看板與作廢、結果步驟；測試說明加入 003
- [ ] T050 執行 `npm test`、`npm run test:e2e`、`npm run check`、`npm audit`，把指令與輸出記錄在 `docs/verification/003-automated.md`（含 SC-001–SC-007 各由哪個測試涵蓋）
- [ ] T051 [P] **畫面截圖（constitution 原則 IX）**：以 Playwright 擷取作答區（單題與題組）、已送出鎖定、老師看板與進度、作廢確認、結果畫面，存到 `docs/verification/003-screenshots/`，交設計負責人驗收
- [ ] T052 **人工驗證**（由設計與驗證負責人執行）：依 quickstart.md 的 23 個步驟操作，結果記錄在 `docs/verification/003-manual.md`；問題另開 GitHub issue

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：無依賴（001、002 已完成）。
- **Phase 2 Foundational**：依賴 Phase 1；擋住所有 user story。
- **Phase 3 US1**：依賴 Phase 2。
- **Phase 4 US2**：依賴 US1（把 submit 的廣播與 revision 換成 R4 機制）。
- **Phase 5 US3**：依賴 US2。**2026-11-13 拆分：看板與進度（T027、T029、T030、T032、T033）屬 Feature Contract 既有 C4/D9 共識，已先行實作；作廢（T026、T028、T031、T053）等 OpenSpec 組同意（spec Assumptions、playbook §12）。**
- **Phase 6 US4**：依賴 US1、US2；與 US3 共用 `answerProjections.ts`、`snapshot.ts`。**2026-11-13：因 US3 暫緩而先於 US3 實作，兩者依序執行不平行。**
- **Phase 7 US5**：依賴 US1（送出）與 US4（結果顯示）。**2026-11-13 調整：US3 暫緩期間先實作學生側（T038、T039、T041）；T040 需要 US3 的 `AnswerBoard.tsx`，US3 同意後做（T040 含 StudentResults 的前綴顯示一併處理）。**
- **Phase 8 US6**：依賴 US1、US2（作答與 counter 已存在）；reset／confirm 觸及 001、002 檔案。**2026-11-13：因 US3 暫緩而提前於 US5 之前實作。**
- **Phase 9 Polish**：依賴前面所有 Phase。

### User Story Dependencies

- **US1 (P1)**：Foundational 後即可開始，不依賴其他 story。
- **US2 (P1)**：依賴 US1 的 submit 用例；改 `answerCommands.ts`、`snapshot.ts`、`broadcaster.ts`。
- **US3 (P1)**：依賴 US2 的定向廣播與 counter；board／progress 只影響老師快照。
- **US4 (P1)**：依賴 US1（myAnswers）、US2；results 只影響 closed 學生快照。
- **US5 (P2)**：依賴 US1（多空格送出）與 US3、US4（顯示）。
- **US6 (P2)**：依賴 US1、US2；草稿只影響學生前端。

### Within Each User Story

- 測試 task 先做，確認失敗後才做實作 task。
- domain → app → infra → web → e2e。
- 同一檔案的 task 不可平行：`answerCommands.ts`（US1、US2、US3）、`answerCommands.test.ts`（US1、US3、US5）、`snapshot.ts`（US1、US2、US3、US4）、`answerProjections.ts`（US1、US3、US4）、`answerRepo.ts`（US1、US3、US6）、`AnswerArea.tsx`（US1、US5、US6）、`StudentPage.tsx`（US1、US4）、`003-buzz-in.spec.ts`（US1–US6 逐步擴充）。

### Parallel Opportunities

- Phase 2：T004、T006、T008 可平行（先寫三份測試）；T002 完成後 T012 前的型別工作不互相阻塞。
- US1：T010、T011 可平行；T012、T013、T018 可平行。
- US3：T026、T027 可平行。
- US5：T039、T040 可平行。
- US6：T043、T044、T045 可平行。
- Phase 9：T047、T049、T051 可平行。

---

## Implementation Strategy

### MVP First（US1 only）

1. 完成 Phase 1、2（Foundational）。
2. 完成 Phase 3（US1）。
3. **停下驗證**：US1 獨立測試通過，可推上分支讓組員實機測試送出與順位。

### Incremental Delivery

1. Setup + Foundational → 基礎 ready。
2. US1 → MVP（送出與順位）。
3. US2 → SC-002 達成（可見範圍三層防護）。
4. US4 → 結果畫面；US3 看板 → 老師可即時檢視（2026-11-13：看板先行，作廢等 OpenSpec）。
5. US3 作廢（T026、T028、T031、T053）→ T040 → 老師端完整；每個 Phase 都跑全部測試。
6. US5、US6 → P2 額外功能。
7. Phase 9 收尾後執行 `/speckit-converge`，補齊缺漏後開 PR 合併到 `main`；合併前由另一位組員審查。

---

## Notes

- 每個 task 完成後在本檔勾選 `[x]`。
- commit、push、開 PR 之前先問使用者；worker 不執行 git 寫入指令（AGENTS.md）。
- 老師作廢（FR-029、FR-030）依 spec Assumptions 需經 OpenSpec 組同意；US3 開始前確認，牴觸時停下回報。
- US1 的全域廣播與 `activity.revision + 1` 是計畫好的中間狀態；US2 完成前不得把分支標示為支援 SC-002。
- 介面樣式只引用 `web/src/styles/tokens.css`，不寫死色彩、字體（原則 IX）。
- SC-003、SC-005 的 2 秒要求由事件驅動的自動測試與 quickstart 人工驗證涵蓋。
