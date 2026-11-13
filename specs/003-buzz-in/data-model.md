# Data Model: 搶答作答與結果

沿用 001 的 Activity、Group、Session（見 [001 contracts](../001-activity-session/contracts/socket-events.md)）與 002 的 GuidedNotes、Question、Blank（見 [002 data-model](../002-guided-notes-import/data-model.md)）。本子功能新增作答與 revision 計數，不新增題目或組別。

## 實體

### Submission（作答）

一個組別對一題的一次送出。老師作廢後原紀錄保留；同組重新送出是新的一筆 Submission。

| 欄位 | 型別 | 說明 | 對應 |
|---|---|---|---|
| `id` | 字串（隨機） | 主鍵 | FR-026 |
| `questionId` | 字串 | 對應 002 Question 的 `id` | FR-008 |
| `groupId` | 字串 | 對應 001 Group 的 `id`；由連線身分決定 | FR-003、FR-018 |
| `rank` | 正整數 | 該題送達順序；給出後不改變，作廢也不遞補 | FR-009–FR-012 |
| `receivedAt` | 時間（ISO 8601） | 伺服器接受指令時記錄的送達時間 | FR-009、FR-026 |
| `voidedAt` | 時間（ISO 8601），可空 | 老師作廢時間；非 null 表示這筆已作廢 | FR-029、FR-030 |

規則：

- 每題的 `rank` 從 1 開始遞增，同一題不得重複；以該題所有 Submission（含已作廢）的最大 `rank` + 1 產生（FR-009、FR-011）。
- 每題每組同一時間最多一筆 `voidedAt IS NULL` 的 Submission（FR-004、SC-007）。
- 被作廢的 Submission 不計入搶答成功、進度或結果，但不得刪除（FR-029）。
- 被作廢後重新送出使用新的 Submission 與新的 `rank`；其他組既有的 `rank` 不改變（FR-029、AC-003-30）。
- `receivedAt` 只用來保存與呈現送達時間；先後順序一律以 `rank` 判斷（FR-009、FR-014）。

### SubmissionAnswer（空格答案）

一筆 Submission 對某個空格的答案。每筆 Submission 必須有該題所有空白各一筆。

| 欄位 | 型別 | 說明 | 對應 |
|---|---|---|---|
| `submissionId` | 字串 | 所屬 Submission | FR-007、FR-026 |
| `blankPosition` | 正整數 | 對應 002 Blank 的 `position` | FR-007、FR-008 |
| `answerText` | 字串 | 去除前後空白後保存的答案 | FR-006 |

規則：

- 每筆 Submission 的 `blankPosition` 不得重複，筆數必須等於所屬題目的 Blank 數（FR-007、FR-008）。
- `answerText` trim 後以 Unicode code point 計 1–200；不進行正確性判斷（FR-006、D23）。
- 老師作廢 Submission 時，SubmissionAnswer 跟著保留；前端顯示時依 Submission 的 `voidedAt` 判定已作廢（FR-029、FR-030）。

### GroupAnswerRevision（每組作答版本）

每一組一筆，重設活動不歸零。

| 欄位 | 型別 | 說明 | 對應 |
|---|---|---|---|
| `groupId` | 字串 | 對應 001 Group 的 `id` | FR-015、FR-016 |
| `answerRevision` | 非負整數 | 該組每次自己的 Submission 成功建立或最新 Submission 被作廢時 +1 | FR-016、SC-002、FR-021（老師即時） |

規則：

- 學生快照 `revision = activity.revision + 本組 answerRevision`；其他組的事件不得改變它的值（FR-016、SC-002）。
- 老師作廢與學生重新送出是不同事件，各 +1，讓該組都能看到畫面更新（FR-005、FR-030）。
- Activity reset 清空 Submission 但此欄位保留，避免同一學生連線看到比舊快照小的 revision（FR-028、SC-002）。

### Activity 延伸（作答事件數與活動識別）

001 的 Activity 單列增加兩個欄位。

| 欄位 | 型別 | 說明 | 對應 |
|---|---|---|---|
| `sessionId` | 字串（隨機） | 本次活動的草稿識別；reset 或 questions:confirm 時換新 | FR-027、AC-003-32 |
| `answerEventCount` | 非負整數 | 每次任何 Submission 成功建立或被作廢時 +1；reset 不歸零 | FR-019–FR-021、SC-002 |

規則：

- 老師快照 `revision = activity.revision + answerEventCount`；所有老師連線對每個作答事件都能看到更新（FR-021）。
- guest 快照 `revision = activity.revision`；作答事件不送給 guest，也不改變它的 revision（FR-016）。
- `sessionId` 只在學生快照提供；reset 與換題時更換，前端據此清掉舊草稿（FR-027）。
- `answerEventCount` 不放入快照；它只參與老師 revision 計算（FR-016、SC-002）。

## 關係

| 關係 | 說明 | 對應 |
|---|---|---|
| 001 Group 1—* Submission | 每組可以有多題作答，也可以有多次被作廢後的歷史作答；送出時由 session 的 group 決定 | FR-003、FR-018 |
| 002 Question 1—* Submission | 一題可被多組送出，順位按每題獨立 | FR-010–FR-012 |
| Submission 1—* SubmissionAnswer | 一整題的所有空格共同保存 | FR-007 |
| Group 1—1 GroupAnswerRevision | 每組一個持久 revision counter，供自己的學生快照使用 | FR-016、SC-002 |
| Activity 1—1 sessionId / answerEventCount | 單一活動一列；sessionId 識別當次活動，answerEventCount 供老師快照 revision 使用 | FR-019–FR-021、FR-027 |
| 002 Blank ↔ SubmissionAnswer | 以 `questionId + position` 對應；題目被保存的歷史版本不存在，除非先 reset 清空作答 | FR-007、FR-008、FR-028 |

