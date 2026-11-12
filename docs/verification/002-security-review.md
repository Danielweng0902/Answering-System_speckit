# 002 安全覆核（T051）

審查者：GLM-5.3-max worker（只回報、不改程式）。監督者逐項以程式與實測確認，修正後加上回歸測試。

範圍：`questionRoutes.ts`、`googleSheetsFetcher.ts`、`workbookReader.ts`、`importService.ts`、`questionRepo.ts`、`index.ts`、`app.ts`、`access.ts`；依據 research R4、R5 與 contracts/http-api.md。

## 發現與處理

| # | 發現 | worker 判定 | 監督者確認 | 處理 |
|---|---|---|---|---|
| 1 | 壓縮炸彈：50 MB 檢查只看 zip 宣告的解壓大小，可偽造成小值繞過，交給 exceljs 後無上限展開 | 中 | **實測不成立，降為低**。把 01 的工作表塞入 1 GB 空白、所有本地標頭與中央目錄的解壓大小改成 1000：JSZip 在展開途中就以「uncompressed data size mismatch」中止，`readWorkbook` 回 `FILE_INVALID`，最高記憶體約 110 MB。對照：未偽造的 300 MB 檔若直接交給 exceljs，最高 874 MB——這種檔案已被 50 MB 宣告大小檢查擋下 | 新增回歸測試 `workbookReader.test.ts`「中央目錄與本地標頭偽造成很小的解壓大小時…」，確保日後換版本仍會拒絕 |
| 2 | 上傳端點先由 `express.raw` 讀完最多 5 MB 本體，才檢查身分 | 低 | 成立 | 身分與階段檢查移到 `express.raw` 之前。新增測試「沒有 token 時即使本體超過 5 MB 也先回 401」：修正前回 413，修正後回 401 |
| 3 | 轉址白名單只看協定與主機，`https://docs.google.com:8443/` 會放行 | 低 | 成立（需 Google 本身發出此轉址，可利用性低） | 白名單加上「不可指定埠」。新增測試「轉址到允許的主機但指定其他埠時拒絕」：修正前通過下載，修正後 422 `LINK_NOT_SHARED` |
| 4 | 過期的讀取結果（最多一筆、≤5 MB）在下一次讀取或確認前不會釋放 | 低 | 成立；確認時已檢查 15 分鐘期限，記憶體上限固定為一筆 | 不改，接受風險 |
| 5 | 非預期錯誤（例如請求中斷）由 Express 預設處理器回 HTML，不是 `{error:{code,message}}` | 低 | 成立；`env=production` 不洩漏堆疊與路徑 | 不改，記錄。與 001 共用的錯誤處理，若要統一另開 task |

## 已檢查、未發現問題

- **SSRF**：連結只取 `[A-Za-z0-9_-]+` 的試算表 ID，下載網址由伺服器組出；`redirect: 'manual'`、最多 5 次，每一跳先過 https／主機／埠白名單才發出請求，被拒的回應不讀本體。
- **下載大小**：先看 `content-length`，再逐塊計數，超過 5 MB 立即取消。
- **log**：不記錄 token、檔案內容、連結查詢字串；token 在資料庫只存 SHA-256。
- **身分與階段**：兩個 HTTP 端點 401／403／409 齊全；`questions:confirm` 為老師限定，且在用例內再檢查階段。
- **錯誤訊息**：只用 contracts 的固定訊息；422 只含使用者自己檔案的題號、列號、工作表名稱。
- **X-File-Name**：解碼後只取最後一段、最多 255 字，只存資料庫供顯示（React 會跳脫）。
- **SQL 注入**：全部使用 prepared statement 參數。

## 給規格的意見（不影響本次結果）

- research R4 只寫「最終網址」要在白名單內，實作檢查每一跳，較嚴格，建議回寫規格。
- 讀取結果是全伺服器共用一筆，任何已登入的老師分頁都能確認；規格沒有要求綁定個別分頁，維持現狀。
