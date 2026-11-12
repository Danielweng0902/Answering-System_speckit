---

description: "Task list for 001 活動與組別進場"
---

# Tasks: 活動與組別進場（activity-session）

**Input**: Design documents from `/specs/001-activity-session/`

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/、quickstart.md

**Tests**: 必須包含。Constitution 原則 II 要求測試先行：每個 user story 先寫測試並確認失敗，再實作。

**Organization**: 依 user story 分 Phase。US1、US2、US3 同為 P1；因為開啟搶答需要先有老師身分與組別，實作順序為 US3 → US2 → US1，之後是 US4、US5、US6。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、不依賴未完成的 task）
- **[Story]**: 對應 spec.md 的 user story
- 每個 task 都寫明檔案路徑；括號內是對應的 FR 與驗收情境

## Path Conventions

Web application，npm workspaces：`shared/`、`server/`、`web/`、`e2e/`（見 plan.md）。

## 每個 Phase 的完成條件（適用全部 Phase）

1. 該 Phase 的測試先寫、先確認失敗，實作後全部通過。
2. 執行 `npm test` 與 `npm run check`，回報指令與實際輸出。
3. 不修改本 Phase 範圍以外的檔案；發現規格有洞時停下回報，不自行決定行為。

---

## Phase 1: Setup（專案骨架）

**Purpose**: 建立 workspaces、工具與指令，讓之後每個 Phase 都能跑測試。

- [x] T001 建立根目錄 `package.json`（npm workspaces：`shared`、`server`、`web`；scripts：`dev`、`build`、`start`、`test`、`test:e2e`、`check`）與 `tsconfig.base.json`
- [x] T002 [P] 建立 `shared/package.json`、`shared/tsconfig.json`、`shared/src/index.ts`
- [x] T003 [P] 建立 `server/package.json`（express、socket.io、zod、dotenv；dev：vitest、tsx、socket.io-client）、`server/tsconfig.json`、`server/vitest.config.ts`
- [x] T004 [P] 建立 `web/package.json`（react、react-dom、react-router、socket.io-client；dev：vite、vitest、@testing-library/react）、`web/vite.config.ts`（開發時把 `/api` 與 `/socket.io` 代理到伺服器）、`web/index.html`、`web/src/main.tsx`
- [x] T005 [P] 建立 `e2e/package.json`、`e2e/playwright.config.ts`（啟動已 build 的伺服器、使用暫存資料目錄與測試用 `TEACHER_PASSWORD`）
- [x] T006 [P] 設定 ESLint 與 Prettier：根目錄 `eslint.config.js`、`.prettierrc`；`npm run check` 依序執行型別檢查、lint、`scripts/check-diagrams.sh`
- [x] T007 更新 `.env.example`（`TEACHER_PASSWORD=`、`PORT=3000`、`DATA_DIR=./data`）並確認 `.gitignore` 含 `data/`
- [x] T008 [P] 建立 `web/src/styles/tokens.css`（暫定的中性 design tokens，檔案開頭註明「暫定，待 design/DESIGN.md 定案」）與 `web/src/styles/base.css`（只引用 token）

**Checkpoint**: `npm install` 成功；`npm test` 可執行（0 個測試）；`npm run check` 通過。

---

## Phase 2: Foundational（所有 user story 的共同基礎）

**Purpose**: 協定型別、資料庫、伺服器骨架、快照廣播、前端連線。

**⚠️ CRITICAL**: 本 Phase 完成前不得開始任何 user story。

