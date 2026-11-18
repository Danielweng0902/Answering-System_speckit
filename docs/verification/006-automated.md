# 006 寫回線上 Google Sheets：自動驗證紀錄

日期：2026-11-17。以下指令在 repository root 實際執行。

## 指令與輸出摘要

| 指令 | 結果 | 實際輸出摘要 |
|---|---|---|
| `npm test` | PASS | server：**49 files、400 tests 全過**（新增 006 的 33 個案例）；web：**18 files、95 tests 全過**（新增 5 個案例：錯誤分類、版面比對、force 覆寫、確認按鈕、訊息清除） |
| `npm run test:e2e` | PASS | 15 passed、2 skipped（既有截圖測試需 `SCREENSHOTS=1`） |
| `npm run check` | PASS | typecheck、ESLint（`--max-warnings=0`）、`scripts/check-diagrams.sh`（3 張 006 圖已重出 PNG）全過 |

## 006 的測試對照

| 驗收 | 測試 |
|---|---|
| AC-006-01 寫回線上試算表並回報格數 | `server/tests/integration/writeBackRoutes.test.ts`「老師在已結束時可把答案寫回線上試算表」 |
| AC-006-02 前綴格保持原樣、答案寫右側獨立格 | `server/tests/integration/guidedNotesWriteBack.test.ts`「題組前綴格保持原樣，答案寫進右側的獨立答案格」（02 fixture → `H5`／`H6`） |
| AC-006-03 合併填答區寫「前綴＋答案」 | 同檔「前綴在合併填答區時，寫回該合併格並保留前綴文字」（04 fixture → `G7`／`G8`） |
| AC-006-04 沒有人作答的題目不寫入 | 同檔「沒有搶答成功的答案時不寫任何儲存格」 |
| AC-006-05 上傳 xlsx 沒有雲端目標 | 同檔「上傳的 xlsx 沒有雲端目標，不呼叫寫入器」→ `GUIDED_NOTES_NOT_LINK` |
| AC-006-06／07 失敗原因可讀 | `server/tests/unit/sheetWriter.test.ts`（HTTP 狀態 → 錯誤代碼）與同檔「寫入失敗時把錯誤代碼回給上層，不洩漏 API 回應內容」 |
| 人工驗證建議 1：錯誤可行動 | `sheetWriter.test.ts` 的分類表（401／403 PERMISSION_DENIED／403 SERVICE_DISABLED／404／400 not supported／400 range／429／5xx）＋「取不到 access token 是金鑰問題而非暫時不可用」 |
| 人工驗證建議 2：舊訊息清除 | `web/tests/teacher/TeacherWriteBack.test.tsx`「階段改變時清掉上一次的寫回訊息」 |
| 人工驗證建議 3：寫回前比對版面 | `server/tests/integration/writeBackSheetCheck.test.ts`（相同 → 直接寫回；不同 → `SHEET_MODIFIED` 且不寫入；force → 仍寫回；讀不到 → 不阻擋）＋ web 測試「仍要寫回」按鈕帶 force |
| AC-006-08 沒有服務帳號 | 同檔「伺服器沒有設定服務帳號時回 SHEET_NOT_CONFIGURED」＋路由 503 案例 |
| AC-006-09 權限與階段 | `writeBackRoutes.test.ts`「沒有 token 回 401、學生回 403、未結束回 409」 |
| FR-002 只寫值、不動格式 | `sheetWriter.test.ts` 斷言請求內容為 `values.batchUpdate` ＋ `valueInputOption=RAW` ＋ 只有 `range`／`values` |
| FR-005／SC-004 本地資料不變 | `guidedNotesWriteBack.test.ts`「本地資料不被寫回動作改變（唯讀）」 |
| FR-006 金鑰零落地 | `server/tests/unit/serviceAccountToken.test.ts`（JWT 只送到 token 端點）；程式碼只從環境變數讀金鑰，log 只記格數 |
| 老師端介面 | `web/tests/teacher/TeacherWriteBack.test.tsx`（成功顯示格數、失敗顯示伺服器訊息、xlsx 來源按鈕停用） |

## 尚未涵蓋

- **T018 真實線上寫回的人工驗證**：需要服務帳號金鑰與一份可編輯的線上試算表；步驟見 `specs/006-guided-notes-writeback/quickstart.md`。
- **T019 另一位組員審查**、**T020 共用契約 D12 改版**：待完成。
