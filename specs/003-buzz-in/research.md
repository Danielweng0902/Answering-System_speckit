# Research: 搶答作答與結果

本檔只記錄 003 新增的決策。語言、框架、儲存、測試、身分與同步方式沿用 [001 research](../001-activity-session/research.md)，題目解析與保存沿用 [002 research](../002-guided-notes-import/research.md)，不重新選型。

## R1 作答與作廢的傳輸

- **Decision**: `answer:submit` 與 `answer:void` 都走既有 Socket.IO 指令路由（zod → 連線身分 → 用例 → ack），不新增 HTTP 端點。`answer:submit { questionNumber: number, answers: string[] }` 只允許學生；組別一律取自連線的身分，payload 不接受 `groupId`（FR-018）。`answer:void { groupId: string, questionNumber: number }` 只允許老師。成功的 ack 只有 `{ ok: true }`，不回傳 rank。
- **Rationale**: 這些操作都會即時改變狀態且需要身分，001 的指令路由已提供一致的驗證、權限保存與錯誤格式。學生送出若可以在 payload 寫組別，即使伺服器完全忽略也會造成前後端商定不清；直接不把 `groupId` 放進 schema，能以 `INVALID_INPUT` 阻擋並強制 FR-018。ack 不含 rank，讓學生即使讀取網路回應也不會在搶答中知道順位（FR-017）。
- **Alternatives considered**: 新增 REST `POST /api/answers`：與其他即時操作分開，要複製身分、階段、transaction 與錯誤處理。讓學生 payload 帶 `groupId` 再檢查是否符合身分：多一個混淆來源，沒有需要。

## R2 送達順序與 rank 的一致性

- **Decision**: Node 事件迴圈收到 `answer:submit` 後，在同一個同步 SQLite transaction 依序完成：確認 `phase = open` → 找出題號並檢查空格數 → 驗證每個空格內容 → 確認該組沒有有效作答 → 以該題「所有作答（含已作廢）」的最大 `rank` + 1 分配新 `rank` → 寫入作答與 counter → COMMIT。順位不使用學生裝置送來的時間（FR-009）。資料庫加 `UNIQUE(question_id, rank)`，以及 `(question_id, group_id) WHERE voided_at IS NULL` 的部分唯一索引。
- **Rationale**: `node:sqlite` 是同步 API，Node 是單執行緒；指令 handler 在用例完成前不會處理另一個 socket 指令，所以「檢查 → 分配 → 寫入」不會被交錯。事件迴圈處理指令的順序就是伺服器送達順序，rank 因此不會重複或空洞（FR-011、SC-001）。資料庫約束是第二道防線：partial unique index 保證每題每組最多一筆有效作答，`(question_id, rank)` 唯一保證即使是修 bug 或測試注入也不能產生兩個同 rank。倒數到期與老師 end 也排在同一事件迴圈改 phase；某事件先執行 `close` 才處理的送出會看到 closed，另一個方向則先取得 open 並寫入，FR-013 自然成立。
- **Alternatives considered**: 使用學生裝置 timestamp：裝置時鐘不可信也違反原則 VI。改用非同步資料庫或再分散式的 queue：本機單機不需要，反而要處理競態與排序。只靠應用程式檢查不加資料庫約束：無法防止最後一層意外寫入。

## R3 搶答成功判定

- **Decision**: 未啟用 005 公平機制時，搶答成功是「同一題的未作廢作答中 `rank` 最小」的組別（FR-010 與 clarification）。這做成純函式 `decideWinner(submissions)`，輸入一題的所有作答，輸出 `{ submission } | null`；結果、老師看板與之後的匯出都只呼叫這一個入口（FR-014）。
- **Rationale**: 作廢第 1 順位後，其他組的 rank 保持不變，最小的有效 rank 就是新的成功組別；不需要重排。把規則抽出成純函式可直接單元測試「rank 1 被作廢」「中間 rank 被作廢」「全部作廢」「無人作答」，005 只要替換這個函式的政策，不動資料與投影層。
- **Alternatives considered**: 在 SQL 每處寫 `MIN(rank)`：四個讀取點各自重複，未來引入 D14 公平機制時遺漏風險高。依 timestamp 找最早：`rank` 是唯一且不可變的送達順序，timestamp 只保留給顯示與保存，不做競爭依據。

