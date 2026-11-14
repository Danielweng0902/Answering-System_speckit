# Contract: Socket.IO 事件（003）

沿用 [001 Socket 事件](../../001-activity-session/contracts/socket-events.md) 的連線、ack 與錯誤處理，以及 [002 Socket 事件](../../002-guided-notes-import/contracts/socket-events.md) 的題目快照。`answer:submit` 與 `answer:void` 只在成功後定向送出 `state`；失敗一律不改資料、不廣播。

## 前端 → 伺服器（新增指令）

| 事件 | 內容 | 允許的身分 | 允許的階段 | 對應 |
|---|---|---|---|---|
| `answer:submit` | `{ questionNumber: number, answers: string[] }` | 學生（組別從 stored connection identity 取出） | open | FR-001、FR-003–FR-009、FR-018；AC-003-01–08、22–24 |
| `answer:void` | `{ groupId: string, questionNumber: number }` | 老師 | open | FR-029、FR-030；AC-003-29–31 |

回覆格式仍然只有：

```ts
type Ack =
  | { ok: true }
  | { ok: false; error: { code: ErrorCode; message: string } }
```

成功的 ack 不含 Submission id、送達時間或 rank。`questionNumber` 為正整數；zod schema 只接受上面列出的欄位。student payload 禁止 `groupId`（FR-018），多帶即 `INVALID_INPUT`。

## `answer:submit` 觸發順序

1. 指令路由以 shared zod schema 檢查 payload；格式不合回 `INVALID_INPUT`。
2. 確認連線身分為 student，取得 `identity.groupId`；不是學生回 `FORBIDDEN`。
3. 用例在同一個同步 transaction 內依序：
   - `activity.phase !== 'open'` → `INVALID_PHASE`（FR-001、FR-013）。
   - `questionNumber` 不存在 → `QUESTION_NOT_FOUND`（FR-008）。
   - `answers.length` 不等於該題空格數 → `BLANK_COUNT_MISMATCH`（FR-007、FR-008）。
   - 每個答案先 trim；出現空答案 → `ANSWER_EMPTY`，以 Unicode code point 超過 200 → `ANSWER_TOO_LONG`（FR-006）。
   - 該題該組已有 `voided_at IS NULL` 的 Submission → `ALREADY_SUBMITTED`（FR-004）。
   - 取該題所有 Submission（含已作廢）最大 `rank`，下一個是 `max + 1`；伺服器的 `now` 寫入 `receivedAt`，新增 Submission 與全部 SubmissionAnswer（FR-009–FR-012）。
   - 該組 `answerRevision +1`、全域 `answerEventCount +1`，但不修改 `activity.revision`（FR-016、SC-002）。
4. COMMIT 成功後，只對**所有 teacher 連線**與 **identity.groupId 對應的所有 student 連線**送出新的 `state`（FR-005、FR-021）。其他組學生與 guest 都不送。
5. 送出 `state` 後回 `{ ok: true }`。失敗在任何一步都 ROLLBACK，送 `ok: false`，沒有新 rank 或 counter 變化（原則 III）。

## `answer:void` 觸發順序

1. 指令路由以 shared zod schema 檢查 payload；格式不合回 `INVALID_INPUT`。
2. 確認連線身分為 teacher；其他身分回 `FORBIDDEN`。
3. 用例在同一個同步 transaction 內依序：
   - `activity.phase !== 'open'` → `INVALID_PHASE`（FR-029）。
   - `questionNumber` 不存在 → `QUESTION_NOT_FOUND`；`groupId` 不存在 → `GROUP_NOT_FOUND`。
   - 該組該題沒有 `voided_at IS NULL` 的 Submission（含完全未送出或最新已作廢） → `SUBMISSION_NOT_FOUND`（FR-029）。
   - 把該筆有效 Submission 的 `voidedAt` 設為伺服器當下時間；Submission 與 SubmissionAnswer 都保留。
   - 該組 `answerRevision +1`、全域 `answerEventCount +1`，但不修改 `activity.revision`。
