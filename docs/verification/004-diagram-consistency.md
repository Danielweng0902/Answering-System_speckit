# 004 匯出：圖與程式一致性檢查（T028）

日期：2026-11-14

## 結果

`diagrams/004-export-*.puml` 與目前程式相符，**未修改 `.puml`，因此不需重新產生 PNG**。此輪只修正 `specs/004-export/plan.md` 中兩個過時的模組對照名稱：

| 項目 | 圖中／規格用語 | 實際程式 | 判定 |
|---|---|---|---|
| 匯出入口 | Export Gateway | `server/src/app/exportCommands.ts` 的 `authorizeExport()`、`exportGuidedNotes()`、`exportResultCsv()`；`server/src/infra/http/exportRoutes.ts` | 一致 |
| Guided Notes 寫入 | Guided Notes Writer | `buildBlankContent()`＋`xlsxEditor.ts` 的 `replaceCellText()`／`setCellText()` | 一致 |
| CSV 產生 | CSV Builder | `csvBuilder.ts` 的 `buildCsv()`、`escapeCsvField()`、`safeFormulaGuard()` | 一致 |
| 結果彙整 | 003 results | `answerProjections.ts` 的 `buildResults()`；`answerRepo.ts` 明確排除 `voided_at IS NOT NULL` | 一致 |
| 題目庫 | 002 questions／blanks | `questionRepo.ts` 的 `getStoredGuidedNotes()` 與 `blanks.cell`／`prefix` | 一致 |
| 階段管理 | 001 phase | `activityRepo.ts` 的 `getActivity()`；`authorizeExport()` 只允許 `closed` | 一致（plan 已更新為實際模組） |
| 匯出的學習單／CSV | export file | `ExportFile`（兩種檔案共用的檔名、位元組、content type） | 一致（plan 已更新為實際型別名） |
| 時序 | 前端 → HTTP → app → db／projection → HTTP download | `app.ts` 把 `exportGuidedNotes()`／`exportResultCsv()` 注入 `createExportRouter()` | 一致 |

## 檢查原則

- 寫入位置仍由 002 結構解析存入的 `blanks.cell` 決定，沒有固定座標或依工作表順序的檔名假設。
- Guided Notes 的 `writer` 不直接改原始資料庫 BLOB；`exportGuidedNotes()` 只從 `stored.file` 產生新的位元組。
- CSV 的作者群／順位／勝出旗標完全由伺服器資料與 `buildResults()` 決定。
- 圖檔檢查由 `npm run check` 內的 `scripts/check-diagrams.sh` 覆核。
