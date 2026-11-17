# Tasks: 公平順位與投影看板（005）

**Input**: [spec.md](./spec.md)｜**Plan**: [plan.md](./plan.md)｜**Contract**: [contracts/socket-events.md](./contracts/socket-events.md)

**Prerequisites**: [001](../001-activity-session/spec.md)、[002](../002-guided-notes-import/spec.md)、[003](../003-buzz-in/spec.md)、[004](../004-export/spec.md) 已完成並合併

**重要**：本檔是 005 行為與驗收的唯一任務來源；**測試 MUST 先寫並確認失敗**（原則 II）。

---

## Phase 1: Setup

**Goal**: 建立分支與文件骨架，確認既有程式可跑。

- [x] T001 從最新 `main` 開分支 `005-fairness-and-extras`，確認 `npm test`、`npm run check` 在未改動前全過（基線）
- [x] T002 建立 `specs/005-fairness-and-extras/` 的 `research.md`、`data-model.md`、`plan.md`、`contracts/socket-events.md`、`contracts/http-api.md`、`quickstart.md`、`tasks.md`；更新 `docs/shared/FEATURE-CONTRACT.md` 到 v0.5（D13／D14／D16／D25 兩組同意）
- [x] T003 更新 `.specify/feature.json` 指向 `specs/005-fairness-and-extras`；在 `docs/EXECUTION-PLAYBOOK.md` 補 005 的分工與注意事項

---

## Phase 2: Foundational（阻擋所有 user story）

**Goal**: 資料表欄位、通訊協定型別與純函式判定核心。

### Tests for Foundational ⚠️ 先寫、先失敗

- [x] T004 [P] 寫 `server/tests/unit/answerSettlement.test.ts`：純函式 `settleAll()` 的案例——(a) 未啟用公平順位時結果與送達順序完全相同（FR-002、SC-002）；(b) 啟用時同批依成功題數由少到多、成功題數相同依送達先後（FR-004、AC-005-01、AC-005-03）；(c) 超過 3 秒的作答排在批後（FR-005、AC-005-02）；(d) 3000ms 邊界算同一批；(e) 同一輸入重算 100 次結果相同（FR-009、SC-003）；(f) 作廢後該題與後面題目連鎖重算（FR-020、AC-005-19）；(g) 6 組 × 6 題同速時各組成功題數差 ≤ 1（SC-001）
- [x] T005 [P] 寫 `server/tests/unit/xlsxEditor.test.ts` 之外的基礎測試：`server/tests/unit/answerSettlement.test.ts` 另補「無人作答題目 winner 為 null」「只有一組作答時該組勝出」

### Implementation for Foundational

- [x] T006 新增 `server/src/domain/answerSettlement.ts`：`settleAll(questions)` 純函式，輸入每題的送達資料與公平順位旗標，輸出每題的 winner、順位、判定中與是否改判（plan 圖表對應、research R1／R2／R4）
- [x] T007 新增 `server/src/app/answerSettlementService.ts`：`computeSettlement(database, now)` 讀取 `submissions` 與 `activity.fair_ranking_enabled`，呼叫純函式後回傳可投影的結果；此處是**唯一**的判定入口（FR-009、原則 VI）
- [x] T008 在 `server/src/infra/db/database.ts` 的 `activity` 表新增 `fair_ranking_enabled` 與 `revealed_question_count` 兩欄，並在 `migrateActivityColumns()` 加入 idempotent 遷移（research R5）
- [x] T009 在 `server/src/infra/db/activityRepo.ts` 讀寫兩個新欄位（`getActivity`／`updateActivity`），既有欄位語意不變（research R4）
- [x] T010 在 `shared/src/protocol.ts` 新增／變更型別：`SnapshotBase.fairRankingEnabled`、`AnswerBoardQuestion.settling`／`fairnessApplied`、`QuestionResult.fairnessApplied`、`ProjectorSnapshot` 與其揭曉內容型別

**Checkpoint**: 純函式與資料層就緒，尚未對外提供任何行為。

---

## Phase 3: User Story 1 - 公平順位（Priority: P1）

**Goal**: 啟用公平順位時，搶答成功組別與順位依成功題數決定。

**Independent Test**: 啟用公平順位，讓成功題數較少的組別在同一批內後送卻搶答成功。

### Tests for User Story 1 ⚠️ 先寫、先失敗

- [x] T011 [P] [US1] 寫 `server/tests/integration/fairnessCommands.test.ts` 的判定整合案例：(a) 啟用後同批內成功題數少的組別勝出（AC-005-01）；(b) 未啟用時先到先得（AC-005-04、SC-002）；(c) 作廢成功組後該題與後面題目連鎖重算（AC-005-19、D25）；(d) 未啟用時作廢不連鎖重算（AC-005-20）；(e) 學生端與老師看板看到的順位是公平順位（FR-021）；(f) 學生端在搶答中仍看不到其他組資訊與自己的順位（FR-012）
- [x] T012 [P] [US1] 寫 `server/tests/integration/fairnessCommands.test.ts` 的「判定中」案例：某題第一個答案送達後 3 秒內看板標示判定中，3 秒後為最終順位（AC-005-08、FR-010）

