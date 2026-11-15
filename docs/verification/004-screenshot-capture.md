# 004 T030 截圖產物與驗證狀態

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

## 2026-11-15 更新

設計／驗證負責人已實際開啟 `downloads/guided-notes.xlsx`，並把 Excel 畫面存成 `excel-guided-notes-open.png`。該檔與對應 manual 記錄已於 2026-11-15 進入 004-export 分支。

**T030 的需求產物已齊。** 這只表示老師與檔案的畫面備妥，不代表 T027b 已通過、T031 已全數通過，也不代表題組答案位置的版型問題已得到確認。T031 中發現的 A～D 問題仍依該文件與後續澄清處理。

> 本檔只記錄截圖資產與驗證狀態，不使用外部 HTML 預覽冒充 Excel/LibreOffice 原始檔面，也不記錄本機其他使用者的文件或視窗內容。
