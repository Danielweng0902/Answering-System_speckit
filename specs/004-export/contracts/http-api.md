# Contract: HTTP API（004）

沿用 [001 HTTP API](../../001-activity-session/contracts/http-api.md) 與 [002 HTTP API](../../002-guided-notes-import/contracts/http-api.md) 的格式：老師身分以 `Authorization: Bearer <token>` 帶入（token 來自 `POST /api/teacher/login`），錯誤回應為 JSON `{ "error": { "code": "<代碼>", "message": "<中文訊息>" } }`。

兩個端點都是**唯讀**：

- 不改變任何資料（FR-008）。
- 不產生 Socket.IO 事件，不遞增 `activity.revision`。
- 回應是**檔案本身**（不是 JSON），因此成功時不是 `{ ok: true }` 而是二進位內容加上 `Content-Disposition`。

## GET /api/export/guided-notes

下載已填入搶答成功答案的試算表檔（FR-001～FR-008；AC-004-01～09、16）。檔名規則見 FR-007。

- Request：無 body；`Authorization: Bearer <token>`
- 200：
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="搶答結果_YYYYMMDD_HHmm.xlsx"`（檔名含 UTF-8 字元時以 `filename*=UTF-8''<percent-encoded>` 一併提供）
  - Body：xlsx 位元組
- 401 `UNAUTHORIZED`：沒有帶 token 或 token 無效
- 403 `FORBIDDEN`：不是老師
- 409 `INVALID_PHASE`：活動不在「已結束」階段（FR-016）
- 422 `NO_GUIDED_NOTES`：這個活動沒有匯入過學習單（沒有題目也沒有原檔）（FR-017）

**內容規則**：

1. 每一題若沒有搶答成功組別 → 該題所有填空格**保持原檔內容**（FR-004、AC-004-02）。
2. 每一題若有搶答成功組別 → 每個填空格寫入「**前綴＋答案**」（FR-005、AC-004-08）；單題的前綴是空字串，因此只寫答案。
3. 寫入值一律是**純文字**，不得被試算表軟體當成公式（FR-006、AC-004-14）。
4. 除填格外，合併儲存格、欄寬、列高、框線、字型、對齊與原檔相同（FR-003、AC-004-03）。
5. 被老師作廢且未再送出的作答不算搶答成功，該題視為無人作答（AC-004-16）。

## GET /api/export/results.csv

下載活動結果 CSV（FR-009～FR-015；AC-004-10～15、17）。

- Request：無 body；`Authorization: Bearer <token>`
- 200：
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="搶答結果_YYYYMMDD_HHmm.csv"`（FR-007）
  - Body：UTF-8 位元組，**開頭為 BOM**（`EF BB BF`），讓 Excel 直接開啟不亂碼（FR-012、AC-004-12）
- 401 `UNAUTHORIZED`、403 `FORBIDDEN`、409 `INVALID_PHASE`：同上（FR-016）

**欄位**（FR-010，依 Feature Contract D13）：

```
題號,空格序,組別,答案,順位,是否搶答成功,送出時間
```

- 第一列為欄位名稱。
- 一筆作答的**每個空格各一列**（FR-011）。
- 排序：題號 → 順位 → 空格序（FR-011）。
- 「是否搶答成功」為「是」或「否」（Assumptions）。
- 「送出時間」為 ISO 8601 字串（含時區與毫秒，例如 `2026-11-14T09:30:00.123Z`），直接對照 `submissions.received_at`。
- 「空格序」為該題的第幾個空格，與 002 匯入時存入 `blanks.position` 的順序一致。
- **只包含有效作答**；被作廢的作答不產生列（FR-009、AC-004-17）。
- 沒有任何有效作答時，只輸出欄位名稱列（AC-004-15）。

**轉義規則**：

| 情況 | 處理 | 對應 |
|---|---|---|
| 內容含逗號 `,` | 用雙引號包住整個欄位 | FR-013、AC-004-13 |
| 內容含雙引號 `"` | 雙引號加倍成 `""`，再用雙引號包住 | FR-013 |
| 內容含換行 | 用雙引號包住整個欄位 | FR-013 |
| 內容以 `=`、`+`、`-`、`@` 開頭 | 在前面加一個單引號 `'` | FR-014、AC-004-14 |
| 中文 | 原樣輸出，檔案開頭加 BOM | FR-012 |

> 加單引號是為了讓試算表軟體把內容當成文字；這是 CSV 通用做法，會讓欄位值在原始檔中多一個前導單引號。

## 新增錯誤代碼

| 代碼 | 意義 | 給使用者的訊息（範例） | HTTP |
|---|---|---|---|
| `NO_GUIDED_NOTES` | 這個活動沒有匯入過學習單，無法匯出 | 這個活動沒有匯入過學習單，請先匯入學習單 | 422 |

`UNAUTHORIZED`、`FORBIDDEN`、`INVALID_PHASE` 沿用 001／002 的既有代碼與訊息。

> **注意**：002 已使用 `NO_QUESTIONS` 表示「匯入的檔案裡找不到題號」，訊息不同。004 必須使用**獨立的** `NO_GUIDED_NOTES`，不得覆寫 `NO_QUESTIONS` 的既有訊息（憲法原則 I：不得使其他子功能的行為改變）。

## 規則

- 任何錯誤回應都 MUST NOT 改變資料，也不 MUST NOT 產生任何檔案（原則 III）。
- 伺服器 MUST NOT 在 log 中輸出 token、學生的答案內容或檔案位元組（原則 IV）。匯出只記錄事件名稱與檔案大小。
- 伺服器 MUST NOT 直接修改雲端上的試算表；匯出永遠是下載一個新檔案（clarify 2026-11-14、Feature Contract D12）。