### Implementation for User Story 1

- [x] T013 [US1] 在 `server/src/app/answerProjections.ts` 改用 `computeSettlement()`：`buildResults()`（winner 與是否改判）、`buildBoard()`（winner、cell 的順位、判定中）、`buildClosedMyAnswers()`（自己組的順位）都以判定結果為準（FR-010、FR-021、原則 VI）
- [x] T014 [US1] 在 `server/src/index.ts` 安排判定完成的提醒：某題第一個作答送達後 3 秒觸發一次 `state` 廣播，讓看板從「判定中」翻成最終順位（research R3、FR-010、FR-019）
- [x] T015 [US1] 在 `server/src/app/snapshot.ts` 的 `SnapshotBase` 帶上 `fairRankingEnabled`（guest／student／teacher 都有）

**Checkpoint**: 啟用後的判定與順位正確，未啟用時與 003 完全一致。

---

## Phase 4: User Story 2 - 老師選擇是否啟用（Priority: P1）

**Goal**: 老師在「準備中」切換公平順位，並在結果與匯出看到本場規則。

**Independent Test**: 準備中切換開關，之後不可再改。

### Tests for User Story 2 ⚠️ 先寫、先失敗

- [x] T016 [P] [US2] 寫 `server/tests/integration/fairnessCommands.test.ts` 的指令案例：(a) 老師在準備中可切換且 revision +1 並廣播；(b) 學生呼叫回 `FORBIDDEN`；(c) 搶答中／已結束呼叫回 `INVALID_PHASE` 且不改資料；(d) 設定成相同值回 `{ ok: true }` 但不遞增 revision（FR-001、AC-005-09、AC-005-10）
- [x] T017 [P] [US2] 寫 `server/tests/unit/csvBuilder.test.ts` 的第 8 欄案例：標題多一欄 `公平順位`；未啟用為 `否`、啟用為 `是`、因公平順位改判的題目為 `是（改判）`（FR-011、D13 v0.5）
- [x] T018 [P] [US2] 寫 `web/tests/teacher/FairnessSetting.test.tsx`：準備中有開關且預設關閉、搶答中／已結束時開關停用（AC-005-09、AC-005-10）

### Implementation for User Story 2

- [x] T019 [US2] 在 `server/src/app/activityCommands.ts` 新增 `setFairRanking` 指令：只有老師、只有準備中、冪等不寫入；並在 `commandRouter` 註冊事件 `activity:fair-ranking`（FR-001、原則 III）
- [x] T020 [US2] 在 `server/src/app/csvBuilder.ts` 與 `exportCommands.ts` 加上第 8 欄「公平順位」，值依判定結果的「是否改判」計算；同時**「順位」欄改用判定結果的順位**（啟用公平順位時是公平順位，未啟用時與送達序號相同）（FR-011、FR-021、D13 v0.5）
- [x] T021 [US2] 在 `web/src/features/teacher/PhaseControl.tsx` 加「公平順位」開關與一句規則說明，只在準備中可操作，樣式只用 `tokens.css` 變數（AC-005-09、原則 IX）
- [x] T022 [US2] 在 `web/src/features/student/StudentResults.tsx` 與 `web/src/features/teacher/AnswerBoard.tsx` 顯示「本場使用公平順位」與改判題目標示（AC-005-11、FR-011）

**Checkpoint**: 老師可控制開關，學生與結果都看得到規則。

---

## Phase 5: User Story 3 - 投影看板（Priority: P2）

**Goal**: 老師可開啟不含作答資訊的投影看板，結束後依題號順序揭曉結果。

**Independent Test**: 搶答中投影頁無作答資訊；結束後逐題揭曉。

### Tests for User Story 3 ⚠️ 先寫、先失敗

- [x] T023 [P] [US3] 寫 `server/tests/integration/projector.test.ts`：(a) 投影快照**完全不含**答案、送出狀態與送出數量（FR-015、SC-004、AC-005-14）；(b) 非老師取得的是訪客級內容（FR-022、AC-005-18）；(c) 搶答中顯示階段、倒數與各組在線（FR-014、FR-016）；(d) 揭曉指令只有老師、只有已結束（FR-017）；(e) 依題號順序揭曉、未揭曉的題目不出現（AC-005-16、AC-005-17）；(f) 全部揭曉後含各組成功題數（FR-018）；(g) 重設後揭曉進度清空（FR-023）
- [x] T024 [P] [US3] 寫 `web/tests/projector/ProjectorPage.test.tsx`：搶答中只顯示階段／倒數／在線狀態；已結束只顯示已揭曉的題目

### Implementation for User Story 3

