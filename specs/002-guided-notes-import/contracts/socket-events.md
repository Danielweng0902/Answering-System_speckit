# Contract: Socket.IO 事件（002）

沿用 [001 Socket 事件](../../001-activity-session/contracts/socket-events.md) 的指令回覆格式與廣播規則。

## 前端 → 伺服器（新增指令）

| 事件 | 內容 | 允許的身分 | 允許的階段 | 對應 |
|---|---|---|---|---|
| `questions:confirm` | `{ importId: string }` | 老師 | preparing | FR-014、015；AC-002-02、05 |

成功時以 `importId` 對應的讀取結果取代活動的題目，`revision` +1，向所有連線廣播 `state`。取消不需要送指令（AC-002-03）。

## 新增錯誤代碼

| 代碼 | 意義 | 給使用者的訊息（範例） |
|---|---|---|
| `IMPORT_EXPIRED` | `importId` 不存在、已失效或已被較新的讀取取代 | 匯入摘要已失效，請重新讀取學習單 |
| `QUESTIONS_REQUIRED` | 沒有題目時開啟搶答（修改 001 `activity:open`） | 請先匯入題目 |

`activity:open` 的檢查順序變為：`NO_GROUPS` → `QUESTIONS_REQUIRED` → `COUNTDOWN_OUT_OF_RANGE`。

## 快照（延伸 001 的 `state`）

```ts
type QuestionSummary = { number: number; kind: 'single' | 'group'; prompt: string; blankCount: number }

type TeacherSnapshot = /* 001 欄位 */ & {
  questions: QuestionSummary[]          // 依原檔順序；沒有題目時為 []
  guidedNotes: { sheetName: string; sourceKind: 'link' | 'file'; fileName: string | null; importedAt: string } | null
}
```

學生與訪客的快照 MUST NOT 含 `questions`、`guidedNotes`（FR-016、原則 VI）。搶答中學生看到的題目由 003 的 contracts 定義。
