# Phase 2 K3 派工紀錄（2026-11-12 完成，見文末）

日期：2026-11-11。

使用者指定此專案常駐實作 worker 改為 `nchc/Kimi-K3`。專案設定位於 `~/.config/opencode-worker/projects/answering-system-speckit.json`，全域 profile 保持原值。AGENTS.md 與 EXECUTION-PLAYBOOK.md 已同步。

派工 job：`job_5ff5f194-d0b3-4007-b116-699d18991151`。目標 T009–T028。

- 第一輪實際模型為 K3，完成多次規格與設定讀取；之後長時間沒有新工具輸出，監督取消，diff 為空。
- 第二輪續作誤用全域管理工具設定，被模型一致性檢查拒絕：`Local model profile changed; start a new job to avoid changing an existing session.` 未執行其他模型。
- 第三輪透過專案設定續作，縮小為先交付測試；監督取消前剛產生 `server/tests/unit/database.test.ts`（68 行），其餘尚未交付。最終 job 狀態 cancelled，檔案保留在隔離 workspace，未整合。

已完整檢視唯一測試 diff，並取得 missing-module 的 red 證據；沒有 green 或整個 Phase 的測試證據，沒有整合 Phase 2 程式，T009–T028 保持未勾選。這是未交付的執行紀錄，不是模型品質或 Phase 2 通過證明。下一次需用專案設定啟動新 K3 job，先確認小範圍測試交付；所有變更仍須完整 diff 與獨立測試驗收。

管理注意：start、continue、validate 都使用 bridge 的 `--config ~/.config/opencode-worker/projects/answering-system-speckit.json`，不能用預設 Max 設定續作 K3 job。沒有 commit 或 push。

## 實際 red 驗證

工作目錄：該 job 的 `workspace/server`。

指令：`<repo>/node_modules/.bin/vitest run tests/unit/database.test.ts`

結果：exit 1；`Test Files 1 failed (1)`；`Cannot find module ../../src/infra/db/database.js`。測試尚未進入 assertions，因實作不存在。

完整 diff SHA-256：`6476fe823a9d85f5b87b4d2109ed69a350062e8d11cdf9513fe0c95dc1f29941`。

較早從專案根目錄執行的檢查只得到 `No test files found`，不算測試證據；以上是在正確工作目錄重跑的結果。

## 2026-11-12 完成紀錄

Phase 2（T009–T028）完成。改成分段派工：每個 job 範圍較小、`timeout_ms` 1800000，worker 沒有 shell，測試一律由監督執行。

| Job | 範圍 | 結果 |
|---|---|---|
| `job_25d740bd…` | T009–T010 | 10 分鐘逾時，只產出 shared/src；監督審查後整合 |
| `job_88b039a6…` | T011–T018 | awaiting_review；整合 |
| `job_c9317dec…` | T025–T028 | awaiting_review；整合 |
| `job_86864544…` | T019–T024 | 檔案完成後仍未結束，監督取消並整合 |

先失敗的證據：

- server 單元測試：只複製測試檔時 `Test Files 3 failed`（`Cannot find module ../../src/...`）。
- server 整合測試：`TypeError: createServer is not a function`，3 個測試失敗。
- web `useSnapshot`：見下方監督修正。

監督修正：

1. `web/src/lib/useSnapshot.ts`：重新連線（身分改變）時，伺服器送出的新身分快照 revision 可能不變，原本會被丟棄。新增 `web/tests/useSnapshot.test.tsx`，修正前 `Expected "student" / Received "guest"`，修正後通過。
2. `server/src/index.ts`：worker 只監聽 127.0.0.1，學生裝置無法連線；改用 Node 預設（所有介面）。
3. 兩處 `exactOptionalPropertyTypes` 型別錯誤。

驗收（監督執行）：

- `npm test`：server `Test Files 4 passed / Tests 14 passed`；web `Test Files 1 passed / Tests 2 passed`。
- `npm run check`：typecheck、ESLint（--max-warnings=0）、`PASS 圖表檢查通過`。
- `npm run build`：成功。
- 煙霧測試：`PORT=3456 node dist/index.js` → `/api/health` 回 `{"ok":true}`，`/teacher` 200，log 不含密碼。

待決（規格問題，未自行決定）：

- data-model 的 `sessions.group_id ON DELETE CASCADE` 會在刪組時刪掉學生 session，重連時 token 解析成 guest，contracts 要求的 `session:invalid`（連線時）實際上不會觸發。需要決定：保留 session 以便送 `session:invalid`，或改 contract 為「解析為 guest，前端看到 role 為 guest 即回選組」。
- 未知的 `/api/*` 路徑回 Express 預設 HTML 404，與 http-api.md「所有回應為 JSON」不一致；contracts 沒有對應錯誤代碼。
- `sendCommand` 未定義逾時行為（contracts 未規定）。
