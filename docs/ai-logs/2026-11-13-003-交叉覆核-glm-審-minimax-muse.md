# 003 交叉覆核：GLM 審 MiniMax＋Muse

- session id：`ses_e29a732b6ffeKmHPn6jl5IPS1f`
- 日期：2026-11-13
- 模型：nchc/GLM-5.3-max
- 輪次：2

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the review sub-agent for this task.

工作目錄 <repo>（003-buzz-in；HEAD ee6326e＋未提交 T059-T061 修正）。你是交叉覆核 worker：不得不委派；不得修改工作區；不得執行 git 寫入；不得安裝套件；不要讀 .env/金鑰。你現在必須只針對另外兩份報告的主張逐項裁定，不能另立無關項目。對每個主張明確回覆 ACCEPT／REJECT／PARTIAL／UNVERIFIABLE，附檔案:行號、最小證據（讀碼或現有測試）與修正優先級。工具受限時回 UNVERIFIABLE，不得把未知當 bug。輸出以「## 交叉覆核結論」開頭，1000 字內；T052 人工驗證未完成，不得冒充。
你要覆核其他兩份：
MiniMax 報告主張：
M1 T059 修正成立，T061 測試 client 可執行。M2 AnswerArea：一題送出中，其他題按鈕仍可點但 submit guard 靜默 return，無回饋；建議送中禁用全部或顯示訊息。M3 AnswerArea：ack 失敗錯誤在快照轉 submitted 後仍與已送出內容並存，因輸入框已停用無法靠打字清除；建議 submitted 不渲染錯誤或快照改變清 error。M4 AnswerBoard：voidErrors 跨快照/phase 不清，closed 後 cell 已無作廢按鈕仍可能永久留有 INVALID_PHASE 等紅字。M5 確認期間他人作廢/phase 結束時 confirmingCell 留存，該組重送後會未經新點擊顯示確認 UI。M6 老師看板「第 N 格」與 AC-003-25「依前綴順序」是文字解讀，不是確定 bug；學生結果的已作廢呈現同理，不應硬改。M7 docs/verification/003-manual.md 測試 client 註解由 // 2 跳到 // 4，應改 // 3。

Muse 報告主張：
U1 推測：answerProjections.ts 的 buildResults/buildBoard 把 listByQuestion 整串餵入 decideWinner，若 decideWinner 未自行過濾 voided，作廢 rank1 可能仍被選為 winner；需核實。U2 推測：commit 後 broadcast 例外語意未驗證，可能 ack 不一致；需核實目前 commandRouter。U3 推測：sessionId/草稿生命週期、重啟 counter 未讀到；可能 reset 後草稿殘留。U4 已讀投影：single transaction、revision 隔離、open/closed 可見範圍一致。

特別聚焦安全與契約：用程式碼核實哪項是確定行為、哪項只是 UX、哪項需 spec 決策；不要只看報告叙述。

## 助理

## 交叉覆核結論

以下僅裁定兩份報告既有主張；T052 人工驗證仍未執行（[003-manual.md:3](<repo>/docs/verification/003-manual.md) 明載「尚未執行」），本結論不含其結果。

**M1 ACCEPT**：T059 修正與測試俱在——[AnswerArea.tsx:87-89](<repo>/web/src/features/student/AnswerArea.tsx) 以 `blanks.map` 補空字串，[AnswerArea.test.tsx:279-302](<repo>/web/tests/AnswerArea.test.tsx) 驗證非 sparse 與重掛載保留；T061 測試 client 作法與實測紀錄見 [003-automated.md:79](<repo>/docs/verification/003-automated.md)。屬已完成項，無動作。

**M2 ACCEPT（UX，P3）**：[AnswerArea.tsx:108-110](<repo>/web/src/features/student/AnswerArea.tsx) 送出中靜默 return；其他題 `disabled` 只看自身 `isSubmitting`（行 228），可點但無回饋。行為屬實；禁用或提示是設計決策，非契約違反。

**M3 ACCEPT（UX，P3）**：error 渲染不看 `isSubmitted`（行 220-224），`clearError` 只在打字（行 93）或再送出（行 124）觸發；已送出後輸入停用（行 202）確實無法清除。修法（submitted 不渲染或快照變化清 error）屬設計決策。

**M4 ACCEPT（UX，P3）**：[AnswerBoard.tsx:55](<repo>/web/src/features/teacher/AnswerBoard.tsx) `voidErrors` 無任何依快照／phase 清除路徑，`clearVoidError` 只在按作廢時呼叫（行 178）；行 200-204 對任何 cell 狀態渲染，closed 後確無清除入口。

**M5 ACCEPT（UX，P3）**：`confirmingCell`（行 53）僅在 `confirmVoid` finally（行 91）或取消（行 167）清除，快照更新不重置；該組重送回 `submitted` 且 open 時，行 147-148 會未經新點擊再現確認 UI。可達、輕微。

**M6 ACCEPT（其「非確定 bug」立場）**：AC-003-25「依前綴順序」指順序；看板依 position 順序、因 teacher 快照無前綴改標「第 N 格」（AnswerBoard.tsx:10-15 註明），[StudentResults.tsx:19](<repo>/web/src/features/student/StudentResults.tsx) 顯示原前綴。是否補看板前綴、已作廢呈現，屬 spec 決策，不應硬改。

**M7 REJECT**：manual.md 的 `// 1、// 2、// 4` 對應 quickstart 四步驟，第 3 步是程式碼塊下方「ack 觀察」 prose（[003-manual.md:31](<repo>/docs/verification/003-manual.md)）；改 `// 3` 反而破壞與 [quickstart.md:58-60](<repo>/specs/003-buzz-in/quickstart.md) 的對應。

**U1 REJECT**：[answerRanks.ts:18-19](<repo>/server/src/domain/answerRanks.ts) `decideWinner` 明確 skip `voidedAt !== null`，作廢 rank1 不可能成為 winner；餵整串 `listByQuestion` 無害。

**U2 REJECT（語意已核實）**：[commandRouter.ts:138-153](<repo>/server/src/infra/socket/commandRouter.ts) 廣播包 try/catch、ack 恰一次送出；用例例外不回 ack 為文件明載決策（contracts 無內部錯誤碼）。[errorHandling.test.ts:115-198](<repo>/server/tests/integration/errorHandling.test.ts) 已覆蓋兩種廣播例外。無 ack 不一致。

**U3 REJECT**：[answerDrafts.ts:75-98](<repo>/web/src/features/student/answerDrafts.ts) `activateDraftSession` 清除舊 session 草稿、key 含 sessionId（行 12-14），reset 後舊草稿不可達且下次進入即清；rank 持久化於 DB（[answerRepo.ts:170-174](<repo>/server/src/infra/db/answerRepo.ts) `MAX(rank)`），重啟不歸零。

**U4 ACCEPT**：讀碼一致——node:sqlite 同步單連線、`buildMyAnswers` 用 `findLatest`（answerProjections.ts:47）、無跨交易讀取。

安全／契約面：無確定違反。M2-M5 皆為前端 UX 殘留狀態，不影響 ack、權限或資料正確性，建議集中一個小修（快照變化時清 `errors`／`voidErrors`／`confirmingCell`）或交 spec 決策，優先級 P3。
