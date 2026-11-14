# 003 自動驗證紀錄（T050／T058／T059–T061）

日期：2026-11-14｜Node.js v26.7.0、npm 11.19.0｜分支 `003-buzz-in`（HEAD `ee6326e`，工作區另含本 Phase 新增文件與截圖）；T058 於同日補跑截圖與 check 指令（log 於 `$TMPDIR/opencode/003-t058/`）

所有指令在 repo 根目錄執行；完整輸出以 `tee` 存 log（`$TMPDIR/opencode/003-t050/`），以下摘錄實際輸出的結果行與 exit code，未以 `tail` 截斷掩蓋失敗——本次四個指令皆無失敗測試。

| 指令 | exit code | 實際輸出（摘要） |
|---|---|---|
| `npm test` | **0** | shared：`No test files found, exiting with code 0`（`--passWithNoTests`）；server：`Test Files  35 passed (35)`、`Tests  287 passed (287)`；web：`Test Files  13 passed (13)`、`Tests  67 passed (67)` |
| `npm run test:e2e` | **0** | build（shared／server／web）成功後 Playwright：`Running 15 tests using 1 worker` → `13 passed`、`2 skipped`（`002-screenshots.spec.ts` 與 `003-screenshots.spec.ts` 未設 `SCREENSHOTS=1`，為既有契約行為）；001×3、002×3、003×7 全過，耗時 16.1s |
| `npm run check` | **0** | `npm run typecheck`：shared build＋server／web／e2e `tsc --noEmit` 全過；`npm run lint`：`eslint … --max-warnings=0` 無任何輸出（0 錯誤 0 警告）；`bash scripts/check-diagrams.sh`：`PASS 圖表檢查通過` |
| `npm audit` | **1**（有弱點時 npm audit 的正常 exit code） | `7 moderate severity vulnerabilities`，全部來自 `typescript-eslint → @typescript-eslint/* → minimatch`（GHSA-g3hv-75wg-m249，globparts 放大 DoS），與 001、002 紀錄相同，只影響開發工具鏈、不進入伺服器或前端產物。npm 建議的 `npm audit fix --force` 會把 `@typescript-eslint/parser` 降到 6.15.0（breaking change），依授權不安裝或變更套件，不做 |
| `SCREENSHOTS=1 npm run test:e2e -- tests/003-screenshots.spec.ts` | **0** | `Running 1 test using 1 worker` → `1 passed`（T050 首跑 4.1s、T058 重跑 4.9s）；產生 `docs/verification/003-screenshots/` 七張 PNG（T051 六張＋T058 手機寬度一張，清單見下） |

補充說明：

- 截圖指令以測試檔過濾只跑 `003-screenshots.spec.ts`：`npm run test:e2e -- <file>` 與全量執行使用同一份 `e2e/playwright.config.ts`（同 build、同隨機密碼、同暫存資料夾、single worker），差異只在測試集合；不跑 `002-screenshots.spec.ts` 是為避免重寫已 commit 的 002 截圖。該測試在未設 `SCREENSHOTS=1` 的全量執行中為 skipped（上表第二列的 2 skipped 之一），不影響其他測試。
- e2e 全量執行中 003 的 7 個測試：US1 基本流程、US2 離場、US4 結果、US5 題組、US3 看板與進度、US6 草稿與保存、US3 作廢，全數通過。
- `npm test` 的 server 287 個測試含 003 新增的 `answerValidation`、`answerRanks`、`database`（新表）單元測試與 `answerCommands`、`answerVisibility`、`answerResults`、`answerPersistence`、`noLeak`、`snapshot` 整合／單元測試；web 67 個含 `AnswerArea`、`StudentPage`、`useSnapshot`（T025 role 變換）等。

## SC-001–SC-007 的測試映射