4. COMMIT 成功後，只對**所有 teacher 連線**與 **該 `groupId` 的所有 student 連線**送出新的 `state`（FR-030）；其他組學生與 guest 都不送。
5. 送出 `state` 後回 `{ ok: true }`。失敗一律 ROLLBACK，結果不變。該組即可在同一 open 階段再送 `answer:submit`，新 rank 維持 `max(rank)+1`；其他組與已作廢的 rank 都不改變（AC-003-29、30）。

## 新增錯誤代碼

| 代碼 | 何時 | 給使用者的訊息（範例） |
|---|---|---|
| `QUESTION_NOT_FOUND` | 題號不存在，或伺服器已換題 | 找不到這個題號，請重新整理後再試 |
| `BLANK_COUNT_MISMATCH` | 答案筆數與該題空格數不相等 | 這一題要填滿所有空格才能送出 |
| `ANSWER_EMPTY` | 某個空格 trim 後為空 | 每個空格都要填寫答案 |
| `ANSWER_TOO_LONG` | 某個空格 trim 後超過 200 code point | 每個空格最多 200 個字 |
| `ALREADY_SUBMITTED` | 本組此題已有有效作答 | 本組已經送出這一題，不能再送出 |
| `SUBMISSION_NOT_FOUND` | 老師要作廢的組別／題目沒有有效作答，或已作廢 | 找不到可以作廢的作答，請重新整理後再試 |

沿用的錯誤：`INVALID_PHASE`（「目前階段不能執行這個操作」）、`GROUP_NOT_FOUND`（「找不到這個組別，請重新選擇」）、`FORBIDDEN`、`INVALID_INPUT`。錯誤代碼與訊息加入 shared `ERROR_CODES`、`ERROR_MESSAGES`；前端直接使用伺服器回覆的中文。

## 快照（延伸 001、002 的 `state`）

以下 `StudentSnapshot` 是依 `phase` 區分的 union；所有列表依題目 position、組別 position、blank position 的既有順序排列。

```ts
type StudentQuestion = {
  number: number
  kind: QuestionKind
  prompt: string
  blanks: { position: number; prefix: string }[]
}

type AnswerState = 'not_submitted' | 'submitted' | 'voided'

type StudentOpenAnswer = {
  questionNumber: number
  state: AnswerState
  answers: string[]
  // open 一律沒有 rank；not_submitted 時 answers 為 []；submitted/voided 時為最新提交的答案
}

type StudentClosedAnswer = {
  questionNumber: number
  state: AnswerState
  answers: string[]
  rank: number | null // 只在有本組有效作答時為其 rank；not_submitted / voided 為 null
}

type StudentPreparingSnapshot = SnapshotBase & {
  role: 'student'
  phase: 'preparing'
  myGroupId: string
  sessionId: string
}

type StudentOpenSnapshot = SnapshotBase & {
  role: 'student'
  phase: 'open'
  myGroupId: string
  sessionId: string
  questions: StudentQuestion[]
  myAnswers: StudentOpenAnswer[] // 每題固定一筆，絕不含 rank
}

type StudentClosedSnapshot = SnapshotBase & {
  role: 'student'
  phase: 'closed'
  myGroupId: string
  sessionId: string
  questions: StudentQuestion[]
  results: QuestionResult[] // 每題固定一筆
  myAnswers: StudentClosedAnswer[] // 每題固定一筆
}

type StudentSnapshot =
  | StudentPreparingSnapshot
  | StudentOpenSnapshot
  | StudentClosedSnapshot
```