- [x] T009 [P] 在 `shared/src/protocol.ts` 定義 `Phase`、`Role`、三種 `Snapshot`、指令回覆 `Ack`、錯誤代碼列舉（依 contracts/socket-events.md）
- [x] T010 [P] 在 `shared/src/schemas.ts` 定義各指令與 HTTP 請求的 zod schema（依 contracts/）
- [x] T011 在 `server/src/config.ts` 讀取 `TEACHER_PASSWORD`、`PORT`、`DATA_DIR`；`TEACHER_PASSWORD` 不得寫入 log（原則 IV）
- [x] T012 在 `server/src/infra/db/database.ts` 以 `node:sqlite` 開啟資料庫並建立 `activity`、`groups`、`sessions` 資料表（依 data-model.md）；首次啟動建立 `activity` 單一列（phase = preparing）
- [x] T013 [P] 寫 `server/tests/unit/database.test.ts`：資料表建立、重複初始化不出錯、`activity` 只有一列（先失敗）
- [x] T014 [P] 在 `server/src/infra/db/activityRepo.ts`、`groupRepo.ts`、`sessionRepo.ts` 實作讀寫（只做存取，不含規則）
- [x] T015 在 `server/src/app/access.ts` 實作 token 產生、雜湊、由 token 解析身分（guest／student／teacher）
- [x] T016 [P] 寫 `server/tests/unit/access.test.ts`：無效 token 為 guest、token 不以原值保存（先失敗）
- [x] T017 在 `server/src/app/snapshot.ts` 實作依身分產生快照；訪客與學生的快照不得含 `presence`（原則 VI）
- [x] T018 [P] 寫 `server/tests/unit/snapshot.test.ts`：三種身分的快照欄位符合 contracts；學生與訪客沒有 `presence`（先失敗）
- [x] T019 在 `server/src/infra/socket/broadcaster.ts` 實作連線驗證、連線後立即送 `state`、狀態改變後對每個連線依身分送 `state`、在線人數統計
- [x] T020 在 `server/src/infra/socket/commandRouter.ts` 實作指令路由：zod 驗證 → 身分檢查 → 呼叫用例 → 回覆 `Ack`；失敗時不廣播
- [x] T021 在 `server/src/infra/http/app.ts` 建立 Express app（`GET /api/health`、JSON 錯誤格式、提供 `web/dist` 靜態檔與前端路由 fallback）
- [x] T022 在 `server/src/index.ts` 組合 config、資料庫、HTTP、Socket.IO 並啟動；匯出 `createServer()` 供測試使用
- [x] T023 [P] 寫 `server/tests/integration/helpers.ts`：以暫存資料庫啟動伺服器、建立 socket.io-client 連線、等待下一個 `state` 的工具函式
- [x] T024 寫 `server/tests/integration/connect.test.ts`：未帶 token 連線收到 guest 快照（phase = preparing、groups 為空）（先失敗，T019–T022 完成後通過）
- [x] T025 [P] 在 `web/src/lib/session.ts` 實作以 sessionStorage 保存與清除 token（research R4）
- [x] T026 [P] 在 `web/src/lib/socket.ts` 實作連線（帶 token）、自動重連、`sendCommand(event, payload)` 回傳 `Ack`
- [x] T027 在 `web/src/lib/useSnapshot.ts` 實作訂閱 `state`，只接受 `revision` 較新的快照；處理 `session:invalid`
- [x] T028 在 `web/src/app/App.tsx` 與 `web/src/app/routes.tsx` 建立路由：`/`（選擇老師或學生）、`/teacher`、`/student`；畫面只使用 `tokens.css` 的變數

**Checkpoint**: `npm test` 通過；`npm run build && npm start` 後開啟 `http://localhost:3000` 可看到首頁，並在瀏覽器收到 guest 快照。

---

## Phase 3: User Story 3 - 老師登入與組別設定（Priority: P1）

**Goal**: 老師以密碼登入，在準備中新增、改名、刪除組別；學生不能執行老師操作。

**Independent Test**: 錯誤與正確密碼各登入一次；新增、改名、刪除組別；以學生或訪客身分送出老師指令被拒絕。

### Tests for User Story 3 ⚠️ 先寫、先失敗

