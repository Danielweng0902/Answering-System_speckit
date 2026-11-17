# 005 公平順位與投影看板：圖與程式一致性檢查（T028／T032）

日期：2026-11-17。依 `specs/005-fairness-and-extras/plan.md`「圖表與模組對應」逐列核對 `diagrams/005-fairness-and-extras-*.puml` 的元件與型別在程式中存在、名稱與關係一致；本輪**修改了 4 張 `.puml` 並重出 PNG**，`scripts/check-diagrams.sh` 通過。

## 逐列核對

| 圖中元件／類別／訊息 | 實際模組與型別 | 判定 |
|---|---|---|
| 順位規則（`RankingRule`） | `server/src/domain/answerRanks.ts` 的 `RankingRule`、`arrivalRule`、`fairnessRule` | 一致（003 的 `decideWinner` 保留未動，002 的解析行為不變） |
| 公平順位規則（`fairnessRule`） | `answerRanks.ts` 的 `fairnessRule.order()`：成功題數少者優先、同數依送達先後 | 一致 |
| 判定計算（`settleAll`，衍生不保存） | `server/src/domain/answerSettlement.ts` 的 `settleAll()`；唯一入口 `server/src/app/answerSettlementService.ts` 的 `computeSettlement()` | 一致；圖上註明「判定不保存」與實作相同 |
| 判定完成提醒（`fairnessSettler`） | `server/src/app/fairnessSettler.ts`；由 `answerCommands` 的 `onAnswerAccepted` 在 COMMIT 後呼叫，`index.ts` 注入 | 一致；排程只廣播、不保存判定結果 |
| 活動設定（公平順位旗標、已揭曉題數） | `server/src/infra/db/activityRepo.ts` 的 `Activity.fairRankingEnabled`／`revealedQuestionCount`；`database.ts` 的 idempotent migration | 一致 |
| 揭曉指令（`reveal:next` / `reveal:all`） | `server/src/app/projectorCommands.ts`；`commandRouter` 註冊，只有老師、只有已結束 | 一致 |
| 投影快照（`createProjectorSnapshot`） | `server/src/app/snapshot.ts`；`broadcaster.ts` 依握手 `view: 'projector'` 改送投影快照 | 一致；非老師身分維持一般快照 |
| 結果紀錄列（順位、公平順位標示） | `server/src/app/csvBuilder.ts` 的 `ResultRow`（第 8 欄 `fairness`）、`exportCommands.ts` 用判定結果算順位與標示 | 一致（D13 v0.5） |
| 老師端看板（判定中、改判） | `server/src/app/answerProjections.ts` 的 `buildBoard()` → `AnswerBoardQuestion.settling`／`fairnessApplied`；`web/src/features/teacher/AnswerBoard.tsx` | 一致 |
| 學生結果（規則說明、改判標示） | `answerProjections.ts` 的 `buildResults()`／`buildClosedMyAnswers()`；`web/src/features/student/StudentResults.tsx` | 一致 |
| 投影頁（`/projector`） | `web/src/features/projector/ProjectorPage.tsx`、`web/src/app/routes.tsx`、`web/src/lib/socket.ts` 的 `view` 參數 | 一致 |
| 公平順位開關 | `web/src/features/teacher/PhaseControl.tsx`（只有準備中可切）→ `activity:fair-ranking` | 一致 |

## 檢查原則

- 判定位置來自 002 依結構解析的 `blanks.cell` 與已保存的送達資料，沒有固定座標或固定題號（原則 V）。
- 投影快照的作答資訊在伺服器端就不存在，不是前端隱藏（原則 VI）；`projector.test.ts` 直接斷言封包欄位。
- 未啟用公平順位時，資料庫 `submissions.rank` 語意不變、顯示順位與送達序號相同，003 的既有測試全數未修改語意（原則 I）。
- 圖檔檢查由 `npm run check` 內的 `scripts/check-diagrams.sh` 覆核。

## 本輪修正的圖

| 圖 | 修正內容 |
|---|---|
| `005-fairness-and-extras-component.puml` | 補上「判定計算（衍生不保存）」「CSV 產生（004）」與「作答資料在伺服器就沒有送出」的註記 |
| `005-fairness-and-extras-class.puml` | `順位規則` 介面改為與 `RankingRule` 一致的方法；`題目判定` 標示不保存；新增 `結果紀錄列`（順位與公平順位標示） |
| `005-fairness-and-extras-seq-fairness.puml` | 補上作廢後的連鎖重算步驟與「判定不保存」註記 |
| `005-fairness-and-extras-seq-reveal.puml` | 補上伺服器端過濾與「揭曉依題號順序」「重設後清空」的註記 |