| Success Criterion | 涵蓋測試 | 備註 |
|---|---|---|
| **SC-001** 10 組同時對同一題送出，順位 1–10 各出現一次 | `server/tests/integration/answerCommands.test.ts`「10 組同時對同一題送出，rank 1–10 各出現一次（SC-001）」 | `Promise.all` 並發送真實 Socket 指令，通過 |
| **SC-002** 搶答中學生裝置收到的其他組資訊為 0 筆 | `server/tests/integration/answerVisibility.test.ts`「作答事件只送老師與送出組，其他組與 guest 的封包數與 revision 不改變」、「作廢只送老師與該組；其他組與 guest 封包數為 0」；`server/tests/integration/noLeak.test.ts`（快照欄位層）；e2e US1（B 畫面無第一組痕跡）、US3 作廢（他組收不到作廢資訊） | 快照、revision、封包三層都有斷言；本次安全覆核（`003-security-review.md`）逐層複查通過 |
| **SC-003** 任一組送出後 2 秒內看板更新 | `server/tests/integration/answerVisibility.test.ts`「送出後老師快照即時更新 board 與 progress」；e2e「US3 看板與進度」（2 秒 timeout 斷言） | 事件驅動，實測毫秒級 |
| **SC-004** 學生從填寫到送出在 3 個操作步驟內 | e2e「US1 基本流程」（填寫 → 按送出，無中間對話框；`AnswerArea` 每題一個送出鈕）＋ quickstart 人工驗證步驟 2–5 | 操作步驟數是介面流程性質，無專門的自動計步斷言；由流程測試與人工驗證（T052）涵蓋 |
| **SC-005** 結束後所有學生 2 秒內顯示結果 | `server/tests/integration/answerResults.test.ts`「activity:close 後學生連線收到含 questions、results 與含 rank myAnswers 的 closed 快照（AC-003-17–19、SC-005）」；`noLeak.test.ts`；e2e「US4 結果畫面」（`timeout: 2_000` 斷言結果區出現） | 通過 |
| **SC-006** 重啟後答案與順位 100% 相同 | `server/tests/integration/answerPersistence.test.ts`「多組送出後以同一資料夾重啟：Submission、rank、counter 與 sessionId 完全相同」 | 以真實伺服器關閉重啟驗證 |
| **SC-007** 未作廢時重複送出 100% 被拒 | `server/tests/integration/answerCommands.test.ts` 同組重複送出案例（兩處標 SC-007）；e2e US1（A2 再送被拒、原答案不變）、US1 同組 `Promise.all` 只有先到者成功 | 通過 |

## T051／T058 截圖產出（`docs/verification/003-screenshots/`）

| 檔案 | 內容 | 尺寸 |
|---|---|---|
| `01-answer-area-single.png` | 學生作答區：單題（第 3 題）輸入欄含未送出草稿 | 1070×227 |
| `02-answer-area-group.png` | 學生作答區：題組（第 1 題）兩個前綴輸入欄 | 1070×306 |
| `03-submitted-locked.png` | 已送出鎖定：輸入欄與按鈕停用、顯示本組已送出答案 | 1070×339 |
| `04-teacher-board-progress.png` | 老師看板與進度：題 × 組狀態、答案、順位、搶答成功與進度摘要 | 1120×671 |
| `05-void-confirm.png` | 作廢確認：第一次按作廢展開「確認作廢／取消」 | 166×178 |
| `06-student-results.png` | 學生結果畫面：每題搶答成功組別與答案、本組答案與順位、無人作答 | 1120×898 |
| `07-student-mobile.png` | 學生作答畫面（手機寬度）：390×844 viewport 的整個學生頁面（頁首組別與階段、作答區四題），第 2 題含未送出草稿；T058 依 EXECUTION-PLAYBOOK §10 補齊 | 358×1568 |

截圖內容由 `003-screenshots.spec.ts` 內的斷言保證（擷取前先斷言「本組已送出：示範第一格、示範第二格」「第 1 順位」「搶答成功」「確認作廢」「無人作答」等文字；`07` 另斷言學生頁面區域寬度 ≤ 390px，證明是手機寬度版面），交設計負責人驗收（原則 IX）。

## T058 手機寬度截圖補充（2026-11-14）

EXECUTION-PLAYBOOK §10 要求每個含畫面的變更附老師端、學生端、手機寬度三種截圖；T051 原先只有 desktop 截圖（先前的唯讀複查誤判手機寬度非需求）。T058 在 `e2e/tests/003-screenshots.spec.ts` 以 390×844 viewport 的 context 新增學生作答畫面截圖（同組第二個成員於搶答中加入，AC-001-09），既有六張截圖的擷取流程與斷言完全未改（測試 diff 為純新增）。補跑指令與實際輸出：