## R4 作答事件 revision 與定向送出

- **Decision**: `answer:submit` 與 `answer:void` 不增加 `activity.revision`。新增持久化、重設活動不歸零的計數：每組 `answerRevision`（該組每次成功送出或被作廢 +1）與全域 `answerEventCount`（每次成功送出或作廢 +1）。快照 revision 分角色計算：老師 = `activity.revision + answerEventCount`；學生 = `activity.revision + 本組 answerRevision`；guest = `activity.revision`。作答事件完成後，只送 `state` 給所有目前連線的老師，以及該組目前連線的學生；不送給其他組學生與 guest。
- **Rationale**: `web/src/lib/useSnapshot.ts` 只接受比目前大的 revision；如果任何一組送出都讓全系統 revision +1，其他組學生即使收到的欄位沒變，也能從 revision 跳號得知有人送出，違反 FR-016 與 SC-002。全域 `answerEventCount` 只出現在老師快照，老師每次作答事件都看到單調遞增；每組 `answerRevision` 只出現在自己的快照，該組每次自己的事件也看到單調遞增；guest 不受作答事件影響。重置活動雖清空作答，counter 不歸零，避免同一身分連線換回舊 revision 而忽略快照。
- **Alternatives considered**: 作答事件照常增加 `activity.revision` 但只給部分連線：老師與該組會看到，之後其他組遇到又一個更大的全域事件時會一次跳很多號，仍然可知期間有多次作答。移除 revision 檢查改由伺服器控制：會破壞 001 已建立的亂序/補發防護。給每個 socket 單獨 revision：需要另外保存連線狀態，資料量小但實作複雜且重啟後難維持持久性。

## R5 三種身分的快照內容

- **Decision**: 搶答中學生快照包含題目摘要（題號、敘述、每個空格 prefix）與 `myAnswers`：每題一筆，含本組目前狀態（未送出／已送出／被作廢）與答案，不含順位。已結束學生快照此外包含 `results`（每題成功組別名稱、答案或無人作答）以及 `myAnswers.rank`。老師快照包含 `board`（每題 × 每組：狀態、答案、rank、是否作廢）與 `progress`（每題有效送出組數、每組有效送出題數）。guest 快照不新增作答、結果、board 或 progress。題目敘述與題號只在搶答中與已結束放進學生快照；準備中維持 002 FR-016 不提供。
- **Rationale**: R5 直接對應 D7、D8、D9：學生搶答中只需要能作答與看到本組狀態，老師需要即時掌握全場，結束後學生才能看結果。guest 沒有課程流程需要結果或作答資料，維持最小傳輸面。每題固定輸出 `myAnswers` 一筆，前端不用再用缺失值代表未送出；老師 board 以題目與組別的完整矩陣輸出，前端不用推測空缺。
- **Alternatives considered**: 搶答中另開 API 給學生查詢自己已送出的答案：浪費一次請求，且又要處理權限與一致性。老師也沿用學生的 `myAnswers` 另查每組：快照不再完整，重新整理或斷線後需多筆請求才能一致。把 rank 存在學生搶答中快照但前端不顯示：違反「使用者不該看到的資料不得傳送」。

## R6 答案格式與錯誤代碼

- **Decision**: 每個空格先以 Unicode trim 去除前後空白，再檢查以 Unicode code point 計的長度為 1–200。`answers` 長度必須等於該題空格數，超出、不足都不是提示前端缺字，而是重試並回固定錯誤。沿用 shared `ERROR_CODES` 風格新增：`QUESTION_NOT_FOUND`、`BLANK_COUNT_MISMATCH`、`ANSWER_EMPTY`、`ANSWER_TOO_LONG`、`ALREADY_SUBMITTED`、`SUBMISSION_NOT_FOUND`；`INVALID_PHASE`、`GROUP_NOT_FOUND`、`FORBIDDEN`、`INVALID_INPUT` 沿用既有代碼與繁中訊息。顯示答案時一律以 React 文字輸出，不做 HTML 解析或執行。
- **Rationale**: 長度以 code point、去完前後空白保存，符合 D23 與「答案含特殊字元要照文字顯示」；同時避免全形／半形空白佔位卻看似沒填。固定代碼讓前端可以只做一致的提示，測試也能直接斷言。
- **Alternatives considered**: JavaScript `length`：算 UTF-16 code unit，代理對的 Emoji 會算 2，不符合題目上限「字元」。只在前端驗證：可被跳過，違反原則 III、VI。對錯誤答案回自定義小寫字串：既有合約使用大寫 `ERROR_CODES`，會造成兩種風格。

