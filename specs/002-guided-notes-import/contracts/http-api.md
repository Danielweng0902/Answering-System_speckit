# Contract: HTTP API（002）

沿用 [001 HTTP API](../../001-activity-session/contracts/http-api.md) 的回應格式：所有回應為 JSON，錯誤為 `{ "error": { "code": "<代碼>", "message": "<中文訊息>" } }`。

兩個端點都需要老師身分：`Authorization: Bearer <token>`（token 來自 `POST /api/teacher/login`）。兩個端點都**只讀取不寫入**；題目要等 Socket 指令 `questions:confirm` 才會改變（見 [socket-events.md](./socket-events.md)）。

## POST /api/questions/import/file

上傳 xlsx 讀取摘要（FR-001、003；AC-002-01、07–17）。

- Request: 本體是 xlsx 位元組；`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 或 `application/octet-stream`；選用標頭 `X-File-Name`（原檔名，URL 編碼）
- 200: `ImportSummary`（見 [data-model.md](../data-model.md)）
- 400 `FILE_INVALID`：不是 xlsx 或檔案損壞
- 413 `FILE_TOO_LARGE`：超過 5 MB，或解壓後超過 50 MB
- 422 `HEADER_NOT_FOUND`、`NO_QUESTIONS`、`DUPLICATE_QUESTION_NUMBER`：內容不符（見下方錯誤代碼）
- 401 `UNAUTHORIZED`：沒有帶 token 或 token 無效
- 403 `FORBIDDEN`：不是老師
- 409 `INVALID_PHASE`：不在準備中

## POST /api/questions/import/link

以 Google Sheets 連結讀取摘要（FR-001、002；AC-002-04、18）。

- Request: `{ "url": string }`
- 200: `ImportSummary`
- 400 `INVALID_INPUT`：缺少 `url`
- 400 `LINK_INVALID`：不是 `https://docs.google.com/spreadsheets/d/<ID>/...` 形式
- 422 `LINK_NOT_SHARED`：試算表沒有開放「知道連結者可檢視」
- 502 `LINK_UNREACHABLE`：無法連線或逾時
- 下載到的檔案同上傳一樣檢查：`FILE_INVALID`、`FILE_TOO_LARGE`、`HEADER_NOT_FOUND`、`NO_QUESTIONS`、`DUPLICATE_QUESTION_NUMBER`
- 401、403、409 同上

## 新增錯誤代碼

| 代碼 | 意義 | 給使用者的訊息（範例） |
|---|---|---|
| `UNAUTHORIZED` | 沒有登入或登入已失效 | 請先以老師身分登入 |
| `FILE_INVALID` | 不是 xlsx 或檔案損壞 | 無法讀取這個檔案，請上傳 xlsx 格式的學習單 |
| `FILE_TOO_LARGE` | 超過大小上限 | 檔案太大，請上傳 5 MB 以內的 xlsx 檔 |
| `HEADER_NOT_FOUND` | 找不到表頭 | 找不到表頭。學習單需要有一列同時包含「題號」「題目」「作答」三個欄位 |
| `NO_QUESTIONS` | 有表頭但沒有題目 | 表頭下方沒有找到任何題號，請確認題號欄填的是數字 |
| `DUPLICATE_QUESTION_NUMBER` | 題號重複 | 題號 3 重複（第 9、11 列），請修正後重新匯入 |
| `LINK_INVALID` | 不是 Google Sheets 連結 | 這不是 Google 試算表連結，請貼上 docs.google.com/spreadsheets 開頭的網址 |
| `LINK_NOT_SHARED` | 未開放檢視 | 無法讀取這份試算表。請把共用設定改成「知道連結者可檢視」，或下載成 xlsx 後上傳 |
| `LINK_UNREACHABLE` | 無法連線 | 無法連線到 Google 試算表，請檢查網路，或下載成 xlsx 後上傳 |

`DUPLICATE_QUESTION_NUMBER` 與 `NO_QUESTIONS`、`HEADER_NOT_FOUND` 的訊息由伺服器依實際內容組出（題號、列號、工作表名稱），滿足 FR-018。

規則：

- 任何錯誤回應都 MUST NOT 改變資料（FR-019）。
- 伺服器 MUST NOT 在 log 中輸出 token、上傳檔案內容或完整連結的查詢字串。
