# Data Model: Guided Notes 匯入

沿用 001 的 Activity、Group、Session（見 [001 data-model](../001-activity-session/data-model.md)）。本子功能新增下列實體。

## 實體

### GuidedNotes（學習單）

一個活動同一時間最多一份（`id = 1`）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `sourceKind` | `'link' \| 'file'` | 來源種類 |
| `sourceUrl` | 字串，可空 | 以連結匯入時，正規化後的 `https://docs.google.com/spreadsheets/d/<ID>`；不保存老師貼上的原始字串（不含查詢字串與 `#gid`） |
| `fileName` | 字串，可空 | 以檔案匯入時的原檔名 |
| `file` | 位元組 | 原始 xlsx（004 匯出用） |
| `sheetName` | 字串 | 實際使用的工作表 |
| `importedAt` | 時間 | 確認匯入的時間 |

### Question（題目）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | 字串（隨機） | |
| `number` | 正整數 | 原檔的題號；同一份學習單內不重複 |
| `kind` | `'single' \| 'group'` | 單題或題組 |
| `prompt` | 字串 | 題目敘述，可為空字串 |
| `position` | 整數 | 在原檔中由上而下的順序 |

### Blank（空格）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `questionId` | 字串 | 所屬題目 |
| `position` | 整數 | 在題目中的順序，從 1 起算 |
| `prefix` | 字串 | 前綴，例如「（1）」；沒有則為空字串 |
| `cell` | 字串 | 原檔中的位置（A1 表示法，例如 `G5`），合併範圍取左上角 |

規則：

- 單題恰有 1 個空格；題組至少 2 個空格（FR-007、FR-008）。
- 同一題內 `cell` 不重複。

### ImportPreview（讀取結果，不保存）

伺服器記憶體中只保留最近一次，15 分鐘後失效（research R6）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `importId` | 字串（隨機） | 確認時使用 |
| `createdAt` | 時間 | |
| `source` | 同 GuidedNotes 的 `sourceKind`、`sourceUrl`、`fileName`、`file` | |
| `sheetName` | 字串 | |
| `questions` | Question＋Blank 清單 | 尚未有 `id` |
| `warnings` | `ImportWarning[]` | |

### ImportSummary（回給老師的摘要）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `importId` | 字串 | |
| `sheetName` | 字串 | |
| `questionCount` | 整數 | |
| `blankCount` | 整數 | |
| `questions` | `{ number, kind, prompt, blankCount, blanks: { prefix, cell }[] }[]` | |
| `warnings` | `ImportWarning[]` | |
| `replacesExisting` | 布林 | 活動已有題目時為 true，畫面據此提示會取代（FR-015） |

### ImportWarning（提醒，不阻擋匯入）

| `code` | 何時 | 附帶資料 |
|---|---|---|
| `NUMBERS_NOT_SEQUENTIAL` | 題號不是從 1 開始或不連續 | `numbers` |
| `BLANK_HAS_CONTENT` | 空格在前綴之外已有內容 | `number`、`cell` |
| `MULTIPLE_SHEETS_WITH_HEADER` | 多個工作表含表頭 | `sheetName`（使用的工作表） |

每個提醒都附中文 `message`。

## 狀態與規則

| 情況 | 結果 |
|---|---|
| 準備中，老師讀取成功 | 回傳摘要；資料不變 |
| 準備中，老師讀取失敗 | 回傳錯誤；資料不變（FR-019） |
| 準備中，老師確認有效的 `importId` | 在同一個 transaction 刪除舊的學習單、題目、空格，寫入新的；`activity.revision` +1；廣播 |
| 確認時 `importId` 不存在或已失效 | `IMPORT_EXPIRED`；資料不變 |
| 搶答中、已結束，讀取或確認 | `INVALID_PHASE`；資料不變（FR-004） |
| 重設活動（001） | 學習單、題目、空格保留（spec FR-021） |
| 準備中，沒有題目時開啟搶答（001） | `QUESTIONS_REQUIRED`（FR-020） |

## 快照（延伸 001）

| 身分 | 新增欄位 |
|---|---|
| 老師 | `questions: { number, kind, prompt, blankCount }[]`（依 `position`）；`guidedNotes: { sheetName, sourceKind, fileName \| null, importedAt } \| null` |
| 學生、訪客 | 無。學生在搶答中之前不得收到題目（FR-016）；搶答中要看到的內容由 003 定義 |

## SQLite 資料表

```text
guided_notes(id INTEGER PRIMARY KEY CHECK (id = 1), source_kind TEXT, source_url TEXT NULL, file_name TEXT NULL, file BLOB, sheet_name TEXT, imported_at TEXT)
questions(id TEXT PRIMARY KEY, number INTEGER UNIQUE, kind TEXT, prompt TEXT, position INTEGER)
blanks(question_id TEXT REFERENCES questions(id) ON DELETE CASCADE, position INTEGER, prefix TEXT, cell TEXT, PRIMARY KEY (question_id, position))
```
