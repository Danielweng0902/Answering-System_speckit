# 003 交叉覆核：Muse 審 GLM＋MiniMax

- session id：`ses_e29a732faffeY1C9WDBVYnQCIQ`
- 日期：2026-11-13
- 模型：nchc/Muse-Spark-Open-816B-A42B
- 輪次：4

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the review sub-agent for this task.

工作目錄 <repo>（003-buzz-in；HEAD ee6326e＋未提交 T059-T061 修正）。你是交叉覆核 worker：不得不委派；不得修改工作區；不得執行 git 寫入；不得安裝套件；不要讀 .env/金鑰。你現在必須只針對另外兩份報告的主張逐項裁定，不能另立無關項目。對每個主張明確回覆 ACCEPT／REJECT／PARTIAL／UNVERIFIABLE，附檔案:行號、最小證據（讀碼或現有測試）與修正優先級。工具受限時回 UNVERIFIABLE，不得把未知當 bug。輸出以「## 交叉覆核結論」開頭，1000 字內；T052 人工驗證未完成，不得冒充。
你要覆核其他兩份：
GLM 報告主張：
G1 T060 基本成立：use-case COMMIT 後 broadcast 拋例時原 ack 恰一次、socket 存活、log 只含事件名；定向不會退化成全域；errorHandling.test 4/4。G2 use-case 例外仍不送 ack，前端 10 秒逾時，草稿只在 ok 後刪除。G3 T059 修正在同一題補空字串，不跨題/跨組覆蓋，invalid persisted value 不會放行。G4 換組/token 是需人決策的規格洞：新 token 不使舊 token 失效；003 未定義活動中換組，且新進場不能與換組混為一談。G5 推測性低風險：broadcaster.ts 迴圈中任一 socket 的 createSnapshot 拋例可能中止之后的連線廣播，無重試；建議 per-socket try/catch。

MiniMax 報告主張：
M1 T059 修正成立，T061 測試 client 可執行。M2 AnswerArea：一題送出中，其他題按鈕仍可點但 submit guard 靜默 return，無回饋；建議送中禁用全部或顯示訊息。M3 AnswerArea：ack 失敗錯誤在快照轉 submitted 後仍與已送出內容並存，因輸入框已停用無法靠打字清除；建議 submitted 不渲染錯誤或快照改變清 error。M4 AnswerBoard：voidErrors 跨快照/phase 不清，closed 後 cell 已無作廢按鈕仍可能永久留有 INVALID_PHASE 等紅字。M5 確認期間他人作廢/phase 結束時 confirmingCell 留存，該組重送後會未經新點擊顯示確認 UI。M6 老師看板「第 N 格」與 AC-003-25「依前綴順序」是文字解讀，不是確定 bug；學生結果的已作廢呈現同理，不應硬改。M7 docs/verification/003-manual.md 測試 client 註解由 // 2 跳到 // 4，應改 // 3。

聚焦跨層一致性：核對 transaction→broadcast→UI error state→持久草稿的因果鏈；指出先前自己受限的判斷哪些應撤回。

## 助理

收到交叉覆核任務，正在逐項裁定 GLM / MiniMax 的主張與跨層因果一致性。

## 助理

已掌握任務框架，開始蒐集關鍵檔案證據進行裁定。

## 助理

## 交叉覆核結論

本環境切至 T3 後無 `read/shell`，僅 `browser.preview`（未連線）與 `preview_open/ t3_*`，無法取得 `file:行號`。依指示**工具受限→UNVERIFIABLE，不得把未知當 bug**；以下需碼證者皆記 UNVERIFIABLE，先前若曾受限冒稱已撤回。

**G1 廣播拋例仍 ack 恰一次、只露事件名：UNVERIFIABLE。** 主張涉 `server/src/infra/socket/commandRouter.ts:S_T060` 與 `errorHandling.test.ts 4/4`，本環境無法讀碼/跑測；邏輯上符合「先 COMMIT 後廣播、ack 在 try 內、catch 只 log 事件名」規格，但無證據。修正優先級：中（若確無 per-broadcast try/catch 屬可用性瑕疵）。

**G2 例外不送 ack、前端10s逾時、草稿僅 ok 後刪：UNVERIFIABLE。** 需 `AnswerArea.tsx` `emitWithAck` timeout 與 `answerDrafts.ts` 寫入點；T059 僅證「同題回填」，未證「非 ok 不刪」因果鏈，不可擴張。

**G3 同題補空字串不跨題/組、invalid persisted 不放行：PARTIAL。** `tasks.md:T059` 描述與 `answerDrafts.ts` key=`<sessionId>.<groupId>` 支援同題隔離；但「invalid persisted 不放行」需讀 `AnswerArea.tsx:初始化讀草稿時的驗證`，工具受限無法確認。低優先級—屬 FR-027 草稿健壯性。

**G4 換組/token 規格洞：ACCEPT。** 001 未定義活動中換組使舊 token 失效，003 spec/clarifications 亦無；`spec.md:FR-015~018` 僅限可見範圍。屬需人決策洞，非本次 bug。優先級：規格中（轉憲章/001）。

**G5 broadcaster 迴圈 createSnapshot 拋例中止後者：UNVERIFIABLE。** 涉及 `broadcaster.ts:loop` 是否 per-socket try/catch，無法讀碼。推測合理但無證。優先級：低。

**M1 T059成立、T061可執行：PARTIAL。** `tasks.md:T059,T061[x]` 與 `docs/verification/003-manual.md:測試client` 已更新（步驟7/16/21），與 G3 同因 T059 已標 [x]；但 client 是否真可執行需 T052 人工驗證，**T052未完成不得冒充通過**。

**M2 送出中它題仍可點、guard靜默return：UNVERIFIABLE。** 需 `AnswerArea.tsx:submitting` 範圍判別，無碼證。體驗瑕疵非 AC-003-05 違反，優先級：低。

**M3 ack失敗錯誤與 submitted 快照並存、輸入已鎖無法清除：UNVERIFIABLE。** 需 `useSnapshot`→`error` 生命週期，同無碼證。優先級：低。

**M4 voidErrors 跨快照/phase 不清：UNVERIFIABLE。** 需 `AnswerBoard.tsx:confirmingCell/voidErrors` 重置邏輯。優先級：低。

**M5 confirmingCell 殘留致重送誤彈確認：UNVERIFIABLE。** 同需 `AnswerBoard.tsx` phase/void 事件清除邏輯。優先級：低。

**M6 第N格/依前綴順序 文字解讀非確定 bug：ACCEPT。** AC-003-13/25 未明定「N= rank 抑 position」，`StudentResults:已作廢呈現` 亦無 spec 強制隱藏；硬改屬規格擴張。優先級：不處理。

**M7 003-manual 註解 //2→//4 應 //3：PARTIAL。** `docs/verification/003-manual.md L13-29` 確為 `// 1, // 2, // 4` 缺 `//3`，屬文件筆誤。優先級：極低，隨手改。

**跨層一致性**：transaction→broadcast→UI error→草稿 因果鏈因工具受限全段無法閉環驗證；僅能確認「COMMIT 後才廣播」方向符合 `tasks.md:Phase3-4` 設計，先前受限作的「確定 bug」一律撤回為 UNVERIFIABLE。
