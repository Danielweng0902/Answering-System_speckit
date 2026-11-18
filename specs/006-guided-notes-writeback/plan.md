# Implementation Plan: 寫回線上 Google Sheets（guided-notes-writeback）

**Branch**: `006-guided-notes-writeback`（疊在 `005-fairness-and-extras` 之上）| **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

## Summary

老師以 Google Sheets 連結匯入學習單後，活動結束可一鍵把搶答成功組別的答案**寫回那份線上試算表**（助教 2026-11-17 說明的課程規範）。寫入只用 `spreadsheets.values.batchUpdate`，只改答案值，老師原本的格式、公式與版面完全不動。認證用服務帳號 JWT，金鑰只放 `.env`。

**與 004 共用同一套「答案要寫到哪一格」判定**（`resolveGuidedNotesTargets()`）：02 分離版面寫右側獨立格、04 合併填答區寫「前綴＋答案」、單題寫原格。兩邊行為一致，不會出現「下載的檔案對、寫回不對」。

## Technical Context

- **Language/Version**: 沿用 001（TypeScript 5.x、Node.js 24 以上）
- **Dependencies**: 不新增；JWT 簽章用 Node 內建 `node:crypto` 的 RS256
- **Storage**: 不新增資料表、不改 schema；服務帳號金鑰只放環境變數
- **Testing**: vitest 單元（請求內容、錯誤對映、JWT 簽章）＋ 整合（假的寫入器、HTTP 路由）＋ 人工（真的寫回一份線上試算表）
- **外部相依**: Google Sheets API v4 與 OAuth2 token 端點；測試一律注入假的 fetch，不連網路

## 模組對應（原則 VII）

| 圖中元件 | 實際模組與型別 |
|---|---|
| 試算表寫入器（`SheetWriter`） | `server/src/infra/sheets/sheetWriter.ts`：`SheetWriter`、`GoogleSheetWriter`、`SheetWriteError`、`toSheetRange()` |
| 服務帳號認證 | `server/src/infra/sheets/serviceAccountToken.ts`：`createServiceAccountTokenProvider()`、`signServiceAccountJwt()` |
| 寫回服務 | `server/src/app/guidedNotesWriteBack.ts`：`writeBackGuidedNotes()` |
| 目標儲存格判定（與 004 共用） | `server/src/app/guidedNotesTargets.ts`：`resolveGuidedNotesTargets()`；`guidedNotesExporter.ts` 的 `buildBlankWrites()` |
| 匯出路由 | `server/src/infra/http/exportRoutes.ts`：`POST /api/export/guided-notes/writeback` |
| 老師端畫面 | `web/src/features/teacher/TeacherPage.tsx`；`web/src/lib/api.ts` 的 `writeBackGuidedNotes()` |

## 錯誤對映（既有錯誤代碼風格）

| 情況 | 錯誤代碼 | HTTP |
|---|---|---|
| 匯入來源是上傳的 xlsx | `GUIDED_NOTES_NOT_LINK` | 422 |
| 伺服器沒有服務帳號設定 | `SHEET_NOT_CONFIGURED` | 503 |
| 試算表不存在／工作表改名 | `SHEET_NOT_FOUND` | 422 |
| 沒有編輯權限（401／403） | `SHEET_NOT_EDITABLE` | 422 |
| 限流、逾時、5xx | `SHEET_UNAVAILABLE` | 502 |

## Project Structure

```
server/src/
├── infra/sheets/
│   ├── sheetWriter.ts            # 新增：寫入介面、Google API 實作、錯誤對映
│   └── serviceAccountToken.ts    # 新增：服務帳號 JWT bearer 與 token 快取
├── app/
│   ├── guidedNotesTargets.ts     # 新增：答案 → 目標儲存格（與 004 共用）
│   └── guidedNotesWriteBack.ts   # 新增：寫回用例
├── config.ts                     # 新增兩個環境變數
└── index.ts                      # 建立寫入器並注入路由
web/src/
├── lib/api.ts                    # 新增 writeBackGuidedNotes()
└── features/teacher/TeacherPage.tsx  # 新增「寫回 Google 試算表」按鈕
```

## Complexity Tracking

| 項目 | 決定 | 理由 |
|---|---|---|
| 判定保存 vs 衍生 | 沿用 005 的衍生計算，寫回與匯出共用 `resolveGuidedNotesTargets()` | 兩條路徑的儲存格必須一致，共享同一個函式最不容易出錯 |
| 寫入 API | `values.batchUpdate`（只寫值） | 保留老師格式與公式；`spreadsheets.batchUpdate` 會重建整張表 |
| 認證 | 服務帳號 JWT | 老師只做「共用」一步；不需要每位老師做 OAuth 授權流程 |
| 失敗處理 | 回中文錯誤 + 保留下載備援 | 課堂中不能因外部服務失敗就卡住 |