## R7 學生草稿與活動識別

- **Decision**: 尚未送出的輸入只存在學生裝置的 localStorage。草稿 key 以活動識別與組別組成，例如 `classroom.buzz-in.drafts.<sessionId>.<groupId>`，內容依題號存尚未送出的答案。伺服器新增持久化 `sessionId`：活動重設與 `questions:confirm` 取代題目時都產生新的隨機字串，並放進學生快照。前端收到與前次不同 `sessionId` 時，移除非目前 `sessionId` 的草稿 key；之後以新 key 重新建立草稿。
- **Rationale**: FR-027 明定草稿只留在裝置、重設或換題後必須清除；因此不需要也不應該在伺服器保存草稿。key 內含 `sessionId` 可以只刪除本活動命名空間，不會清到不相關資料；加上 `groupId` 可避免同一瀏覽器多組操作時弄混。把 `sessionId` 放進學生快照，讓後進場、重新整理與斷線重連都靠同一條快照路徑處理。
- **Alternatives considered**: 伺服器保存草稿：跨裝置同步不是需求，且會讓「未送出」資料變成伺服器狀態。用題目檔案 hash 當活動識別：重設但保留同一份題目時 hash 不變，clarification 仍要求清草稿；隨機 id 更直接。只用 localStorage 的整體清空 `clear()`：會刪掉其他應用或同頁非草稿資料。

## R8 重設與換題時的作答資料

- **Decision**: `activity:reset` 在同一個 transaction 中把既有作答與空格答案全部刪除（FR-028），`sessionId` 換新；counter 依 R4 不歸零。002 的 `questions:confirm` 只允許準備中執行，此時先經過 reset 已無作答；取代題目時仍換新 `sessionId`，造成任何舊草稿失效。
- **Rationale**: 作答必須屬於當次活動，重設後舊 rank 不能繼續存在；counter 不是作答內容，沒有課程意義，只是 revision 單調性的技術狀態，所以保留。002 已限制換題只能在準備中，且 003 的開始順序是結束後 reset 回準備中，取代題目前自然沒有作答；仍讓 `questions` 外鍵刪除可處理資料遷移或測試直接建立庫的非正常情況。
- **Alternatives considered**: 重設時把全部 counter 歸零：老師或學生重新連線前看到的 revision 可能小於舊快照而被前端忽略，R4 已排除。以 `UPDATE` 標記舊作答為 archived：沒有查詢需求，且 FR-028 要求清空；不要保存會誤導結果的資料。

## R9 前端的作答、看板與結果

- **Decision**: 以新元件取代 001 的佔位畫面：學生 `AnswerArea`（題號、敘述、每空格 input、草稿、突出已送出／被作廢狀態）、學生 `StudentResults`（每題成功組別與答案、本組答案與順位）；老師 `AnswerBoard`（題目 × 組別表格、progress 匯總、每個送出格有作廢按鈕，按第一次展開「確認／取消」再送 `answer:void`）。全部 CSS Modules 只引用 `web/src/styles/tokens.css`。
- **Rationale**: R9 對應學生 3 步內送出（選題、填寫、送出）、老師即時掌握全場，以及作廢需要再次確認。以快照欄位直接渲染，不另外合併事件或猜測未顯示資料；作廢按鈕收到的 ack 失敗時在該格或看板頂部顯示訊息，不自行假設成功。
- **Alternatives considered**: 用現成表格套件：會帶入非 design tokens 的視覺與多餘依賴。把作廢做成單次點擊：作廢會改變搶答成功組別且無法復原，本計畫加上再次確認，避免誤按。把作答區與結果區整合成一個巨型元件：更難單獨測試與演進。
