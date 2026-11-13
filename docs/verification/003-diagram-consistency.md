# 003 圖與程式一致性檢查（T048）

- **日期**：2026-11-14｜**分支**：`003-buzz-in`（HEAD `ee6326e`）
- **檢查者**：GLM-5.3-max（direct 執行）
- **方法**：依 `specs/003-buzz-in/plan.md`「圖表與模組對應」逐列核對 `diagrams/003-buzz-in-*.puml` 的元件、型別與關係在程式中存在且一致；再核對兩張時序圖的訊息順序與 contracts 的觸發順序。
- **render 狀態**：四個 `.puml` 內容與程式一致，**無需修改**；對應 PNG 已於 `ee6326e` 以 `scripts/render-diagrams.sh` 重新產生（PNG mtime 晚於 `.puml`），本次 `npm run check` 內含的 `scripts/check-diagrams.sh` 輸出 `PASS 圖表檢查通過`（exit 0，見 `003-automated.md`）。

## 組件圖（`003-buzz-in-component.puml`）逐列核對

| 圖中元件 | plan.md 對應模組 | 程式核對結果 |
|---|---|---|
| 作答受理（Submission Intake） | `answer:submit`、`server/src/app/answerCommands.ts`、`server/src/infra/db/answerRepo.ts` | 一致：`answerCommands.ts` `submitAnswer`（130–147 行）註冊於 `index.ts` 185–195 行（student）；寫入用 `answerRepo.insertSubmission` |
| 作廢受理（Void Intake） | `answer:void`、`answerCommands.ts` | 一致：`voidAnswer`（148–165 行）註冊於 `index.ts` 198–208 行（teacher） |
| 順位判定（Ranking） | transaction 內 `max(rank)+1`、`decideWinner()` | 一致（概念層）：rank 配號=`answerRepo.maxRank`（171–179 行，含作廢）由 `answerCommands` 在 transaction 內呼叫；搶答成功=`answerRanks.decideWinner`（12–27 行）。備忘見下方「文件備忘」 |
| 可見範圍過濾（Visibility Filter） | `server/src/app/snapshot.ts` | 一致：依身分與階段產生三種快照（50–107 行），revision 計算 32–37 行 |
| 作答狀況彙整（Board Builder） | `answerProjections.ts` 的 `board` 與 `progress` | 一致：`buildBoard`（143–180 行）、`buildProgress`（186–210 行），winner 只用 `decideWinner` |
| 結果彙整（Result Builder） | `answerProjections.ts` 與 `decideWinner()` | 一致：`buildResults`（67–85 行） |
| 狀態同步（001）＋作答定向送出 | `broadcaster.ts`；`broadcastSubmissionChanged(groupId)` | 一致：91–106 行只送 teacher 與該組；`commandRouter.ts` 27–41、133–139 行支援自訂廣播範圍 |
| 活動階段管理（001） | `activityCommands.ts`；reset 清空作答並更新 sessionId | 一致：reset 的 `persist` 內 `clearAllAnswers`＋`newSessionId`（160–165 行） |
| 題目庫（002） | `questionBank.ts`、`questionRepo.ts` | 一致：`answerCommands` 以 `questionRepo.list` 檢查題號與空格數（62–70 行） |
| 老師端畫面 | `AnswerBoard.tsx`、`TeacherPage.tsx` | 一致：看板、進度、作廢二次確認都在 `AnswerBoard.tsx`（95–247 行） |
| 學生端畫面 | `AnswerArea.tsx`、`StudentResults.tsx`、`StudentPage.tsx` | 一致：`StudentPage.tsx` 101–102 行依 phase 掛載 |

圖上註記（作答事件不改 `activity.revision`、不送 state 給其他組與 guest、結束時送結果）與 `contracts/socket-events.md`「revision 與誰收到 state」表一致。

## 類別圖（`003-buzz-in-class.puml`）逐列核對

