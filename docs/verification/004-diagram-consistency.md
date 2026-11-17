# 004 匯出：圖與程式一致性檢查（T028）

日期：2026-11-11 初查；2026-11-16 依人工驗證 A／B 修正後重查。

## 結果

`diagrams/004-export-*.puml` 與目前程式相符；本輪已修改三張 `.puml` 並重新產生對應 PNG，最後以 `scripts/check-diagrams.sh` 驗證。重點修正：題組不是一律同格寫入，也不是一律右移，而是依原檔 merge range 決定；CSV 的送出時間不再是 UTC ISO 原值。

| 項目 | 圖中／規格用語 | 實際程式 | 判定 |
|---|---|---|---|
| 匯出入口 | Export Gateway | `server/src/app/exportCommands.ts` 的 `authorizeExport()`、`exportGuidedNotes()`、`exportResultCsv()`；`server/src/infra/http/exportRoutes.ts` | 一致 |
| Guided Notes 寫入 | Guided Notes Writer／`判斷填答格` | `guidedNotesExporter.ts` 的 `buildBlankWrites()`、`answerCellForBlank()`；`xlsxEditor.ts` 的 `getWorksheetXml()`、`isMergedWithRightCell()`、`replaceCellText()`／`setCellText()` | 一致 |
| 分離前綴版面 | 前綴格不變，答案寫右側 | 02 的 G5／H5 類型由 merge range 判定為分離，`buildBlankWrites()` 只把答案寫至 H5 | 一致，整合測試逐格驗證 |
| 合併填答區版面 | 原格保留「前綴＋答案」 | 04 的 `G7:I7` 類型判定為同一合併填答區，寫回原格且不盲目右移 | 一致，5-fixture regression 涵蓋 |
| CSV 產生 | CSV Builder／本地可讀送出時間 | `csvBuilder.ts` 的 `buildCsv()`、`escapeCsvField()`、`safeFormulaGuard()`；`exportCommands.ts` 的 `formatLocalTimestamp()` | 一致 |
| 結果彙整 | 003 results | `answerProjections.ts` 的 `buildResults()`；`answerRepo.ts` 明確排除 `voided_at IS NOT NULL` | 一致 |
| 題目庫 | 002 questions／blanks／原檔 | `questionRepo.ts` 的 `getStoredGuidedNotes()` 與 `blanks.cell`／`prefix`；merge range 從原檔 XML 讀取 | 一致 |
| 階段管理 | 001 phase | `activityRepo.ts` 的 `getActivity()`；`authorizeExport()` 只允許 `closed` | 一致 |
| 時序 | 前端 → HTTP → app → db／projection／xlsx XML → HTTP download | `app.ts` 把 `exportGuidedNotes()`／`exportResultCsv()` 注入 `createExportRouter()` | 一致 |

## 檢查原則

- 題組前綴與答案格分離時，寫入位置不是固定 `G→H`，而是由 `blanks.cell` 起點加原檔 merge range 判斷。
- 前綴位於合併填答區時，該合併格本身就是答案格；匯出內容為「前綴＋答案」。
- Guided Notes 的 writer 不直接改原始資料庫 BLOB；`exportGuidedNotes()` 只從 `stored.file` 產生新的位元組。
- CSV 的作者群／順位／勝出旗標完全由伺服器資料與 `buildResults()` 決定；`submissions.received_at` 仍以 UTC 保存，只在 CSV 組裝時轉本地可讀格式。
- 圖檔檢查由 `npm run check` 內的 `scripts/check-diagrams.sh` 覆核。