- [x] T029 [P] [US3] 寫 `server/tests/unit/groupRegistry.test.ts`：新增成功；空白、重複、31 字元、第 51 組被拒絕；去除前後空白；改名與刪除；非準備中一律拒絕（FR-007–010；AC-001-14、15、16）
- [x] T030 [P] [US3] 寫 `server/tests/integration/teacherLogin.test.ts`：正確密碼得到 token；錯誤密碼 401 `WRONG_PASSWORD`；未設定密碼 503 `TEACHER_PASSWORD_NOT_SET`；回應與 log 不含密碼（FR-002、003；AC-001-11、12、13）
- [x] T031 [P] [US3] 寫 `server/tests/integration/groupCommands.test.ts`：老師 `group:create` 後所有連線在 2 秒內收到含新組別的 `state`；guest 與 student 送 `group:create` 得到 `FORBIDDEN` 且沒有廣播（FR-006；AC-001-14、17）

### Implementation for User Story 3

- [x] T032 [P] [US3] 在 `server/src/domain/groupRegistry.ts` 實作組別規則（純函式，回傳新狀態或錯誤代碼）
- [x] T033 [US3] 在 `server/src/app/groupCommands.ts` 實作 `createGroup`、`renameGroup`、`deleteGroup`：檢查老師身分與階段 → 呼叫 domain → 保存 → 廣播
- [x] T034 [US3] 在 `server/src/infra/http/authRoutes.ts` 實作 `POST /api/teacher/login`（固定時間比較、每分鐘 10 次限制、未設定密碼的回應）
- [x] T035 [US3] 在 `server/src/infra/socket/commandRouter.ts` 註冊 `group:create`、`group:rename`、`group:delete`
- [x] T036 [P] [US3] 在 `web/src/features/teacher/TeacherLogin.tsx` 實作登入表單與錯誤訊息顯示
- [x] T037 [US3] 在 `web/src/features/teacher/GroupManager.tsx` 實作組別清單、新增、改名、刪除與錯誤訊息；非準備中時停用
- [x] T038 [US3] 在 `web/src/features/teacher/TeacherPage.tsx` 組合登入狀態、目前階段、`GroupManager`、各組在線狀態（FR-028）

**Checkpoint**: T029–T031 通過；人工依 quickstart 步驟 1–5 驗證。

---

## Phase 4: User Story 2 - 學生選擇組別進場（Priority: P1）

**Goal**: 學生不需帳號，選擇組別進場；同組可多人；畫面依階段顯示。

**Independent Test**: 老師建立兩組後，三個學生分頁進場（兩個同組），各自顯示組名與階段。

### Tests for User Story 2 ⚠️ 先寫、先失敗

- [x] T039 [P] [US2] 寫 `server/tests/integration/studentJoin.test.ts`：`POST /api/student/join` 成功得到 token；不存在的組別 404 `GROUP_NOT_FOUND`；兩個連線加入同一組都成功；學生快照含 `myGroupId` 且不含 `presence`（FR-004、005、011；AC-001-07、08、10）
- [x] T040 [P] [US2] 寫 `server/tests/integration/studentLeave.test.ts`：準備中 `student:leave` 成功並變回 guest；搶答中 `INVALID_PHASE`；老師刪除組別後該組學生收到 `session:invalid`（FR-012；edge case）
- [x] T041 [P] [US2] 寫 `web/tests/StudentPage.test.tsx`：依快照的 phase 顯示等待、作答區入口、結果區入口，並顯示組名（FR-027）

### Implementation for User Story 2

- [x] T042 [US2] 在 `server/src/infra/http/authRoutes.ts` 實作 `POST /api/student/join`
- [x] T043 [US2] 在 `server/src/app/access.ts` 實作 `leaveGroup` 與組別刪除時讓相關 Session 失效並通知 `session:invalid`
- [x] T044 [US2] 在 `server/src/infra/socket/commandRouter.ts` 註冊 `student:leave`
- [x] T045 [P] [US2] 在 `web/src/features/student/GroupPicker.tsx` 實作組別選擇；沒有組別時顯示「老師尚未建立組別」並隨快照更新（AC-001-06）
- [x] T046 [US2] 在 `web/src/features/student/StudentPage.tsx` 實作依階段顯示的三種畫面、組名、準備中的「更換組別」

