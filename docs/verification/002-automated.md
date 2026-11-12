# 002 自動驗證紀錄（T055）

日期：2026-11-12｜Node.js v26.7.0｜分支 `002-guided-notes-import`

| 指令 | 結果 |
|---|---|
| `npm test`（server） | 27 個測試檔、220 個測試全部通過（含 5 份有效與 3 份無效 fixtures 的比對、上傳與連結錯誤路徑、T051 的 3 個回歸測試、T052 效能檢查） |
| `npm test`（web） | 11 個測試檔、56 個測試全部通過 |
| `npm run check` | 型別檢查、ESLint（`--max-warnings=0`）、`scripts/check-diagrams.sh` 全部通過 |
| `npm run test:e2e` | 5 個 Playwright 測試通過（001 兩個、002 三個）；截圖測試未設 `SCREENSHOTS=1` 時略過 |
| `SCREENSHOTS=1 npm run test:e2e` | 6 個通過，產生 `docs/verification/002-screenshots/` 的 5 張圖（T056） |
| `npm audit` | 7 項中等風險，與 001 相同，全部來自 `typescript-eslint` → `minimatch` 開發工具鏈，不進入伺服器或前端產物。002 新增的 `exceljs` 4.4.0 透過根目錄 `overrides` 把 `uuid` 升到 14，沒有新增風險 |

補充：

- 整合測試連續執行 3 次結果一致（81 個整合測試）。
- SC-003（5 秒內看到摘要）以整合測試量測「上傳到收到摘要」；瀏覽器選檔與畫面渲染時間由人工驗證（T057）確認。
- 人工驗證（T057）由設計與驗證負責人依 quickstart.md 執行，結果記錄在 `docs/verification/002-manual.md`。