| 圖中類別 | plan.md 對應型別 | 程式核對結果 |
|---|---|---|
| 作答 | `SubmissionRecord`（id、groupId、questionId、rank、receivedAt、voidedAt） | 一致：`answerRepo.ts` 3–12 行（另含 questionNumber 與 answers，圖為領域檢視未列出，不矛盾） |
| 空格答案 | `SubmissionAnswerRecord`（blankPosition、answerText） | 一致（概念層）：對應 `submission_answers` 資料表（`database.ts` 79–87 行，欄位 `blank_position`、`answer_text`）；程式中由 `answerRepo.readAnswers`（25–48 行）讀入 `SubmissionRecord.answers`，沒有名為 `SubmissionAnswerRecord` 的 TS 型別——圖未使用該名稱，不構成矛盾 |
| 作答簿 | `answerRepo` 的 find／insert／void／clear | 一致：`insertSubmission`／`findValid`／`findLatest`／`voidSubmission`／`maxRank`／`listByQuestion`／`listValidByGroup`／`clearAll`；受理／作廢的 transaction 包裝在 `answerCommands` |
| 受理 | `answerValidation.ts` 純函式＋`answerCommands` transaction | 一致 |
| 順位規則／先到先得規則 | `decideWinner(submissions)` | 一致（概念層）：目前是單一純函式而非 interface＋實作；圖的 note「005 的公平機制是另一個實作」與 plan「005 可以更換此純函式」相符 |
| 順位 | `rank: number`；作廢後保留但不參加搶答成功 | 一致：唯一索引 `UNIQUE(question_id, rank)`、`decideWinner` 跳過 `voidedAt !== null` |
| 作答狀況 | `AnswerBoard`、`AnswerBoardCell`、`AnswerProgress` | 一致：`shared/src/protocol.ts` 130–149 行 |
| 搶答結果 | `QuestionResult` | 一致：`protocol.ts` 121–128 行 |
| 學生檢視 | open／closed 學生答案型別 | 一致：`StudentOpenAnswer`（106–111 行，無 rank）、`StudentClosedAnswer`（113–119 行，含 rank） |
| 作答版本計數 | `group_answer_revisions`、`activity.answer_event_count` | 一致：`database.ts` 55–58、12–13 行；upsert 於 `answerRepo.ts` 71–83 行 |
| 圖上 note（transaction 五步、revision 公式） | — | 與 `contracts` 觸發順序及 `snapshot.ts` 32–37 行一致 |

## 時序圖核對

- **`003-buzz-in-seq-submit.puml`**（送出、順位、作廢與定向送出）：訊息順序＝zod＋身分 → 同步 transaction（open、題號、空格數、答案、無有效作答）→ rank 配號與兩個 counter → COMMIT 後定向送 state → ack，與 contracts「`answer:submit` 觸發順序」一致；作廢段（確認→`answer:void`→標記 `voidedAt`→定向送→重送得 `max+1`）與「`answer:void` 觸發順序」及 e2e「US3 作廢」流程一致；「第二組與 guest 都沒有收到 state」與 `broadcastSubmissionChanged` 實作一致。
- **`003-buzz-in-seq-results.puml`**（結束與結果）：`activity:close` → 全域 state（`activity.revision +1`）→ closed 學生快照含 results 與本組 rank → closed 後 submit／void 回 `INVALID_PHASE` 且不送 state，與 contracts 及 `snapshot.ts` closed 分支一致。

## 文件備忘（不需改圖）

- `plan.md` 組件圖對應表把「transaction 內的 `max(rank) + 1`」列在 `server/src/domain/answerRanks.ts` 項下；實作上 `maxRank()` 位於 `server/src/infra/db/answerRepo.ts`（171–179 行），由 `answerCommands` 在 transaction 內呼叫，`answerRanks.ts` 只有 `decideWinner()`。`.puml` 本身使用概念元件名「順位判定（Ranking）」未指名檔案，與程式不矛盾，故不修改圖；此差異記錄於此供 005 替換判定規則時參考。
- 時序圖中「順位判定」參與者在送出流程內重算最小 rank，實作上 winner 是快照投影（`buildBoard`／`buildResults`）呼叫 `decideWinner` 即時計算，不是送出 transaction 的一部分；圖為概念層表述（組件圖同），內容與行為結果一致。

## 結論

四張圖與程式一致，無需修改 `.puml`，無需重 render；`scripts/check-diagrams.sh` PASS。005 實作公平順位與投影看板時，需回頭同步這四張圖（特別是「順位規則」的實作類別與投影看板新畫面）。
