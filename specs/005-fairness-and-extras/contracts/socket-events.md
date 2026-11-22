# Contract: Socket.IO 事件（005）

沿用 [001 contracts/socket-events.md](../../001-activity-session/contracts/socket-events.md) 的格式與錯誤代碼。005 新增三個指令與一種快照檢視模式；**既有事件與錯誤代碼都不改**。

## 1. 指令：`activity:fair-ranking`

老師在「準備中」設定本場是否啟用公平順位。

- 方向：client → server
- 權限：**只有老師**；其他身分回 `FORBIDDEN`
- 階段：只有 `preparing` 可呼叫；`open`／`closed` 回 `INVALID_PHASE`
- payload：`{ enabled: boolean }`
- 成功回應：`{ ok: true }`；伺服器保存 `activity.fair_ranking_enabled` 並 `activity.revision + 1`，接著廣播 `state`（所有角色都會收到新的 `fairRankingEnabled`）
- 冪等：設定成與現況相同時回 `{ ok: true }`，但**不寫入、不遞增 revision**（與既有 activity 指令一致）

```
client → server: activity:fair-ranking { enabled: true }
server → client: ack { ok: true }
server → 所有連線: state { ... fairRankingEnabled: true }
```

## 2. 指令：`reveal:next` / `reveal:all`

老師在投影看板逐題揭曉或全部揭曉結果。

- 方向：client → server
- 權限：**只有老師**；其他身分回 `FORBIDDEN`
- 階段：只有 `closed` 可呼叫；`preparing`／`open` 回 `INVALID_PHASE`
- payload：無
- 成功回應：`{ ok: true }`；伺服器更新 `activity.revealed_question_count` 並廣播 `state`
- 冪等／邊界：已全部揭曉時再呼叫 `reveal:next` 不改變資料（回 `{ ok: true }`，不遞增 revision）

```
client → server: reveal:next
server → client: ack { ok: true }
server → 所有連線: state { ... revealedQuestionCount: 1 }
```

## 3. 投影檢視模式（`view: 'projector'`）

投影看板需要一份**不含作答資訊**的快照。做法是在 Socket.IO 握手時帶入檢視模式，而不是在前端隱藏資料（原則 VI、FR-015、FR-022）。

- 握手 auth：`{ token?: string, view?: 'projector' }`
- `view: 'projector'` 時：
  - 身分仍由 token 決定；**只有老師**能取得投影快照，其他身分視為訪客（投影頁面顯示「請先以老師身分登入」）
  - 伺服器送出的 `state` 內容為 `ProjectorSnapshot`：
    ```
    {
      role: 'projector',
      revision, serverNow, phase, countdownEndsAt,
      fairRankingEnabled: boolean,
      groups: [{ id, name, online: boolean }],
      revealed: {
        revealedQuestionCount: number,
        questions: [{ questionNumber, winnerGroupName, winnerAnswers, state }],
        groupWinCounts: { groupId: count }[] | null   // 全部揭曉後才有
      }
    }
    ```
  - **不包含**：任何答案內容（除已揭曉題目的搶答成功答案）、任何組別的送出狀態、任何送出數量、任何其他組的順位
- 沒有 `view` 的連線維持既有行為（guest／student／teacher 快照）

## 4. 既有事件的變更

| 事件 | 變更 |
|---|---|
| `state`（teacher） | `fairRankingEnabled` 新增；`board[].settling` 與 `board[].fairnessApplied` 新增；`board[].cells[].rank` 在啟用公平順位時為公平順位 |
| `state`（student） | `fairRankingEnabled` 新增（FR-012：學生知道本場規則）；closed 時 `results[].fairnessApplied` 新增；`myAnswers[].rank` 在啟用公平順位時為公平順位（FR-021） |
| `state`（guest） | `fairRankingEnabled` 新增（無作答資訊） |

## 5. 錯誤代碼

沿用既有代碼，**不新增**：

| 代碼 | 意義 | 005 的適用情境 |
|---|---|---|
| `TEACHER_AUTH_REQUIRED` | 未登入或登入狀態已失效 | 投影頁未登入 |
| `FORBIDDEN` | 不是老師 | 學生呼叫 `activity:fair-ranking`／`reveal:*` |
| `INVALID_PHASE` | 階段不允許 | 非準備中改公平順位；非已結束揭曉 |

## 6. 規則

- 任何錯誤回應 MUST NOT 改變資料（原則 III）。
- 判定、順位、揭曉進度全部由伺服器決定並在送出前過濾；前端不得自行推算順位（原則 VI）。
- 廣播 log 只記事件名稱，不記答案內容或 token（原則 IV）。
