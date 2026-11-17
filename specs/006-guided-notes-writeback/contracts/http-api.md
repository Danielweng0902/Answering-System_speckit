# Contract: HTTP（006 寫回線上 Google Sheets）

沿用 [004 contracts/http-api.md](../../004-export/contracts/http-api.md) 的格式與錯誤回應格式：

```json
{ "error": { "code": "<代碼>", "message": "<中文訊息>" } }
```

## POST /api/export/guided-notes/writeback

把本次活動各題搶答成功組別的答案，直接寫回老師原本那份線上 Google 試算表。

- Request：無 body；`Authorization: Bearer <token>`
- 權限：**只有老師**（`FORBIDDEN`）；未登入（`UNAUTHORIZED`）
- 階段：只有 `closed`（`INVALID_PHASE`）
- 前提：有匯入過學習單（`NO_GUIDED_NOTES`）

### 200

```json
{ "writtenCells": 6 }
```

`writtenCells` 是實際寫入的儲存格數；沒有任何搶答成功答案時為 `0`（不寫入任何儲存格）。

### 錯誤

| 代碼 | HTTP | 意義 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 沒有帶 token 或 token 無效 |
| `FORBIDDEN` | 403 | 不是老師 |
| `INVALID_PHASE` | 409 | 活動還沒結束 |
| `NO_GUIDED_NOTES` | 422 | 沒有匯入過學習單 |
| `GUIDED_NOTES_NOT_LINK` | 422 | 匯入來源是上傳的 xlsx，沒有雲端試算表可寫回；請改用下載 xlsx |
| `SHEET_NOT_CONFIGURED` | 503 | 伺服器沒有設定 Google 服務帳號；請改用下載 xlsx |
| `SHEET_NOT_FOUND` | 422 | 找不到這份試算表（可能被改名或刪除）；請改用下載 xlsx |
| `SHEET_NOT_EDITABLE` | 422 | 沒有編輯權限（試算表還沒共用給服務帳號）；請改用下載 xlsx |
| `SHEET_UNAVAILABLE` | 502 | 暫時無法寫入（限流、逾時或服務異常）；請稍後再試或改用下載 xlsx |

## 規則

- 錯誤回應 MUST NOT 改變任何資料（原則 III）。
- 寫回 MUST NOT 改變作答、題目、階段或 revision（FR-005）；它是唯讀本地資料的動作。
- 伺服器 MUST NOT 在 log 記錄答案內容、token、金鑰或試算表內容；只記「寫入幾格」（原則 IV、FR-010）。
- 寫入只使用 `values.batchUpdate` 且 `valueInputOption=RAW`，MUST NOT 改變老師原本的格式、公式與版面（FR-002）。