**Checkpoint**: T039–T041 通過；人工依 quickstart 步驟 6 驗證。

---

## Phase 5: User Story 1 - 老師開啟與結束搶答，全班同步（Priority: P1）🎯 MVP

**Goal**: 老師開啟與結束搶答，所有畫面 2 秒內同步；階段只能往前；重複操作不出錯。

**Independent Test**: 一個老師分頁與兩組學生分頁，老師依序開啟與結束，三個畫面都在 2 秒內顯示相同階段。

### Tests for User Story 1 ⚠️ 先寫、先失敗

- [x] T047 [P] [US1] 寫 `server/tests/unit/activity.test.ts`：preparing→open→closed；沒有組別不能 open；closed 不能回 open；open 再 open、closed 再 close 不改變狀態（FR-013–017；AC-001-03、04、05）
- [x] T048 [P] [US1] 寫 `server/tests/integration/phaseSync.test.ts`：老師 `activity:open` 後，老師、兩個學生、一個 guest 連線都在 2 秒內收到 phase = open 的 `state`；`activity:close` 同理；學生送 `activity:open` 得到 `FORBIDDEN`（FR-006、019；AC-001-01、02、17）
- [x] T049 [P] [US1] 寫 `e2e/tests/001-activity-session.spec.ts`（第一部分）：三個 browser context（老師、第一組、第二組），老師開啟與結束，斷言三個頁面的階段文字（AC-001-01、02；SC-001）

### Implementation for User Story 1

- [x] T050 [P] [US1] 在 `server/src/domain/activity.ts` 實作狀態機 `open`、`close`（純函式，回傳新狀態或錯誤代碼，並標示是否有改變）
- [x] T051 [US1] 在 `server/src/app/activityCommands.ts` 實作 `openActivity`、`closeActivity`：檢查老師身分 → 呼叫 domain → 有改變才保存、`revision` 加 1、廣播
- [x] T052 [US1] 在 `server/src/infra/socket/commandRouter.ts` 註冊 `activity:open`、`activity:close`
- [x] T053 [US1] 在 `web/src/features/teacher/PhaseControl.tsx` 實作目前階段顯示、「開啟搶答」「結束搶答」按鈕與錯誤訊息；按鈕依階段啟用
- [x] T054 [US1] 在 `web/src/features/teacher/TeacherPage.tsx` 加入 `PhaseControl`

**Checkpoint**: T047–T049 通過。此時已可示範：老師登入、建組、學生進場、開啟、結束、全班同步。

---

## Phase 6: User Story 4 - 重新整理或斷線後回到原狀態（Priority: P2）

**Goal**: 重新整理、斷線重連、伺服器重啟後，身分與階段都正確。

**Independent Test**: 學生進場後重新整理仍是同一組；重啟伺服器後階段與組別不變。

### Tests for User Story 4 ⚠️ 先寫、先失敗

- [x] T055 [P] [US4] 寫 `server/tests/integration/reconnect.test.ts`：以同一 token 重新連線得到相同身分；斷線期間階段改變，重連後第一個 `state` 是最新階段（FR-020；AC-001-18、19、20）
- [x] T056 [P] [US4] 寫 `server/tests/integration/restart.test.ts`：建立組別並開啟後關閉伺服器，以同一資料庫檔重新啟動，階段、組別、`countdownEndsAt` 與重啟前相同，舊 token 仍有效（FR-021；AC-001-21；SC-006）
- [x] T057 [P] [US4] 在 `e2e/tests/001-activity-session.spec.ts` 加入：學生在搶答中重新整理後仍顯示原組名與搶答中（AC-001-18；SC-003）

### Implementation for User Story 4

- [x] T058 [US4] 在 `web/src/lib/socket.ts` 與 `useSnapshot.ts` 補齊：重連後以保存的 token 重新驗證；連線中斷時顯示「重新連線中」提示
- [x] T059 [US4] 在 `server/src/index.ts` 啟動流程補齊：從資料庫載入活動狀態後才開始接受連線（讓 T056 通過）

