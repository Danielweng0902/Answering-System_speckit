# Data Model: 寫回線上 Google Sheets（006）

**Branch**: `006-guided-notes-writeback`｜**日期**：2026-11-17

**本子功能不改變資料庫結構。** 沿用 001～005 的資料表，只新增兩個環境變數。

## 1. 沿用的既有資料

| 來源 | 欄位 | 006 的用途 |
|---|---|---|
| `guided_notes` | `source_kind` | 必須是 `link` 才有雲端目標；`file`（上傳的 xlsx）則回 `GUIDED_NOTES_NOT_LINK` |
| `guided_notes` | `source_url` | 正規化的試算表網址 `https://docs.google.com/spreadsheets/d/<id>`；`<id>` 就是寫入 API 用的試算表 ID |
| `guided_notes` | `sheet_name` | 寫入時的工作表名稱（002 匯入時解析出來的那一個） |
| `guided_notes` | `file` | 原檔 BLOB；004 匯出時用來判斷題組版面（前綴格與答案格是否分離），006 線上寫回改用線上試算表現在的版面（2026-11-19 T029）；不修改 |
| `blanks` | `cell`、`prefix` | 每個空格的 A1 座標與前綴；用來比對線上版面（題目是否被改過）與匯出時的寫入位置 |
| `submissions` | — | 只讀：判定哪一組搶答成功（沿用 005 的衍生計算） |

## 2. 環境變數（不是資料表）

| 變數 | 說明 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 服務帳號信箱；老師要把試算表共用給這個信箱 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | 服務帳號 RSA 私鑰（PEM）。只放 `.env`（已 gitignore），不進資料庫、不進 log（原則 IV、FR-006） |

兩個變數**同時存在**才啟用線上寫回；缺任何一個，寫回功能回 `SHEET_NOT_CONFIGURED`，其餘功能不受影響。

## 3. 寫入的目標儲存格（衍生，不保存）

| 欄位 | 型別 | 規則 |
|---|---|---|
| `cell` | 字串（A1 座標） | 前綴格與答案格分離（02）→ 右側獨立格；前綴在合併填答區（04）→ 該合併格；單題 → 原格 |
| `content` | 字串 | 分離時只有答案；合併時是「前綴＋答案」；單題是答案 |

這份判定**不保存**，每次寫回時即時推導。004 匯出用 `resolveGuidedNotesTargets()`（依匯入時的原檔），006 線上寫回用同一套規則（`buildBlankWrites()`）但座標與合併資訊改用線上試算表現在的版面（2026-11-19 T029），確保「下載的檔案」與「寫回的表」一致。

## 4. 不變量

- 寫回 **MUST NOT** 新增、修改或刪除任何資料列（FR-005）；它是唯讀本地資料的動作。
- 寫回 **MUST NOT** 改變 `activity.revision`、`phase` 或作答的 `rank`／`voided_at`。
- 寫回後，線上試算表的變更只限於答案儲存格；老師原本的格式、公式與其他內容不動（FR-002）。
