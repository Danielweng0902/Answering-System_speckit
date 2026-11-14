# 004 T030 截圖產物與未完成項

日期：2026-11-14。

## 已產生

以下兩張 UI 圖均由 Playwright 在實際作答→結束→匯出流程中取得 (`npm run test:e2e -- tests/004-export.spec.ts`；或以 e2e 工作目錄執行 `npm test -- tests/004-export.spec.ts`)：

| 檔案 | 用途 |
|---|---|
| `teacher-closed-full-page.png` | 已結束的老師頁面，全頁截圖 |
| `teacher-closed-export-buttons.png` | 「匯出」區域，顯示「匯出 Guided Notes」與「匯出 CSV」兩個按鈕 |

![Closed 的老師匯出區](teacher-closed-export-buttons.png)

同一份測試保存的實際下載檔：

- `downloads/guided-notes.xlsx`
- `downloads/results.csv`（UTF-8 BOM）

這些不是以 HTML 或手寫檔案偽造的匯出物。檔案格式也已驗證：xlsx 是 Microsoft Excel 2007+，CSV 為含 BOM 的 UTF-8 CRLF 文字。

## T030 尚未完成的部分

那份 `downloads/guided-notes.xlsx` 已實際透過 Microsoft Excel 開啟，Excel 視窗標題為 `guided-notes`，可見 `學習單` 工作表；此過程沒有修改原檔。然而目前不能將 Excel 視窗畫面保存到本目錄：

- T3 device access 未被啟用。
- 新增 Swift／shell 的視窗或螢幕截圖被 macOS TCC 拒絕。
- 沒有要求或修改使用者的安全設定，也沒有把 HTML 重排版本冒充 Excel 的視覺驗收截圖。

因此 **`excel-guided-notes-open.png` 目前不存在，T030 不勾完成**。

### 設計／驗證負責人續辦

1. 用 Excel 或 LibreOffice 打開 `downloads/guided-notes.xlsx`。
2. 人工比對答案位置、未作答標記與原始格式。
3. 擷取開啟檔案的畫面存成 `excel-guided-notes-open.png`。
4. 在 PR 回報後才完成 T030。這不取代 T027b peer review、T031 人工 quickstart，也不證明 SC-005 的 Google Sheets 匯回已通過。

> 此清單只記資產與限制，不記錄 macOS app 內其他使用者的文件或視窗內容。