**Checkpoint**: T055–T057 通過；人工依 quickstart 步驟 8、11 驗證。

---

## Phase 7: User Story 5 - 倒數計時自動結束（Priority: P2）

**Goal**: 老師可設定倒數；所有人剩餘時間一致；時間到自動結束。

**Independent Test**: 以 10 秒倒數開啟，老師與學生的剩餘時間一致，時間到都顯示已結束。

### Tests for User Story 5 ⚠️ 先寫、先失敗

- [x] T060 [P] [US5] 在 `server/tests/unit/activity.test.ts` 加入：倒數 9 秒與 3601 秒被拒絕 `COUNTDOWN_OUT_OF_RANGE`；10 與 3600 秒被接受並設定 `countdownEndsAt`；不帶倒數時為 null（FR-023；AC-001-25、26）
- [x] T061 [P] [US5] 寫 `server/tests/integration/countdown.test.ts`（使用可控制的時鐘）：時間到自動變為 closed 並廣播；時間到之前手動 close 會取消計時；時間到與手動 close 同時發生只產生一次狀態改變；啟動時 `countdownEndsAt` 已過期會立即結束（FR-025、026；AC-001-23、24；research R7）
- [x] T062 [P] [US5] 寫 `web/tests/Countdown.test.tsx`：依 `serverNow` 與 `countdownEndsAt` 計算顯示的剩餘秒數；沒有倒數時不顯示（FR-024；AC-001-22、25）

### Implementation for User Story 5

- [x] T063 [US5] 在 `server/src/domain/activity.ts` 的 `open` 加入倒數參數與範圍檢查
- [x] T064 [US5] 在 `server/src/app/countdown.ts` 實作計時器：設定、取消、時間到呼叫 `closeActivity`、啟動時還原；時鐘以參數注入供測試控制
- [x] T065 [P] [US5] 在 `web/src/features/shared/Countdown.tsx` 實作剩餘時間顯示（以快照校正時間差）
- [x] T066 [US5] 在 `web/src/features/teacher/PhaseControl.tsx` 加入選用的倒數時間輸入；在 `TeacherPage.tsx` 與 `StudentPage.tsx` 顯示 `Countdown`

**Checkpoint**: T060–T062 通過；人工依 quickstart 步驟 7、10 驗證。

---

## Phase 8: User Story 6 - 重設活動（Priority: P3）

**Goal**: 已結束後老師可重設回準備中，需再次確認。

**Independent Test**: 完成一場活動後重設並確認，所有畫面回到準備中，組別保留。

### Tests for User Story 6 ⚠️ 先寫、先失敗

- [x] T067 [P] [US6] 在 `server/tests/unit/activity.test.ts` 加入：closed 可 reset 回 preparing 並清空時間欄位；preparing 與 open 時 reset 得到 `INVALID_PHASE`（FR-022；AC-001-27、29）
- [x] T068 [P] [US6] 寫 `server/tests/integration/reset.test.ts`：`activity:reset` 未帶 `confirm: true` 得到 `CONFIRM_REQUIRED` 且狀態不變；帶確認後所有連線收到 preparing，組別保留，學生身分仍有效（AC-001-27、28）

### Implementation for User Story 6

- [x] T069 [US6] 在 `server/src/domain/activity.ts` 實作 `reset`；在 `server/src/app/activityCommands.ts` 實作 `resetActivity`，並提供 `onReset` 掛載點讓後續子功能清空各自的資料
- [x] T070 [US6] 在 `server/src/infra/socket/commandRouter.ts` 註冊 `activity:reset`
- [x] T071 [US6] 在 `web/src/features/teacher/PhaseControl.tsx` 加入「重設活動」與確認對話框（只在已結束時顯示）

**Checkpoint**: T067–T068 通過；人工依 quickstart 步驟 12 驗證。

---

## Phase 9: Polish 與驗證