- [x] T025 [US3] 在 `server/src/infra/socket/broadcaster.ts` 支援 `view: 'projector'` 握手模式，產生獨立的 `ProjectorSnapshot`（research R6、原則 VI）
- [x] T026 [US3] 在 `server/src/app/snapshot.ts` 新增 `createProjectorSnapshot()`：階段、倒數、各組在線、公平順位旗標、已揭曉結果與各組成功題數；**不含**任何作答資訊（FR-014～FR-018、FR-022）
- [x] T027 [US3] 在 `server/src/app/projectorCommands.ts` 新增 `revealNext`／`revealAll` 指令（只有老師、只有已結束、冪等），並在 `commandRouter` 註冊 `reveal:next`／`reveal:all`（FR-017、原則 III）
- [x] T028 [US3] 在 `web/src/features/projector/ProjectorPage.tsx`（＋ `.module.css`）實作投影頁：大字顯示階段、倒數、在線狀態與已揭曉結果；`web/src/app/routes.tsx` 加 `/projector` 路由；`web/src/lib/socket.ts` 以 `view: 'projector'` 連線（FR-013、FR-014、原則 IX）
- [x] T029 [US3] 在 `web/src/features/teacher/TeacherPage.tsx` 加「開啟投影看板」與「揭曉下一題」「全部揭曉」按鈕（只有老師、已結束時可揭曉）（FR-013、FR-017）
- [x] T030 [US3] 寫 `e2e/tests/005-fairness.spec.ts`：老師開啟公平順位 → 兩組同題作答 → 結果符合公平順位；開啟投影頁 → 搶答中無作答資訊 → 結束後逐題揭曉依題號順序（AC-005-01、AC-005-14、AC-005-16）

**Checkpoint**: 三個 user story 都可獨立驗收。

---

## Phase 6: Polish 與驗證

**Goal**: 文件、圖表、安全覆核、自動驗證、截圖與人工驗證。

- [x] T031 [P] 跑 `npm test`、`npm run test:e2e`、`npm run check`、`npm audit`，把指令與輸出記錄在 `docs/verification/005-automated.md`（含 SC-001～SC-006 各由哪個測試涵蓋的對照表）
- [x] T032 更新 `diagrams/005-fairness-and-extras-*.puml`（component／class／seq-fairness／seq-reveal）使元件與型別與實作一致，重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh`（原則 VII），結果寫入 `docs/verification/005-diagram-consistency.md`
- [x] T033 **安全覆核**（GLM worker，只回報不改程式）：判定是否只在伺服器、投影快照是否真的不含作答資訊、學生可見範圍是否被破壞、揭曉指令的權限與階段檢查、log 是否含答案內容；發現整理成修正 task 或記入 `docs/verification/005-security-review.md`
- [x] T034 **另一位組員審查（憲法要求的合併關卡）**：由非實作者的組員在 PR 上留下 review，審查重點為判定正確性（公平順位、作廢連鎖重算）、投影看板可見範圍、CSV 第 8 欄。**此項完成前不得合併**
- [x] T035 更新根目錄 `README.md`（進度表、操作流程、測試說明）與 `docs/EXECUTION-PLAYBOOK.md`（005 的注意事項）
- [x] T036 **畫面截圖（原則 IX）**：老師端公平順位開關、投影看板搶答中與揭曉後，存到 `docs/verification/005-screenshots/`，交設計負責人驗收
- [x] T037 **人工驗證**：依 `specs/005-fairness-and-extras/quickstart.md` 的 19 個步驟操作，結果記錄在 `docs/verification/005-manual.md`；問題另開 GitHub issue。由設計與驗證負責人執行，**不可用自動測試或截圖替代**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：無相依
- **Foundational (Phase 2)**：依賴 Setup，**阻擋所有 user story**
- **US1 (Phase 3)**：依賴 Foundational
- **US2 (Phase 4)**：依賴 US1（旗標影響判定結果）
- **US3 (Phase 5)**：依賴 Foundational；揭曉內容依賴 US1 的判定結果
- **Polish (Phase 6)**：依賴所有要交付的 user story

### Parallel Opportunities

- Phase 2 的 T004／T005 可與 T008／T009／T010 平行
- Phase 4 的 T016／T017／T018 與 Phase 5 的 T023／T024 可平行（不同檔案）

---

## Notes

- **判定不保存**（research R1）：任何時候重算都得到同樣結果；作廢連鎖重算是同一條規則的結果，不是例外流程。
- **未啟用公平順位時必須與 003 完全一致**（FR-002、SC-002）：這是回歸保護的基準線，`answerSettlement.test.ts` 的案例 (a) 專門守這條。
- **投影看板的作答資訊必須由伺服器過濾**（R6、原則 VI）：e2e 與整合測試都要斷言封包內容，而不是只看畫面。
- **CSV 第 8 欄是跨組契約**（D13 v0.5）：值域為 `否`／`是`／`是（改判）`，不得自行改動。
- 005 不實作 D1～D23 中尚未確認的決策（例如老師密碼、組數上限），若之後確認的內容與本子功能衝突，依契約變更紀錄處理。
