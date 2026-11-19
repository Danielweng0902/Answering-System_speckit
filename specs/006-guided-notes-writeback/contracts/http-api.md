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

> **沒有「略過檢查」的參數**：伺服器在寫回前一定會重新讀取線上試算表，並使用「現在」的座標寫入（2026-11-19 review 實測：照匯入時的舊座標硬寫會整體錯位）。

### 200

```json
{ "writtenCells": 6 }
```

`writtenCells` 是實際寫入的儲存格數；沒有任何搶答成功答案時為 `0`（不寫入任何儲存格）。

> 寫回**只會覆寫這次有搶答成功答案的題目**：同一份試算表寫回第二次時，這次沒人作答的題目會保留上一場的答案（寫回不清空它們；04 那種前綴與答案同格的版面清空會連前綴一起刪掉）。此限制已寫入老師端成功訊息與 quickstart。

> 寫回前一定會重新讀取並解析線上試算表，用**「現在」的座標**寫入，三種結果分開處理：
> - **版面沒變** → 直接寫入。
> - **位置被挪動但題號／前綴／空格數都還對得上**（例如老師插了一列）→ 直接用線上現在的座標寫入，答案仍對得上題目，不會整體錯位。
> - **題目本身被改動**（題號／空格數／前綴不同）→ 對應不起來，回 `SHEET_MODIFIED`，請老師改用下載 xlsx。
> - **讀不到或解析不出來** → 無法確定要寫到哪裡，回 `SHEET_CHECK_FAILED`，同樣請老師改用下載 xlsx。

### 錯誤

| 代碼 | HTTP | 意義與老師該怎麼做 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 沒有帶 token 或 token 無效 |
| `FORBIDDEN` | 403 | 不是老師 |
| `INVALID_PHASE` | 409 | 活動還沒結束 |
| `NO_GUIDED_NOTES` | 422 | 沒有匯入過學習單 |
| `GUIDED_NOTES_NOT_LINK` | 422 | 匯入來源是上傳的 xlsx，沒有雲端試算表可寫回；請改用下載 xlsx |
| `SHEET_NOT_CONFIGURED` | 503 | 伺服器沒有設定 Google 服務帳號；請改用下載 xlsx |
| `SHEET_NOT_FOUND` | 422 | 找不到這份試算表，可能已被刪除；請改用下載 xlsx |
| `SHEET_TAB_NOT_FOUND` | 422 | 找不到試算表裡的工作表，可能被改名；請改回原名或重新匯入 |
| `SHEET_NOT_EDITABLE` | 422 | 沒有編輯權限；請把試算表共用給服務帳號，或改用下載 xlsx |
| `SHEET_NOT_NATIVE` | 422 | 這份檔案還是 xlsx 格式；請在試算表選「檔案 → 儲存為 Google 試算表」後重新匯入 |
| `SHEET_API_DISABLED` | 503 | 伺服器的 Google 專案尚未啟用 Sheets API；請通知系統管理者 |
| `SHEET_AUTH_FAILED` | 503 | 伺服器的服務帳號金鑰／授權有誤；請通知系統管理者 |
| `SHEET_MODIFIED` | 409 | 線上試算表的**版面**已與匯入時不同（列欄位置或題目有變動），無法確定答案要寫到哪一格；請改用「匯出 Guided Notes」下載含答案的 xlsx（重新匯入只能在作答前進行，結束後重匯必須先重設、會清掉這場的作答） |
| `SHEET_CHECK_FAILED` | 409 | **無法讀取線上試算表**（例如關掉了「知道連結者可檢視」或網路不穩），比對不了版面；請先重試，仍不行請改用「匯出 Guided Notes」下載含答案的 xlsx |
| `SHEET_UNAVAILABLE` | 502 | 暫時無法寫入（限流、逾時、網路或 Google 服務異常）；請稍後再試或改用下載 xlsx |

## 規則

- 錯誤回應 MUST NOT 改變任何資料（原則 III）。
- 寫回 MUST NOT 改變作答、題目、階段或 revision（FR-005）；它是唯讀本地資料的動作。
- 伺服器 MUST NOT 在 log 記錄答案內容、token、金鑰或試算表內容；只記「寫入幾格」（原則 IV、FR-010）。
- 寫入只使用 `values.batchUpdate` 且 `valueInputOption=RAW`，MUST NOT 改變老師原本的格式、公式與版面（FR-002）。