| 身分與階段 | 新增欄位與限制 | 對應 |
|---|---|---|
| student、preparing | 只有 `sessionId`；沒有 `questions`、`myAnswers` 或 `results` | FR-002、002 FR-016、FR-027 |
| student、open | `questions`、`myAnswers`；只包含本組答案與狀態，沒有順位、其他組、winner 或 progress | FR-002、FR-005、FR-015–FR-018 |
| student、closed | `questions`、`results`、含順位的 `myAnswers` | FR-022–FR-025 |
| guest（任何階段） | 沒有新增欄位；沒有 `sessionId`、`questions`、`myAnswers`、`results`、`board`、`progress` | FR-016 |
| teacher | `board` 與 `progress` 在任何階段都存在，未作答時為尚未送出 | FR-019–FR-022、FR-029 |

### `results`、老師看板與進度

```ts
type QuestionResult = {
  questionNumber: number
  winner: {
    groupId: string
    groupName: string
    answers: string[]
  } | null // null 代表無有效作答；前端顯示「無人作答」
}

type AnswerBoardCell = {
  questionNumber: number
  groupId: string
  groupName: string
  state: AnswerState
  answers: string[]
  rank: number | null
  // voided 時保留最新被作廢的答案與 rank；not_submitted 為 null、[]
}

type AnswerBoardQuestion = {
  questionNumber: number
  cells: AnswerBoardCell[] // 每題每組固定一筆
  winnerGroupId: string | null // decideWinner() 的結果；open/closed 均可供老師標示
}

type AnswerProgress = {
  perQuestion: { questionNumber: number; submittedGroupCount: number }[]
  perGroup: { groupId: string; submittedQuestionCount: number }[]
}

type TeacherSnapshot = /* 001 presence ＋ 002 questions/guidedNotes 欄位 */ & {
  board: AnswerBoardQuestion[]
  progress: AnswerProgress
}
```

當某組曾作廢又重送，`AnswerBoardCell` 顯示**最新有效** Submission；若沒有重送則顯示最新作廢的 Submission（`state: 'voided'`）。進度只計算 `voided_at IS NULL` 的作答（FR-020、FR-029）。`results` 以 `decideWinner()` 決定，只有 closed 的學生快照才會有結果。

## revision 與誰收到 `state`

```ts
// 伺服器在產生快照時代入；前端只比對revision，不讀取 counter 原始值。
const snapshotRevision =
  identity.role === 'teacher'
    ? activity.revision + answerEventCount
    : identity.role === 'student'
      ? activity.revision + answerRevisionFor(identity.groupId)
      : activity.revision
```

`activity.revision` 的既有變更方式不變；counter 在 SQLite 保存，reset 不歸零。`answer:submit`、`answer:void` 成功各算一次事件，不重複計算同一次 transaction 內的每個空格。

| 事件 | 會收到 `state` | 不會收到 `state` | revision 依據 | 對應 |
|---|---|---|---|---|
| `answer:submit` 成功（第 G 組） | 所有 teacher、G 組所有 student 連線 | 其他組所有 student、全部 guest | teacher 的 `answerEventCount` +1；G 組的 `answerRevision` +1 | FR-005、FR-016、FR-021、SC-002 |
| `answer:void` 成功（第 G 組） | 所有 teacher、G 組所有 student 連線 | 其他組所有 student、全部 guest | 同上 | FR-029、FR-030、SC-002 |
| 任一指令驗證或用例失敗 | 無 | 全部連線 | 不改變 | 原則 III、FR-001、FR-004、FR-029 |
| 001/002 的 group、activity、student:leave、questions:confirm 成功 | 依原合約向所有連線送 role-filtered `state` | 無 | 改變 `activity.revision`；計數不因此增加 | 對應 001、002 合約 |
| `activity:close` / 倒數到期 | 所有連線 | 無 | `activity.revision` +1；老師與各組快照 revision 隨之增加 | FR-013、FR-022–FR-025、SC-005 |

學生前端拿到 `sessionId` 後只把它用於本機草稿 key，不把草稿傳到伺服器；`questions:confirm` 或 reset 改變 `sessionId` 時即清除舊活動草稿（FR-027）。
