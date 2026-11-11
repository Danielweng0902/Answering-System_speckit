# Data Model: 活動與組別進場

## 實體

### Activity（活動）

系統中只有一筆（`id = 1`）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `phase` | `'preparing' \| 'open' \| 'closed'` | 準備中／搶答中／已結束 |
| `openedAt` | 時間，可空 | 進入搶答中的時間 |
| `countdownEndsAt` | 時間，可空 | 有設定倒數時的結束時間 |
| `closedAt` | 時間，可空 | 進入已結束的時間 |
| `revision` | 整數 | 每次狀態改變加 1，供前端判斷快照新舊 |

規則：

- `phase` 只能 `preparing → open → closed`（FR-014）。
- `open` 需要至少一個組別（FR-015）；002 完成後另需要至少一題。
- `close` 只在 `open` 時生效；其他階段呼叫不改變任何東西（FR-017、FR-026）。
- `reset` 只在 `closed` 時允許，回到 `preparing`，清空時間欄位，保留組別（FR-022）。
- 倒數秒數為 10 到 3600（FR-023）。

### Group（組別）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | 字串（隨機） | 不隨改名改變 |
| `name` | 字串 | 去除前後空白後 1–30 字元，同一活動內不重複（FR-008） |
| `position` | 整數 | 建立順序，用於顯示排序 |

規則：

- 只有 `phase = preparing` 可以新增、改名、刪除（FR-007、FR-010）。
- 最多 50 組（FR-009）。
- 重複的判斷：去除前後空白後完全相同即為重複。

### Session（參與者身分）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `tokenHash` | 字串 | 身分憑據的雜湊值；原值只存在使用者的分頁 |
| `role` | `'teacher' \| 'student'` | 身分種類 |
| `groupId` | 字串，可空 | 學生所屬組別；老師為空 |
| `createdAt` | 時間 | |

規則：

- 學生的 Session 指向的組別被刪除時，該 Session 失效（edge case：回到選組畫面）。
- 學生只能在 `preparing` 時離開組別並重新選擇（FR-012）。
- 重設活動時，老師與學生的 Session 都保留（組別保留）。

### Presence（在線狀態，不保存）

記憶體中的對照：`groupId → 目前連線數`。伺服器重啟後由重新連線自然恢復。用於老師端顯示各組是否在線（FR-028）。

## 狀態轉換

```text
            open(countdown?)            close() 或 倒數歸零
preparing ───────────────────▶ open ───────────────────────▶ closed
    ▲                                                           │
    └───────────────────────── reset(confirm) ◀─────────────────┘
```

| 目前階段 | 指令 | 條件 | 結果 |
|---|---|---|---|
| preparing | open | 老師；至少一組；倒數在範圍內 | → open |
| preparing | open | 沒有組別 | 拒絕 `NO_GROUPS` |
| open | close | 老師，或倒數歸零 | → closed |
| closed | close | — | 不變，回覆成功（冪等） |
| open | open | — | 不變，回覆成功（冪等） |
| closed | reset | 老師；`confirm = true` | → preparing |
| preparing、open | reset | — | 拒絕 `INVALID_PHASE` |
| open、closed | group:* | — | 拒絕 `INVALID_PHASE` |

## 快照（Snapshot）

伺服器依連線的身分產生。完整格式見 [contracts/socket-events.md](./contracts/socket-events.md)。

| 身分 | 看得到 |
|---|---|
| 訪客（尚未選組） | 階段、組別清單（id、名稱） |
| 學生 | 階段、倒數、自己的組別、組別清單 |
| 老師 | 階段、倒數、組別清單、各組在線人數 |

後續子功能在同一份快照上各自增加欄位，並各自負責過濾（例如 003 的作答資料）。

## SQLite 資料表

```text
activity(id INTEGER PRIMARY KEY CHECK (id = 1), phase TEXT, opened_at TEXT, countdown_ends_at TEXT, closed_at TEXT, revision INTEGER)
groups(id TEXT PRIMARY KEY, name TEXT UNIQUE, position INTEGER)
sessions(token_hash TEXT PRIMARY KEY, role TEXT, group_id TEXT NULL REFERENCES groups(id) ON DELETE CASCADE, created_at TEXT)
```

時間一律以 ISO 8601（UTC）字串保存。