## 約束與索引

```text
UNIQUE (group_answer_revisions.group_id)
UNIQUE (submissions.question_id, submissions.rank)
UNIQUE (submissions.question_id, submissions.group_id) WHERE voided_at IS NULL
PRIMARY KEY (submission_answers.submission_id, submission_answers.blank_position)
INDEX (submissions.group_id, voided_at)
INDEX (submission_answers.submission_id)
```

| 規則 | 理由 | 對應 |
|---|---|---|
| `(question_id, rank)` 唯一 | 防止任何路徑產生兩個相同順位 | FR-011、SC-001 |
| `(question_id, group_id)` 的 partial unique index | 每組每題最多一筆有效作答；已作廢的歷史可同時存在 | FR-004、FR-029 |
| SubmissionAnswer 複合主鍵 | 同一作答的同一空格只能保存一筆 | FR-007 |
| `(submissions.group_id, voided_at)` 索引 | 學生自己的 myAnswers 與老師 progress 每組欄位快速查詢 | FR-005、FR-020 |
| Question / Group / Submission 外鍵 | 保持資料引用完整；Question 取代前先經過 reset 清空作答 | FR-008、FR-028 |

## 狀態與轉換

| 情況 | 結果 | 對應 |
|---|---|---|
| open，學生送出有效答案，該組該題沒有有效作答 | 在同一 transaction 新增 Submission 與所有 SubmissionAnswer；`rank = max(rank)+1`；該組 `answerRevision +1`；`answerEventCount +1` | FR-001、FR-004、FR-007、FR-009、FR-011 |
| open，學生送出的答案內容不合格 | 拒絕，不產生作答、rank 或 counter 變化 | FR-006–FR-008 |
| open，學生重複送出同題 | `ALREADY_SUBMITTED`；原 Submission、rank 與 counter 不變 | FR-004、SC-007 |
| open，老師作廢某一有效作答 | 在同一 transaction 設定 `voidedAt`；該組 `answerRevision +1`；`answerEventCount +1` | FR-029、FR-030 |
| open，老師作廢不存在或已作廢的作答 | `SUBMISSION_NOT_FOUND`；資料與 counter 不變 | FR-029 |
| open，老師作廢後同組重新送出 | 新增一筆 Submission；rank 排在該題現有最大值之後；其他 rank 不變 | FR-029、AC-003-30 |
| preparing / closed，`answer:submit` 或 `answer:void` | `INVALID_PHASE`；資料與 counter 不變 | FR-001、FR-013、FR-029 |
| closed，老師或學生檢視結果 | 依未作廢 Submission 中每題最小 rank 產生 winner；無有效作答則為無人作答 | FR-010、FR-022–FR-025 |
| teacher reset activity | 刪除所有 Submission 與 SubmissionAnswer；`sessionId` 換新；counter 不歸零 | FR-027、FR-028 |
| teacher questions:confirm | 取代 002 題目；`sessionId` 換新；正常流程下此時已沒有作答 | FR-027、R8 |
| server restart | Submission、rank、counter、`sessionId` 全部從 SQLite 讀回；內容不重建、不重排 | FR-026、SC-006 |

## 快照（延伸 001、002）

| 身分 | 新增欄位 | 對應 |
|---|---|---|
| 學生，open | `sessionId`；`questions`（題號、敘述、空格 prefix）；`myAnswers`（每題一筆，本組狀態與答案，不含 rank） | FR-002、FR-005、FR-015–FR-017、FR-027 |
| 學生，closed | `sessionId`；`questions`；`myAnswers` 每題含 rank；`results`（每題成功組別、答案或無人作答） | FR-022–FR-025、FR-027 |
| 老師 | `board`（每題每組狀態、答案、rank、是否作廢）；`progress`（每題有效送出組數、每組有效送出題數） | FR-019–FR-022、FR-029 |
| guest | 無作答欄位，也沒有 `sessionId` | FR-016 |

精確 TypeScript 型別與誰會收到 `state`，見 [contracts/socket-events.md](./contracts/socket-events.md)。

## SQLite 資料表

新資料庫與既有資料庫都以 migration 形式到達同一結構；既有 Activity 列補 `session_id` 與 `answer_event_count`，補不上時用隨機值初始化。

```text
ALTER TABLE activity ADD COLUMN session_id TEXT;
ALTER TABLE activity ADD COLUMN answer_event_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE group_answer_revisions (
  group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  answer_revision INTEGER NOT NULL DEFAULT 0 CHECK (answer_revision >= 0)
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  received_at TEXT NOT NULL,
  voided_at TEXT
);

CREATE UNIQUE INDEX submissions_question_rank_unique
  ON submissions(question_id, rank);

CREATE UNIQUE INDEX submissions_one_valid_per_group_question
  ON submissions(question_id, group_id)
  WHERE voided_at IS NULL;

CREATE INDEX submissions_by_group_valid
  ON submissions(group_id, voided_at);

CREATE TABLE submission_answers (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  blank_position INTEGER NOT NULL CHECK (blank_position > 0),
  answer_text TEXT NOT NULL,
  PRIMARY KEY (submission_id, blank_position)
);

CREATE INDEX submission_answers_by_submission
  ON submission_answers(submission_id);
```