| 指令 | exit code | 實際輸出（摘要） |
|---|---|---|
| `SCREENSHOTS=1 npm run test:e2e -- tests/003-screenshots.spec.ts` | **0** | build（shared／server／web）成功後 Playwright：`Running 1 test using 1 worker` → `1 passed (4.9s)`；產生七張 PNG（完整 log：`$TMPDIR/opencode/003-t058/screenshots-run.log`） |
| `npm run check` | **0** | `npm run typecheck`：shared build＋server／web／e2e `tsc --noEmit` 全過；`npm run lint`：`eslint … --max-warnings=0` 無任何輸出；`bash scripts/check-diagrams.sh`：`PASS 圖表檢查通過`（完整 log：`$TMPDIR/opencode/003-t058/check-run.log`） |

人工驗證（T052）由設計與驗證負責人依 quickstart.md 的 23 個步驟執行，結果記錄在 `003-manual.md`。

## T058 主控獨立驗收（2026-11-14）

- 檢查完整截圖測試內容，並目視檢查 `07-student-mobile.png`：題目、題組輸入欄與送出按鈕可讀，未見裁切或重疊。這是手機寬度截圖檢查，不代表實機觸控或 T052 人工驗證完成。
- `SCREENSHOTS=1 npm run test:e2e -- tests/003-screenshots.spec.ts`：exit 0，`1 passed (4.7s)`；log：`/tmp/003-parent-t058-screenshots.log`。
- `npm run check`：exit 0，typecheck、ESLint 與圖表檢查通過；log：`/tmp/003-parent-t058-check.log`。
- `git diff --check` 通過；T054–T058 已完成，tasks.md 唯一未勾選項為 T052，人工表結果仍空白，尚不能宣告全收斂。

## T059–T061（Phase 11，2026-11-14）

日期：2026-11-14｜Node.js v26.7.0｜分支 `003-buzz-in`（HEAD `ee6326e`，工作區含本 Phase 與先前未 commit 的文件）｜完整輸出以 `tee` 存 log（`$TMPDIR/opencode/003-t059-t061/`）。

| 指令 | exit code | 實際輸出（摘要） |
|---|---|---|
| `npm test` | **0** | shared：`No test files found, exiting with code 0`（`--passWithNoTests`）；server：`Test Files 35 passed (35)`、`Tests 289 passed (289)`（T060 新增 `errorHandling` 廣播例外 2 案例）；web：`Test Files 13 passed (13)`、`Tests 68 passed (68)`（T059 新增 AnswerArea 先填後格草稿回歸 1 案例） |
| `npm run check` | **0** | `npm run typecheck`：shared build＋server／web／e2e `tsc --noEmit` 全過；`npm run lint`：`eslint … --max-warnings=0` 無任何輸出；`bash scripts/check-diagrams.sh`：`PASS 圖表檢查通過` |
| `npm run test:e2e` | **0** | build（shared／server／web）成功後 Playwright：`Running 15 tests using 1 worker` → `13 passed`、`2 skipped`（`002-screenshots.spec.ts` 與 `003-screenshots.spec.ts` 未設 `SCREENSHOTS=1`，既有契約行為）；001×3、002×3、003×7 全過，耗時 16.1s |

### red → green 證據（原則 II）

- **T059**：先寫 `web/tests/AnswerArea.test.tsx`「先填題組後格時草稿以空字串補齊前格，重新掛載後仍保留」再實作。實作前執行 `npm test --workspace @classroom/web -- tests/AnswerArea.test.tsx` → `Tests 1 failed | 7 passed`，失敗輸出顯示儲存內容為 `{ "1": [null, "先填第二格的答案"] }`（sparse array 的 hole 經 JSON.stringify 變 null，重新讀取時整題草稿被丟棄）。修改 `AnswerArea.tsx` 的 `updateAnswer` 以 `question.blanks.map` 補空字串後，同一指令 → `Tests 8 passed (8)`。storage 驗證（`parseStoredDrafts` 只接受 string）未放寬。
- **T060**：先寫 `server/tests/integration/errorHandling.test.ts` 兩個廣播例外案例再實作。實作前執行 `npx vitest run tests/integration/errorHandling.test.ts`（server workspace）→ `Tests 2 failed | 2 passed`＋`Errors 2 errors`：堆疊顯示廣播拋出的例外經 `commandRouter.ts:135/137 → Socket.emit → processTicksAndRejections` 成為 **Uncaught Exception**，ack 從未送出（與待修行為一致）。修改 `commandRouter.ts` 只 catch 廣播、記錄事件名稱後送原 ack 後，同一指令 → `Tests 4 passed (4)`（既有用例例外路徑 2 案例不改不壞）。
- **T061**：測試 client 作法先實測再寫入文件。以 `npm run build && PORT=3471 DATA_DIR=<暫存> npm start` 啟動拋棄式正式環境（隨機暫存資料庫、無 TEACHER_PASSWORD、用後即刪），在學生分頁以瀏覽器自動化逐步執行文件中的 Console 程序：`await import('/socket.io/socket.io.js')` 成功（`window.io` 為 function，本機伺服器提供、非 CDN）；以 `sessionStorage` 的 token 連線後收到初始 `state` 快照（role `student`、`groups` 含 id）；`emitWithAck('answer:submit', …)` 於準備中回 `{ ok: false, error: { code: 'INVALID_PHASE' } }` 且連線存活；payload 多帶 `groupId` 回 `INVALID_INPUT`（FR-018）；學生送 `answer:void` 回 `FORBIDDEN`；`socket.disconnect()` 清理後分頁正式 UI 不受影響。token 全程只在分頁內讀取，未輸出或寫入任何 log／檔案。

