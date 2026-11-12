# 001 自動驗證紀錄（T078）

日期：2026-11-12｜Node.js v26.7.0｜分支 `001-phase9`

| 指令 | 結果 |
|---|---|
| `npm test`（server） | 22 個測試檔、111 個測試全部通過（含 Phase 9 新增的 `edgeCases.test.ts`、`noLeak.test.ts`） |
| `npm test`（web） | 9 個測試檔、47 個測試全部通過 |
| `npm run check` | 型別檢查、ESLint（`--max-warnings=0`）、`scripts/check-diagrams.sh` 全部通過 |
| `npm run build` 後 `npm run test:e2e` | 3 個 Playwright 測試全部通過（含依 quickstart 走完整流程的測試） |
| `npm audit` | 7 項中等風險，全部來自同一條開發工具依賴鏈：`typescript-eslint` 依賴的 `minimatch`（GHSA-g3hv-75wg-m249）。只在 lint 時執行，不進入伺服器或前端產物；官方修正需要大版本升級，暫不處理 |

e2e 完整流程測試與 quickstart 的差異：

- 步驟 10：改由老師按「結束搶答」，不等 30 秒倒數；倒數歸零自動結束由 `server/tests/integration/countdown.test.ts` 驗證。
- 步驟 11：e2e 無法重啟共用伺服器，略過；重啟後狀態一致由 `server/tests/integration/restart.test.ts` 驗證。

人工驗證（T079）由設計與驗證負責人依 quickstart 執行，結果記錄在 `docs/verification/001-manual.md`。
