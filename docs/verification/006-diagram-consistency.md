# 006 圖表與程式一致性核對

核對範圍：006 的三張 PlantUML 圖（`diagrams/006-guided-notes-writeback-*.puml`）與目前 `server/src`
的實際程式碼（`server/src/app/guidedNotesWriteBack.ts`、`server/src/infra/sheets/`、
`server/src/infra/http/exportRoutes.ts`）。
核對只描述圖與程式；發現不符處**以程式為準修圖**，程式未改動。

## 逐項核對

| 圖中項目                               | 程式位置                                                                                | 結果     | 差異說明                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 元件：匯出路由（POST /writeback）      | `server/src/infra/http/exportRoutes.ts:139` `/api/export/guided-notes/writeback`        | 一致     | 路由檢查老師身分、階段為已結束、有匯入學習單；無服務帳號設定時回 `SHEET_NOT_CONFIGURED`                          |
| 元件：寫回服務                         | `server/src/app/guidedNotesWriteBack.ts` 的 `writeBackGuidedNotes()`                    | 已修正圖 | 圖上原本只畫「解析要寫的儲存格」，**漏了整個「重新讀取線上試算表並比對版面」的步驟**（見下節）                   |
| 元件：線上版面讀取                     | `server/src/infra/sheets/googleSheetsFetcher.ts` 的 `fetchSheetXlsx()`                  | 已修正圖 | **圖上原本完全沒有這個元件**。它是寫回前的必要步驟                                                               |
| 元件：版面比對（內容＋位置）           | `guidedNotesWriteBack.ts` 的 `compareLayout()` → `LayoutRelation`                       | 已修正圖 | **圖上原本沒有**。回傳 `'same' \| 'remapped' \| 'modified'`                                                      |
| 元件：目標儲存格判定（與 004 共用）    | `server/src/app/exportCommands.ts`／`server/src/domain/`（前綴與答案格的判定）          | 一致     | 判定沿用 004 的規則：前綴格與答案格分離 → 寫右側獨立格；前綴在合併填答區 → 寫該合併格；單題 → 寫原格             |
| 元件：試算表寫入器（SheetWriter）      | `server/src/infra/sheets/sheetWriter.ts` 的 `SheetWriter` 型別                          | 一致     | `writeCells(request)`；只寫值（`valueInputOption=RAW`），格式、公式與版面不動                                    |
| 元件：服務帳號認證（JWT bearer）       | `server/src/infra/sheets/serviceAccountToken.ts`                                        | 一致     | `createServiceAccountTokenProvider()`；私鑰只從環境變數進來                                                      |
| 元件：Google Sheets API                | `sheetWriter.ts`（`values.batchUpdate`）、`googleSheetsFetcher.ts`（`export`）          | 已修正圖 | 圖上原本只寫 `values.batchUpdate`；實際上**讀取**走的是 `GET /v4/spreadsheets/{id}/export`（拿 xlsx 來解析版面） |
| 類別：試算表寫入器／Google試算表寫入器 | `sheetWriter.ts` 的 `SheetWriter` 與 `GoogleSheetWriter`                                | 一致     | 介面讓測試注入假寫入器，不連網路                                                                                 |
| 類別：儲存格更新                       | `sheetWriter.ts` 的 `SheetCellUpdate`（`cell`、`value`）                                | 一致     | —                                                                                                                |
| 類別：服務帳號憑證                     | `serviceAccountToken.ts` 的 `ServiceAccountCredentials`                                 | 一致     | —                                                                                                                |
| 類別：寫回錯誤                         | `sheetWriter.ts` 的 `SheetWriteError`／`SheetAuthError`                                 | 一致     | —                                                                                                                |
| 類別：目標儲存格寫入                   | `guidedNotesWriteBack.ts` 的 `buildLiveWrites()` 產物                                   | 一致     | —                                                                                                                |
| 類別：線上題目                         | `guidedNotesWriteBack.ts` 的 `LiveSheet`／線上題目解析結果                              | 已修正圖 | **圖上原本沒有**。比對需要題幹、空格數、前綴與位置                                                               |
| 列舉：版面關係                         | `guidedNotesWriteBack.ts` 的 `type LayoutRelation = 'same' \| 'remapped' \| 'modified'` | 已修正圖 | **圖上原本沒有**                                                                                                 |
| 類別：寫回結果                         | `guidedNotesWriteBack.ts` 的 `WriteBackResult`                                          | 已修正圖 | 圖上原本沒有 `remapped` 欄位；實際型別是 `{ ok: true; writtenCells: number; remapped: boolean }`                 |

## 修改了哪些圖、為什麼

三張圖都改了，因為原本的圖描述的是**較早期、較簡化的寫回流程**：

- **component**：補上「線上版面讀取（SheetFetcher）」與「版面比對（內容＋位置）」兩個元件，
  並把 Google API 的讀取端點標成 `GET /v4/spreadsheets/{id}/export`。
- **seq**：原本的時序是「檢查 → 解析要寫的儲存格 → 直接寫入」，**完全沒有比對步驟**。
  現在改成「檢查 → **重新讀取線上試算表 → 比對** → 依 same／remapped／modified 分流 →
  （same／remapped 才）解析目標儲存格 → 寫入」，
  並補上三個原本沒畫的回應分支：`SHEET_CHECK_FAILED`（讀不到）、`SHEET_MODIFIED`（題目被改）、
  以及成功回應裡的 `remapped` 旗標。
- **class**：補上「線上試算表讀取器」介面與實作、「線上題目」、「版面關係」列舉，
  並在「寫回結果」補上 `已重新對位`（remapped）欄位。

### 為什麼這個差異重要

006 的核心語意就是「**寫回前一定要重新讀取線上試算表並比對版面**」，而且這段邏輯修過三次：

- **T023**（寫回前比對線上試算表版面）
- **T026**（比對失敗與「確認沒改」分開 —— 讀不到也要停下來問老師）
- **T027**（移除 force；題目被改時一律不寫回）
- **T029**（自動對到線上現在的新格子 → `remapped`）

原本的圖描述的是 T023 之前的流程 —— 看圖會以為「按匯入時的座標直接寫」，
而那正是 T027 明確移除、並造成過答案整體錯位一行的舊行為。圖是課程評分依據、也是唯一正本，
所以這裡必須修圖。

## 未解決的差異

無。三張圖目前都與程式一致，且本次核對未發現需要更動程式行為的差異。

---

PNG 已由 `scripts/render-diagrams.sh` 產生（PlantUML v1.2026.9），`scripts/check-diagrams.sh` 通過。
