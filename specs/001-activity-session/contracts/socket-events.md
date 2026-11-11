# Contract: Socket.IO 事件（001）

## 連線

- 前端以 `io({ auth: { token } })` 連線。沒有 token 或 token 無效時，連線身分為訪客（guest）。
- 連線成功後，伺服器立刻送出一次 `state`。
- 學生的 token 對應的組別已不存在時，伺服器送出 `session:invalid`（`{ code: "GROUP_NOT_FOUND" }`），前端清除 token 並回到選組畫面。

## 伺服器 → 前端

### `state`

每次狀態改變後送給所有連線，內容依身分不同。前端以 `revision` 較大者為準。

```ts
type Phase = 'preparing' | 'open' | 'closed'

type SnapshotBase = {
  revision: number
  serverNow: string            // ISO 8601，供倒數校正
  phase: Phase
  countdownEndsAt: string | null
  groups: { id: string; name: string }[]   // 依建立順序
}

type GuestSnapshot   = SnapshotBase & { role: 'guest' }
type StudentSnapshot = SnapshotBase & { role: 'student'; myGroupId: string }
type TeacherSnapshot = SnapshotBase & { role: 'teacher'; presence: Record<string, number> } // groupId → 在線連線數
```

學生與訪客的快照 MUST NOT 含有 `presence`（原則 VI）。

## 前端 → 伺服器（指令，皆有回覆）

回覆格式：`{ ok: true } | { ok: false, error: { code: string, message: string } }`

| 事件 | 內容 | 允許的身分 | 允許的階段 | 對應 |
|---|---|---|---|---|
| `group:create` | `{ name: string }` | 老師 | preparing | FR-007、008、009；AC-001-14、15 |
| `group:rename` | `{ groupId: string, name: string }` | 老師 | preparing | FR-007、008 |
| `group:delete` | `{ groupId: string }` | 老師 | preparing | FR-007 |
| `activity:open` | `{ countdownSeconds?: number }` | 老師 | preparing（open 時冪等） | FR-015、023；AC-001-01、04、26 |
| `activity:close` | `{}` | 老師 | open（closed 時冪等） | FR-016、017；AC-001-02、05 |
| `activity:reset` | `{ confirm: true }` | 老師 | closed | FR-022；AC-001-27、29 |
| `student:leave` | `{}` | 學生 | preparing | FR-012 |

## 錯誤代碼

| 代碼 | 意義 | 給使用者的訊息（範例） |
|---|---|---|
| `FORBIDDEN` | 身分不允許這個操作（FR-006） | 只有老師可以執行這個操作 |
| `INVALID_PHASE` | 目前階段不允許（FR-010、014） | 目前階段不能執行這個操作 |
| `INVALID_INPUT` | 內容格式錯誤 | 輸入的內容格式不正確 |
| `GROUP_NAME_EMPTY` | 組名空白 | 請輸入組名 |
| `GROUP_NAME_TOO_LONG` | 組名超過 30 字元 | 組名最多 30 個字 |
| `GROUP_NAME_DUPLICATE` | 組名重複 | 已經有同名的組別 |
| `GROUP_LIMIT_REACHED` | 已有 50 組 | 最多只能建立 50 組 |
| `GROUP_NOT_FOUND` | 組別不存在 | 找不到這個組別，請重新選擇 |
| `NO_GROUPS` | 沒有組別就開啟搶答 | 請先建立至少一個組別 |
| `COUNTDOWN_OUT_OF_RANGE` | 倒數不在 10–3600 秒 | 倒數時間需介於 10 秒到 60 分鐘 |
| `CONFIRM_REQUIRED` | 重設未帶確認 | 請確認是否重設活動 |

規則：

- 任何回覆 `ok: false` 的指令 MUST NOT 改變資料，也 MUST NOT 觸發 `state` 廣播（原則 III）。
- 冪等的情況（已開啟再開啟、已結束再結束）回覆 `ok: true`，不改變資料。
- 後續子功能新增的事件與錯誤代碼，寫在各自的 contracts 中，沿用本檔的回覆格式。
