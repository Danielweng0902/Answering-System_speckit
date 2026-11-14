# 004 資料模型（export）

> 沿用 [002 data-model](../002-guided-notes-import/data-model.md) 與 [003 data-model](../003-buzz-in/data-model.md) 的實體。**本子功能不新增資料表、不改變任何既有欄位**——匯出是唯讀操作，所有資料都已由 002（匯入）與 003（作答）保存。

## 既有實體（只讀使用）

### GuidedNotes（002）

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `source_kind` | `'link' \| 'file'` | 決定匯出檔名的來源說明（不影響檔名規則，見 FR-007） |
| `source_url` | 字串，可空 | 不寫入匯出檔 |
| `file_name` | 字串，可空 | **不用於**檔名（clarify 2026-11-14：統一用「搶答結果_日期時間.xlsx」） |
| `file` | 位元組 | **匯出檔的基底**：原檔的完整副本，匯出時只修改指定儲存格 |
| `sheet_name` | 字串 | 定位要修改的工作表（解析為 `xl/worksheets/sheetN.xml`） |
| `imported_at` | 字串 | 不寫入匯出檔 |

（實體定義見 `specs/002-guided-notes-import/data-model.md`；資料表 `guided_notes` 在 `server/src/infra/db/database.ts`。）

### Blank（002）——寫入位置的唯一來源

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `question_id` | 字串 | 對應題目 |
| `position` | 整數 | 該題的第幾個空格；同時是 CSV 的「空格序」 |
| `prefix` | 字串 | **前綴文字**（例如「（1）」）；與答案組合後寫入（FR-005） |
| `cell` | 字串（A1 座標，例如 `G5`） | **寫入位置**；由 002 依結構解析取得，非寫死（原則 V、FR-002） |

> 關鍵：前綴是**儲存格文字的一部分**，不是獨立欄位（research R5）。匯出時寫入的是「前綴＋答案」組成的單一儲存格文字。

### Question（002）

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `number` | 正整數 | CSV 的「題號」；與 blanks 的關聯 |
| `kind` | `'single' \| 'group'` | 單題／題組（前綴處理已由 `prefix` 表達） |
| `prompt` | 字串 | 不寫入匯出檔（原檔已有） |
| `position` | 整數 | 題目順序 |

### Submission（003）——CSV 的資料來源

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `question_id` | 字串 | 對應題目 |
| `group_id` | 字串 | CSV 的「組別」（顯示名稱取自 `groups.name`） |
| `rank` | 正整數 | CSV 的「順位」 |
| `received_at` | 字串 | CSV 的「送出時間」 |
| `voided_at` | 字串，可空 | **非空者為已作廢，必須排除**（D24、FR-009） |

### SubmissionAnswer（003）

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `submission_id` | 字串 | 對應作答 |
| `blank_position` | 正整數 | CSV 的「空格序」 |
| `answer_text` | 字串 | CSV 的「答案」；Guided Notes 匯出時與 `prefix` 組合 |

### Group（001）

| 欄位 | 型別 | 匯出時的用途 |
|---|---|---|
| `id` | 字串 | 內部識別 |
| `name` | 字串 | CSV 的「組別」顯示值（FR-010） |
| `position` | 整數 | 排序參考 |

## 004 的衍生模型（不落地，只在記憶體中組裝）

### 匯出目標（Export Target）——Guided Notes 匯出時逐格計算

| 欄位 | 型別 | 來源 |
|---|---|---|
| `questionNumber` | 正整數 | `questions.number` |
| `cell` | 字串 | `blanks.cell` |
| `prefix` | 字串 | `blanks.prefix` |
| `content` | 字串 \| null | **null 代表不寫入**（該題無搶答成功答案 → 保持原內容，FR-004） |

**規則**：某題若有搶答成功組別，其每個空格的 `content` 為「`prefix` + 該組對應空格的答案」；該題若無人作答，所有空格的 `content` 皆為 `null`（完全不動該題）。

**邊界**：被作廢的作答不是搶答成功答案，因此該題視為無人作答（clarify 2026-11-14、AC-004-16）。

### 結果紀錄列（Result Row）——CSV 的一列

對應 [spec Key Entities](../004-export/spec.md) 的「結果紀錄列」：

| 欄位 | 型別 | 來源 | 規則 |
|---|---|---|---|
| `questionNumber` | 正整數 | `questions.number` | |
| `blankPosition` | 正整數 | `submission_answers.blank_position` | |
| `groupName` | 字串 | `groups.name` | |
| `answer` | 字串 | `submission_answers.answer_text` | 原始答案（不含前綴） |
| `rank` | 正整數 | `submissions.rank` | |
| `isWinner` | 布林 | 該組是否為該題的搶答成功組別 | 輸出為「是／否」 |
| `receivedAt` | 字串 | `submissions.received_at` | ISO 8601 字串（含時區與毫秒），直接對應 |

**規則**：
- 一筆作答的**每個空格各一列**（FR-011）。
- 列的排序：題號 → 順位 → 空格序（FR-011）。
- **只包含有效作答**（`submissions.voided_at IS NULL`）（FR-009、clarify 2026-11-14）。
- 被作廢的作答不產生任何列（AC-004-17）。

### 匯出的學習單（GuidedNotesExport）——HTTP 回應

| 欄位 | 型別 | 規則 |
|---|---|---|
| `fileName` | 字串 | 「搶答結果_YYYYMMDD_HHmm.xlsx」或「搶答結果_YYYYMMDD_HHmm.csv」（FR-007、clarify 2026-11-14） |
| `bytes` | 位元組 | xlsx 為原檔 BLOB 修改後的位元組；csv 為含 BOM 的 UTF-8 位元組 |
| `contentType` | 字串 | xlsx 為 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`；csv 為 `text/csv; charset=utf-8` |

> 檔名中的時間是**產生當下**的時間；同一場活動重複匯出的**內容**相同（FR-008、AC-004-07），檔名因時間戳不同而可能不同——這不違反 FR-008（FR-008 約束的是內容）。

## 不變量

| 不變量 | 對應 |
|---|---|
| 匯出不改變 `guided_notes.file`（原檔 BLOB 保持不動） | FR-008 |
| 匯出不改變任何 `submissions`、`submission_answers`、`questions`、`blanks`、`groups` 資料 | FR-008、FR-016 |
| 匯出不產生新的 `state` 事件，也不遞增 `activity.revision` | 原則 VI（匯出不是作答事件） |
| 匯出檔中，除填空格外的內容與格式與原檔相同 | FR-003、SC-002 |
| 同一場活動的兩份匯出內容相同（檔名時間戳除外） | FR-008、AC-004-07 |