**Purpose**: 邊界情況、圖與程式一致性、人工驗證、文件。

- [ ] T072 [P] 寫 `server/tests/integration/edgeCases.test.ts`：老師兩個連線同時登入看到相同狀態；同組一人斷線不影響其他成員；組別改名後學生快照顯示新名稱（spec Edge Cases）
- [ ] T073 [P] 寫 `server/tests/integration/noLeak.test.ts`：擷取學生與 guest 連線收到的所有 `state`，斷言不含 `presence`；擷取伺服器 log，斷言不含密碼與 token（原則 IV、VI；SC-005）
- [ ] T074 完成 `e2e/tests/001-activity-session.spec.ts`：依 quickstart 的 12 個步驟走完整流程
- [ ] T075 **圖與程式一致性檢查（原則 VII）**：依 plan.md「圖表與模組對應」逐列核對元件與型別是否存在、名稱與關係是否一致；有差異時修正程式，或修正 `.puml` 並重跑 `scripts/render-diagrams.sh`；把核對結果寫入 `docs/verification/001-diagram-consistency.md`
- [ ] T076 [P] 把 specify 階段的圖細化為技術層：在 `diagrams/001-activity-session-component.puml` 與 `-class.puml` 補上實際模組與型別名稱，重跑 `scripts/render-diagrams.sh` 與 `scripts/check-diagrams.sh`
- [ ] T077 [P] 撰寫根目錄 `README.md`：系統簡述、安裝、設定 `.env`、啟動、測試指令（不含任何密碼）
- [ ] T078 執行 `npm test`、`npm run test:e2e`、`npm run check`，把指令與輸出記錄在 `docs/verification/001-automated.md`
- [ ] T079 **人工驗證**（由設計與驗證負責人執行）：依 quickstart 的人工驗證表逐步操作，把結果、截圖與發現的問題記錄在 `docs/verification/001-manual.md`；問題另開 GitHub issue

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：無依賴。
- **Phase 2 Foundational**：依賴 Phase 1；擋住所有 user story。
- **Phase 3 US3**：依賴 Phase 2。
- **Phase 4 US2**：依賴 Phase 3（需要有組別才能進場）。
- **Phase 5 US1**：依賴 Phase 3、4（開啟需要組別；同步測試需要學生連線）。
- **Phase 6 US4**、**Phase 7 US5**、**Phase 8 US6**：依賴 Phase 5；三者之間互不依賴，可以平行。
- **Phase 9 Polish**：依賴前面所有 Phase。

### Within Each User Story

- 測試 task 先做，確認失敗後才做實作 task。
- domain → app → infra → web。
- 同一檔案的 task 不可平行（`commandRouter.ts`、`activity.ts`、`activity.test.ts`、`TeacherPage.tsx`、`PhaseControl.tsx` 被多個 task 修改，須依序）。

### Parallel Opportunities

- Phase 1：T002–T006、T008 可平行。
- Phase 2：T009、T010 可平行；T013、T016、T018、T023 可平行；T025、T026 可平行。
- 每個 user story 的測試 task 彼此可平行。
- Phase 6、7、8 可由不同 worker 同時進行，但 `commandRouter.ts` 與 `PhaseControl.tsx` 的修改要依序合併。

## Implementation Strategy

1. Phase 1、2 完成後先驗證 Checkpoint。
2. Phase 3 → 4 → 5 完成即為 MVP：可示範完整的階段同步。
3. Phase 6、7、8 逐一加入，每個 Phase 完成都跑一次全部測試。
4. Phase 9 收尾後執行 `/speckit-converge`，補齊缺漏再合併。

## Notes

- 每個 task 完成後在本檔勾選 `[x]`。
- 介面只使用 `web/src/styles/tokens.css` 的變數；`design/DESIGN.md` 定案後由設計負責人更新 token 與版面，不在本 tasks 範圍。
- 作答區與結果區在本子功能只是入口（顯示標題的空畫面），內容由 003 實作。
