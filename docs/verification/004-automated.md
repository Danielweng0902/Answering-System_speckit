# 004 匯出：自動驗證紀錄（T029）

日期：2026-11-14。以下指令均在 repository root 實際執行；沒有把「應該可跑」當作已驗證。

## 指令與輸出摘要

| 指令 | 結果 | 實際輸出摘要 |
|---|---|---|
| `npm test` | PASS | server：41 files 全過；332 tests 全過。web：15 files 全過；81 tests 全過。 |
| `npm run test:e2e` | PASS | Playwright 共 16 tests；**14 passed、2 skipped**。skipped 是原有、需 `SCREENSHOTS=1` 才執行的 002／003 截圖測試。004 兩種下載與讀回驗證通過。 |
| `npm run check` | PASS | shared／server／web／e2e typecheck、ESLint（`--max-warnings=0`）、`scripts/check-diagrams.sh` 均通過；最後輸出 `PASS 圖表檢查通過`。 |
| `npm audit` | **找到已知 moderate threat；exit 1** | minimatch advisory `GHSA-g3hv-75wg-m249`，npm 報 **7 moderate severity vulnerabilities**，位於開發期 ESLint／TypeScript ESLint 依賴鏈。未執行會降版且帶 breaking change 的 `npm audit fix --force`。 |

完整 run 原始 log 暫存於本機 `/private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/004-polish/`；上表已直接抄錄測試數量與錯誤摘要。Audit 修正若要動依賴主版本，需另開維護工作並另跑一次全回歸，不能冒充已完成。

## Success Criteria 對照

| 驗收 | 負責的自動測試 | 結果／限制 |
|---|---|---|
| SC-001：5 份 fixture 答案 100% 落在 expected.json 空格 | `server/tests/integration/exportCommands.test.ts`「五種版面所有空格都寫在 expected.json 位置」，實際重新解析匯出的 xlsx 並逐題逐格檢查；另有 E2E 讀回 `G5` | PASS，5 份共 36 空格皆有覆蓋 |
| SC-002：格式與未修改內容保留 | `server/tests/unit/xlsxEditor.test.ts` 驗證樣式保留與其他 zip entry byte-identical；整合測試驗證 05 只有 `xl/worksheets/sheet2.xml` 改動；`exportRoutes` 驗證資料庫不變 | PASS（結構與位元組層驗證） |
| SC-003：5 秒內 | `exportCommands.test.ts` 直接以 **50 組 × 30 題** 建立 1,500 筆有效作答，以 `performance.now()` 檢查 `exportGuidedNotes()` 回傳完整位元組小於 5 秒 | PASS；實際 E2E 下載流程另由 004 測試涵蓋 |
| SC-004：CSV 與看板一致 | `exportCommands.test.ts` 檢查兩組所有有效答案／rank／勝出旗標／空格序／ISO 時間與作廢排除；`csvBuilder.test.ts` 檢查排序與轉義；HTTP 與 E2E 再驗證 BOM、header 和真實下載 | PASS；看板內容與匯出共用 003 `listByQuestion()`／`buildResults()`，沒有另一套 winner 邏輯 |
| SC-005：可匯回 Google Sheets 並保版面 | **不由自動測試取代** | **待人工／設計驗證**，對應 `quickstart.md` 與 T030／T031；本表不冒稱已驗證 |

## 唯讀與安全案例

- `server/tests/unit/exportCommands.test.ts` 與 `server/tests/integration/exportRoutes.test.ts` 涵蓋無 token／錯 token／student／preparing／open／沒有學習單，分別回 `UNAUTHORIZED`、`FORBIDDEN`、`INVALID_PHASE`、`NO_GUIDED_NOTES`。
- `exportRoutes.test.ts` 兩個成功案例在請求前後各檢查 `activity.revision` 完全相同，並對 `server.io` 的 `emit` spy 確認沒有 Socket 廣播。
- `exportCommands.test.ts` 直接對 `activity`、`guided_notes`、`questions`、`blanks`、`submissions`、`submission_answers`、`groups` 等資料表做匯出前後快照比對。
- `csvBuilder.test.ts` 檢查逗號、雙引號、CRLF、`= + - @` 開頭公式注入保護與 UTF-8 BOM。
- `xlsxEditor.test.ts` 檢查以 `=` 開頭文字不產生 `<f>`，其他 zip entry（包括 `sharedStrings.xml`）不修改。
