# 003 交叉覆核：MiniMax 審 GLM＋Muse

- session id：`ses_e29a73314ffeCzDXu2HareQ1vx`
- 日期：2026-11-13
- 模型：nchc/MiniMax-M3.1-Flash
- 輪次：4

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the review sub-agent for this task.

工作目錄 /Users/Pig0902/Answering-System_speckit（003-buzz-in；HEAD ee6326e＋未提交 T059-T061 修正）。你是交叉覆核 worker：不得不委派；不得修改工作區；不得執行 git 寫入；不得安裝套件；不要讀 .env/金鑰。你現在必須只針對另外兩份報告的主張逐項裁定，不能另立無關項目。對每個主張明確回覆 ACCEPT／REJECT／PARTIAL／UNVERIFIABLE，附檔案:行號、最小證據（讀碼或現有測試）與修正優先級。工具受限時回 UNVERIFIABLE，不得把未知當 bug。輸出以「## 交叉覆核結論」開頭，1000 字內；T052 人工驗證未完成，不得冒充。
你要覆核其他兩份：
GLM 報告主張：
G1 T060 基本成立：use-case COMMIT 後 broadcast 拋例時原 ack 恰一次、socket 存活、log 只含事件名；定向不會退化成全域；errorHandling.test 4/4。G2 use-case 例外仍不送 ack，前端 10 秒逾時，草稿只在 ok 後刪除。G3 T059 修正在同一題補空字串，不跨題/跨組覆蓋，invalid persisted value 不會放行。G4 換組/token 是需人決策的規格洞：新 token 不使舊 token 失效；003 未定義活動中換組，且新進場不能與換組混為一談。G5 推測性低風險：broadcaster.ts 迴圈中任一 socket 的 createSnapshot 拋例可能中止之后的連線廣播，無重試；建議 per-socket try/catch。

Muse 報告主張：
U1 推測：answerProjections.ts 的 buildResults/buildBoard 把 listByQuestion 整串餵入 decideWinner，若 decideWinner 未自行過濾 voided，作廢 rank1 可能仍被選為 winner；需核實。U2 推測：commit 後 broadcast 例外語意未驗證，可能 ack 不一致；需核實目前 commandRouter。U3 推測：sessionId/草稿生命週期、重啟 counter 未讀到；可能 reset 後草稿殘留。U4 已讀投影：single transaction、revision 隔離、open/closed 可見範圍一致。

用廣度與快速讀碼優勢：核對 GLM 的 socket/broadcast 與 Muse 的 winner/session/maintenance 推測，可執行一次既有 web 或 server 聚焦測試。

## 助理

I'll start by exploring the workspace to understand the current state of the code under review.

## 助理

Let me examine the key files referenced in both reports.

## 助理

## 交叉覆核結論

覆核範圍：003-buzz-in HEAD ee6326e ＋未提交 T059–T061。已讀碼並實跑：`npx vitest run server/tests/integration/errorHandling.test.ts`（4 passed）、`cd web && npx vitest run tests/AnswerArea.test.tsx`（8 passed）。**T052 人工驗證未執行，本報告不代表 T052 完成。**

**G1 ACCEPT（P3 附註）** 廣播在 try 內、送 ack 在 try 外：commandRouter.ts:138-153；「ack 恰一次／連線存活／log 只含事件名」有測試佐證 errorHandling.test.ts:114-205；定向不退回全域由 index.ts:185-208（answer:submit/void 走 broadcastSubmissionChanged）＋ commandRouter.ts:140-144 保證。附註：廣播失敗僅記錄、不補送，其他客戶端狀態會落後到下一次廣播或重連（併入 G5 一起處理）。

**G2 ACCEPT（P3 補測）** 用例例外於 commandRouter.ts:129-137 直接 return，不呼叫 sendAck；前端 web/src/lib/socket.ts:56,68-77 逾時 10 秒並轉為 `{ok:false,code:null}`；AnswerArea.tsx:132-146 只有 ack.ok 才刪草稿，逾時路徑只 setErrors。缺口：「不送 ack」目前僅讀碼證據，errorHandling.test.ts:26-51 未掛 ack callback，建議補一條「無 ack 抵達」的斷言。

**G3 ACCEPT（無待修）** AnswerArea.tsx:84-91 以 `question.blanks.map` 補空字串並只覆寫 `current[question.number]`，不跨題；儲存 key 含 groupId（answerDrafts.ts:12-13）不跨組；parseStoredDrafts 對 null/非字串丟棄整題（answerDrafts.ts:26-37），invalid 不放行。新測試 8/8 通過。

**G4 PARTIAL（P2 決策）** 「003 未定義活動中換組」不精確：FEATURE-CONTRACT.md:62（D21）與 specs/001-activity-session/spec.md:129,153 已定義只能準備中換組。其餘成立：issueSession 只 INSERT 不刪舊 token（access.ts:30-43、sessionRepo.ts:20-35），舊 token 仍有效；join 允許任何階段（authRoutes.ts:132-149），伺服器無法區分新進場與換組，故 FR-012 未在伺服器端強制（UI 僅 preparing 提供「更換組別」：StudentPage.tsx:93-100）。確實需人決策並經兩組同意，003 不宜自行定義。

**G5 ACCEPT（P3，防禦性）** broadcaster.ts:76-89、91-106 迴圈無 per-socket try/catch，任一 socket 的 createSnapshot 拋例外即中止其後廣播，且無重試；僅在活動未初始化等異常才會拋（snapshot.ts:27-30），故風險低。建議 per-socket try/catch＋失敗記錄事件名。

**U1 REJECT（無需修）** decideWinner 內部已略過作廢：answerRanks.ts:17-20；buildResults/buildBoard 直接餵全量安全（answerProjections.ts:72,149）；進度另過濾 voidedAt（answerProjections.ts:191-194）；closed 用 listValidByGroup（answerRepo.ts:190-197）。作廢 rank1 不會成為 winner。

**U2 REJECT（已由 T060 確定，非未驗證）** 語意與證據同 G1；建議補「不送 ack」斷言（P3）。

**U3 REJECT（草稿殘留不成立；重啟 counter 正常）** reset 於同一交易換新 sessionId（activityCommands.ts:152-166 → activityRepo.ts:88-93）；前端以 [sessionId,myGroupId] 為 key 重掛載（AnswerArea.tsx:51,58-60）並呼叫 activateDraftSession 清除他組舊 session 草稿（answerDrafts.ts:75-97），符合 AC-003-32。counter 皆持久化（answerRepo.ts:71-83、activityRepo.ts:50-74、answerRepo.ts:171-179），server/tests/integration/answerPersistence.test.ts:204 驗證重啟後 Submission/rank/counter/sessionId 相同。缺口：前端無「reset 後草稿清除」自動化測試（P3 補測）。

**U4 ACCEPT（無待修）** 單一交易：answerCommands.ts:136-146,154-164（BEGIN IMMEDIATE/COMMIT/ROLLBACK）；revision 隔離：snapshot.ts:32-37（teacher=activity.revision+answer_event_count、student=+本組 answer_revision、guest=activity.revision）；可見範圍一致：open 僅本組且不含 rank（answerProjections.ts:42-61、snapshot.ts:63-70），closed 為 results＋本組含 rank（snapshot.ts:71-78）。測試：answerVisibility.test.ts:95,516、snapshot.test.ts:148,248,480。

**總結**：無阻擋性缺陷；待處理為 G4 規格決策（P2）、G5 與 G1 廣播補送（P3）、G2/U3 補測（P3）。T052 仍待人工驗證。
