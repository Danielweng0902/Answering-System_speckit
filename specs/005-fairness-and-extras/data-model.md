# Data Model: 公平順位與投影看板（005）

**Branch**: `005-fairness-and-extras`｜**日期**：2026-11-17

沿用 001／002／003／004 的資料模型；本文件只描述 005 **新增或改變**的部分。判定本身**不保存**（[research.md](./research.md) R1）。

## 1. Activity（001）——新增兩個欄位

| 欄位 | 型別 | 預設 | 用途 |
|---|---|---|---|
| `fair_ranking_enabled` | INTEGER（0／1） | `0` | 本場是否啟用公平順位（FR-001）。只有「準備中」可改；重設活動回到 `0` |
| `revealed_question_count` | INTEGER | `0` | 投影看板已揭曉到第幾題（依題號順序，FR-017）。重設活動回到 `0`（FR-023） |

- 兩個欄位都用 `migrateActivityColumns()` 的既有 idempotent 方式加入（既有資料庫自動補上，預設值如上）。
- `fair_ranking_enabled` 改動時 `activity.revision + 1` 並廣播，與既有 activity 指令一致。
- `revealed_question_count` 的上限是本場題數；「全部揭曉」直接設成題數。

## 2. Submissions（003）——**不變更**

| 欄位 | 005 的用途 |
|---|---|
| `received_at` | 判定批次（第一個答案 + 3000ms）與送達先後的唯一依據（FR-009） |
| `rank` | **維持送達序號語意**，只作同批／跨批的送達先後比較；對外顯示的順位由判定結果提供（research R4、FR-021） |
| `voided_at` | 非空者不參與判定；作廢後衍生計算自然排除該筆並連鎖重算（FR-020、D25） |

不新增欄位、不新增索引、不改變唯一索引 `submissions_one_valid_per_group_question`。

## 3. 判定結果（**衍生，不保存**）

對應 [spec Key Entities](../005-fairness-and-extras/spec.md) 的「題目判定」。由 `settleAll()` 每次即時推導，**不寫入資料庫**。

| 欄位 | 型別 | 規則 |
|---|---|---|
| `questionNumber` | 正整數 | 題目 |
| `winnerGroupId` | 字串，可空 | 該題的搶答成功組別；無人作答為 `null`（與 003 `decideWinner` 語意一致） |
| `ranks` | `{ groupId, rank }[]` | 該題各組的**顯示順位**，由第 1 順位起連續編號 |
| `settling` | 布林 | 是否仍在判定中（`now < 第一個答案送達時間 + 3000ms`；FR-010） |
| `fairnessApplied` | 布林 | 本場啟用公平順位，且該題的勝者**不是**最先送達者 → 需標示「改判」（FR-011、CSV 第 8 欄 `是（改判）`） |

### 判定規則（與 FR-003～FR-008 對應）

1. 取該題所有**未作廢**作答，依送達序號排序。
2. 第一個作答的送達時間 + 3000ms（含邊界）之內的作答為「同一批」；其餘為批次外。
3. 批內依「**已判定題目的搶答成功題數**由少到多」排序，相同則依送達先後；批次外依送達先後排在批內之後。
4. 題目依**第一個作答的送達時間**先後依序判定；判定時只用前面題目已累積的成功題數（FR-006）。
5. 第 1 位即為該題的搶答成功組別，其成功題數 +1。
6. 未啟用公平順位時，第 3 步不套用成功題數比較，結果與 003 的先到先得完全相同（FR-002、SC-002）。

### 不變量

- 同一場活動內，任何時刻的判定結果只由 `submissions` 的既有欄位決定 → 重算必得同樣結果（FR-009、SC-003）。
- 作廢只會讓判定結果**重新推導**，不會留下「舊判定」；D25 的連鎖重算是同一條規則的結果，不是例外流程（FR-020）。
- 啟用與否存在 `activity`，所以同一份作答資料在兩種設定下會得到不同判定——這是設計要的（FR-002）。

## 4. 揭曉進度（存於 `activity.revealed_question_count`）

| 欄位 | 型別 | 規則 |
|---|---|---|
| `revealed_question_count` | INTEGER | 已揭曉的題數；題目依**題號順序**排列，第 N 個揭曉的是第 N 小的題號（含無人作答的題目，揭曉時顯示無人作答） |

- 「揭曉下一題」= `count + 1`（不超過題數）；「全部揭曉」= 題數。
- 只有「已結束」階段可揭曉（FR-017）；未登入／非老師不可（FR-022）。
- 揭曉進度**只影響投影看板**，不影響學生端在結束時即可看到完整結果（FR-023、C8）。
- 重設活動時歸零（FR-023）。

## 5. 通訊協定（`shared/src/protocol.ts`）——新增／變更

| 型別 | 變更 |
|---|---|
| `SnapshotBase` | **新增** `fairRankingEnabled: boolean`（所有角色都知道本場規則；FR-012 學生端「知道使用公平順位」） |
| `AnswerBoardQuestion` | **新增** `settling: boolean`、`fairnessApplied: boolean`（FR-010、FR-011） |
| `QuestionResult` | **新增** `fairnessApplied: boolean`（學生結果畫面標示改判題目；FR-011） |
| `ProjectorSnapshot` | **新增**：`role: 'projector'`、階段、倒數、各組在線狀態、`fairRankingEnabled`、已揭曉的結果與各組成功題數；**不含**任何答案或送出狀態（FR-015、FR-022） |
| `AnswerBoardCell.rank` | 語意擴充：啟用公平順位時為公平順位（FR-021）；未啟用時與送達序號相同 |
| `StudentClosedAnswer.rank` | 同上（FR-021） |

## 6. 事件與指令

| 名稱 | 方向 | 用途 |
|---|---|---|
| `activity:fair-ranking` | client → server | 老師在「準備中」設定 `{ enabled: boolean }` |
| `reveal:next` | client → server | 老師揭曉下一題（依題號順序） |
| `reveal:all` | client → server | 老師全部揭曉 |
| `state` | server → client | 既有快照事件；投影連線收到的是 `ProjectorSnapshot`（R6） |

錯誤代碼沿用既有：`UNAUTHORIZED`（未登入）、`FORBIDDEN`（非老師）、`INVALID_PHASE`（非準備中／非已結束）。**不新增錯誤代碼**。
