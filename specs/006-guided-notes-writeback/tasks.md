# Tasks: 寫回線上 Google Sheets（006）

**Input**: [spec.md](./spec.md)｜**Plan**: [plan.md](./plan.md)｜**Contract**: [contracts/http-api.md](./contracts/http-api.md)

**Prerequisites**: 001～005 已完成；本分支疊在 `005-fairness-and-extras` 之上（005 合併後要 rebase 到 `main`）。

## Phase 1: Foundational

- [x] T001 在 `shared/src/protocol.ts` 新增錯誤代碼與訊息：`GUIDED_NOTES_NOT_LINK`、`SHEET_NOT_CONFIGURED`、`SHEET_NOT_FOUND`、`SHEET_NOT_EDITABLE`、`SHEET_UNAVAILABLE`
- [x] T002 新增 `server/src/infra/sheets/sheetWriter.ts`：`SheetWriter` 介面、`GoogleSheetWriter`（`values.batchUpdate`）、`SheetWriteError`、`toSheetRange()`（工作表名稱加單引號並跳脫）
- [x] T003 新增 `server/src/infra/sheets/serviceAccountToken.ts`：服務帳號 JWT（RS256）＋ token 端點交換 ＋ 到期前快取
- [x] T004 寫 `server/tests/unit/sheetWriter.test.ts`：請求網址／標頭／內容、工作表名稱跳脫、空更新不發請求、HTTP 狀態對映錯誤代碼、網路錯誤視為暫時不可用
- [x] T005 寫 `server/tests/unit/serviceAccountToken.test.ts`：JWT 內容與簽章可用公鑰驗證、`\n` 還原、token 快取不再重複請求、token 端點失敗時拋錯

## Phase 2: User Story 1 - 一鍵寫回

- [x] T006 抽出 `server/src/app/guidedNotesTargets.ts` 的 `resolveGuidedNotesTargets()`：目標儲存格與內容（與 004 匯出共用），並讓 `exportGuidedNotes()` 改用它
- [x] T007 新增 `server/src/app/guidedNotesWriteBack.ts` 的 `writeBackGuidedNotes()`：來源檢查、服務帳號檢查、解析目標儲存格、呼叫寫入器、錯誤對映
- [x] T008 寫 `server/tests/integration/guidedNotesWriteBack.test.ts`：02 寫右側獨立格、04 寫合併格並保留前綴、連結來源帶正確試算表 ID、xlsx 來源不呼叫寫入器、沒有服務帳號、沒有答案時不寫入、錯誤代碼對映、本地資料不變
- [x] T009 新增 `POST /api/export/guided-notes/writeback`（只有老師、只有已結束），錯誤狀態碼依既有風格
- [x] T010 寫 `server/tests/integration/writeBackRoutes.test.ts`：老師已結束可寫回、401／403／409、未設定服務帳號回 503
- [x] T011 `server/src/config.ts` 新增 `GOOGLE_SERVICE_ACCOUNT_EMAIL`／`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`；`index.ts` 建立寫入器並注入路由（測試可注入假的）

## Phase 3: User Story 2 - 失敗處理與老師端介面

- [x] T012 `web/src/lib/api.ts` 新增 `writeBackGuidedNotes()`：保留伺服器的中文錯誤訊息
- [x] T013 `web/src/features/teacher/TeacherPage.tsx` 新增「寫回 Google 試算表」按鈕、成功／失敗訊息；上傳 xlsx 來源時停用並提示改用下載
- [x] T014 寫 `web/tests/teacher/TeacherWriteBack.test.tsx`：成功顯示寫入格數、失敗顯示伺服器訊息、xlsx 來源按鈕停用

## Phase 4: Polish 與驗證

- [x] T015 新增三張 006 圖（component／class／seq-writeback）並重出 PNG，`scripts/check-diagrams.sh` 通過
- [x] T016 更新 `README.md`（進度表、操作流程）與 `docs/EXECUTION-PLAYBOOK.md`（006 的注意事項）
- [x] T017 執行 `npm test`、`npm run test:e2e`、`npm run check`，記錄在 `docs/verification/006-automated.md`
- [x] T018 **真實線上寫回的人工驗證**（需要服務帳號金鑰與一份可編輯的線上試算表）：依 `quickstart.md` 執行，結果寫在 `docs/verification/006-manual.md`
- [ ] T019 **另一位組員審查**（憲法要求的合併關卡）：在 PR 上留下 review，重點為寫入範圍、權限與錯誤處理
- [x] T020 **共用契約 D12 改版**：005 合併後一次套用（避免兩個 PR 同時改同一份契約）。D12 已改為「對線上試算表讀寫」並升版（v0.6），`docs/shared/FEATURE-CONTRACT.md` 已更新

## Notes

- **判定不保存**（沿用 005 research R1）：寫回與匯出都只是「重算一次答案要寫到哪裡」，不新增狀態。
- **寫入失敗不可中斷活動**：所有 Google 錯誤都在伺服器端轉成既有錯誤代碼，老師端永遠有「下載 xlsx」的備援。
- **金鑰零落地**：服務帳號私鑰只從環境變數讀取；log 只記寫入格數。
- **上傳 xlsx 的老師沒有雲端目標**：這條路徑維持下載，並在介面上說清楚。
