# 004 匯出：T027 GLM 安全覆核與主代理驗收

日期：2026-11-14
對象：PR #5，覆核 base `04e5916` → head `1ae4216`；修正以後續 head 為準。
執行：使用者明確指定 `nchc/GLM-5.3-max`，bounded 唯讀 security review。GLM 未改檔、未 commit、未讀取 `.env`／credential／database 檔案，亦未執行伺服器。主代理另外檢查程式、DB 不變量與測試，不把 worker 完成當成驗收通過。

## GLM 報告與處理

| 原始發現 | 主代理判讀 | 處理與證據 |
|---|---|---|
| **M1：學生答案包含 XML 1.0 禁用控制字元時，輸出是無效 xlsx** | **接受，需修** | `setCellText()` 的 XML escape 過濾禁用控制字元成 OOXML `_xHHHH_`；其前的 literal `_xHHHH_` escape 成 `_x005F_xHHHH_`，避免之後被誤解碼。保留 tab／LF／CR。`xlsxEditor.test.ts` 先重現 ExcelJS `disallowed character`，修正後 `readCell` 可成功重新開檔。 |
| **L1：CSV formula guard 僅套用在答案** | **接受** | `serialize()` 現在對 `groupName` 與 `answer` 都套用 `safeFormulaGuard()`；`csvBuilder.test.ts` 新增 `=SUM(1)`、`@危險組` 案例。群組名稱與答案這些自由文字欄都受到保護。 |
| **L2：XML 屬性 sheetName 沒有 entity 解碼** | **接受** | 002 的 `readWorkbook()` 由 ExcelJS `worksheet.name` 儲存已解碼名稱，故確實可能不相等。`attribute()` 現支援命名與數字 XML entity；`resolveSheetPathFromXml()` 的「Q&A & 學習單」測試通過。 |
| **L3：ZIP 重壓縮位元與解壓內容宣告混淆；逐格重壓縮效能** | **文件修精確；沒有新增 SC-003 缺陷** | 將註解與測試名稱改為「**解壓縮後 entry 內容 byte-identical**」，不宣稱 ZIP 封裝位元完全相等。既有測試本來就透過 JSZip `entry.async('uint8array')` 比對內容。50 組 × 30 題（1,500 submissions）測試實際通過 `< 5 秒`，另改最佳化不是這次必要範圍；大型 BLOB 考量仍可另開效能工作。 |
| **L4：SQL 沒有再做每題每組去重** | **不視為本 PR 實際 bug，不改 SQL** | `database.ts` 的 `submissions_one_valid_per_group_question` partial unique index（`question_id, group_id WHERE voided_at IS NULL`）本來就禁止此 repro，合法寫入路徑不可能產生兩筆有效作答。004 與看板共用同一 003 判定，不需多加一組可能改變契約的去重邏輯。 |

## 主代理確認 GLM 已查無問題的項目

- guest／無／無效 Bearer token → `UNAUTHORIZED`；student → `FORBIDDEN`；preparing／open → `INVALID_PHASE`；未有學習單 → `NO_GUIDED_NOTES`。
- HTTP 成功前先過伺服器授權，不是只依賴前端按鈕；token 只走 Authorization，不進 URL；log 只有匯出事件與 bytes 數量，沒有答案、token 或原檔內容。
- 匯出讀取原檔位元組副本與 SQL projection，沒有修改 BLOB、作答、空格、組別、activity revision，也沒有 Socket.IO 呼叫。
- `sheetName → r:id → Relationship Target` 不依賴屬性排列順序；`t="inlineStr"`、`xml:space="preserve"`、空格座標 escape、保留樣式與不修改 sharedStrings 均有測試。
- CSV 依題號／順位／空格序排序，排除 `voided_at IS NOT NULL`，winner 共用 `buildResults()`／`decideWinner()`；雙引號、逗號、CRLF 與 formula guard 各有案例。

## 修正後完整回歸

於 004-export branch，修正後 head 再執行：

| 指令 | 輸出 |
|---|---|
| `npm test` | server **41 files、334 tests 全過**；web **15 files、81 tests 全過** |
| `npm run test:e2e` | **14 passed、2 skipped**；skipped 為既有需 `SCREENSHOTS=1` 的 002／003 截圖測試 |
| `npm run check` | shared／server／web／e2e typecheck、ESLint、`scripts/check-diagrams.sh` 全過，最後顯示 `PASS 圖表檢查通過` |

結論：T027 完成。**沒有發現未處理的 Medium／High 安全議題留在本次修正範圍。** 這不包括 T027b 人工 peer review、T030 設計截圖或 T031 的完整 quickstart／Google Sheets 匯回驗收；那些仍待完成。