### 本輪測試計數變化

- server `errorHandling.test.ts`：2 → 4 案例（全域廣播與定向廣播拋例各一：ack 恰一次、連線存活、第二次指令仍可用、log 含事件名但不含 payload 與例外內容；定向案例並斷言未改用全域廣播）。
- web `AnswerArea.test.tsx`：7 → 8 案例（題組先填第二格 → 儲存為 `['', '…']` 而非 hole → unmount 後重新掛載仍保留）。
- e2e 無新增（T059 為元件層行為、T060 為例外路徑、T061 為人工驗證文件），既有 003 的 7 個 e2e 全過，證明送出／作廢／草稿／看板行為未變。

### Phase 11 主控獨立驗收（2026-11-14）

已檢查產品、回歸測試與 quickstart 完整 diff。主控重新執行：`npm test` exit 0（server 289、web 68，共 357 passed）；`npm run check` exit 0（型別、lint、圖表通過）；`npm run test:e2e` exit 0（13 passed，2 skipped，16.0s）。完整 log 位於 `/tmp/003-phase11-parent-{test,check,e2e}.log`。`git diff --check` 通過。

T059–T061 通過本次驗收；此結論不涵蓋 T052 人工驗證，也不代表其餘審查觀察（換組規格決策、作廢錯誤殘留與送出中按鈕狀態）已解除。Muse 因工具受限僅提供二階交叉核對，未完成第三份直接讀碼的盲審。

## 三模型交叉驗證與 T062/T063 主控驗收（2026-11-14）

本輪依使用者指示使用三個 NCHC 模型：GLM-5.3-max（安全／事務）、MiniMax-M3.1-Flash（FR/AC 廣覆蓋）、Muse-Spark-Open-816B-A42B（跨層整合）。先獨立盲審，再交叉覆核另外兩份主張；正式裁定、反駁理由與實作映射記錄在 `003-multi-model-review.md`。

主控 Kimi K3 Max 採納並修正：任一題送出中停用全部送出按鈕；作廢確認與錯誤改以 cell signature 綁定目前 phase/state/answers/rank；broadcaster 全域與定向廣播改為 per-socket try/catch。MiniMax 提出的「submitted 後一律隱藏錯誤」先被靜態審查接受，但正式 E2E 反證同組撞車時必須顯示 `ALREADY_SUBMITTED`，已撤回，不採納。

最後一輪 GLM-5.3-max 對最新 T062/T063 diff 只讀複查：無 High／Medium 阻擋；其新增 Low 意見（submitted→voided→submitted 後舊錯誤可能浮現）已由 cell-signed `voidErrors` 修正並補測。

驗證指令與最終結果：

| 指令 | 結果 |
|---|---|
| `npm test` | 通過；server 291 passed，web 73 passed |
| `npm run check` | 通過；typecheck、ESLint、圖表檢查全過 |
| `npm run test:e2e` | 通過；15 個 Playwright case 中 13 passed、2 skipped |
| `git diff --check` | 通過 |

完整 log 位於 `/private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/003-multimodel-review/`（`npm-{test,check,e2e}-accepted.log`）。

T052 人工驗證仍未執行；本紀錄不表示 003 已全收斂。
