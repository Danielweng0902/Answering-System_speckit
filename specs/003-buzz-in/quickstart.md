# Quickstart: 搶答作答與結果

## 前置

依 [001、002 quickstart](../002-guided-notes-import/quickstart.md) 啟動系統並先 reset 到乾淨活動。老師分頁 `/teacher`，至少使用三個獨立瀏覽器分頁或 Playwright browser context：第一組 A1、第一組 A2、第二組 B。需要檢查封包時再準備 guest 分頁。

## 自動驗證

```bash
npm test          # 單元：答案驗證、decideWinner、rank 與快照投影；整合：transaction、作廢、定向送出、持久化
npm run test:e2e  # 完整老師／兩組學生、作廢再送與結束結果流程
npm run check     # 型別、lint 與 PlantUML 圖檔檢查
```

預期：全部通過。整合測試至少驗證 10 組同題送出的 rank 1–10 各一次（SC-001）、學生封包沒有其他組作答資訊（SC-002）、重啟後 rank 不變（SC-006）。

## 測試 client（步驟 1、7、16、21 使用）

部分驗收情境（AC-003-02、04、20、29、31）在正式 UI 沒有操作入口（輸入已鎖定、按鈕已消失或階段不允許），需以測試 client 直接送 Socket.IO 指令並檢查 ack。做法是在**該身分的同一個瀏覽器分頁**開 DevTools Console 操作；不需要安裝任何工具，也不需要複製或貼上任何密碼／token。

### 原理與位置

- **client 程式**：伺服器本身就在 `/socket.io/socket.io.js` 提供與後端同版本的 Socket.IO client（本機來源，非 CDN），Console 可以 dynamic import 載入。
- **身分**：`web/src/lib/session.ts` 把 token 存在分頁的 `sessionStorage`（key `classroom.session.token`）。測試 client 直接讀同一個 key 連線，因此身分與該分頁的正式 UI 完全相同（學生分頁送 `answer:submit`、老師分頁送 `answer:void`）。**token 只留在分頁內：不要複製、貼上、列印或寫進任何檔案、指令或 log**；ack 內容也不含 token。
- **指令與欄位**（`shared/src/protocol.ts` 的 `AnswerSubmitPayload`／`AnswerVoidPayload`）：
  - `answer:submit`（學生）：`{ questionNumber: 正整數, answers: string[] }`。組別由連線身分決定，**payload 不得帶 `groupId`**，多帶會回 `INVALID_INPUT`（FR-018）。
  - `answer:void`（老師）：`{ groupId: string, questionNumber: 正整數 }`。
  - 回覆是 `{ ok: true }` 或 `{ ok: false, error: { code, message } }`；每次送出的 ack 由該次 `emitWithAck` 的回傳值直接對應，指令沒有（也不需要）requestId 欄位。

### 操作步驟

1. 在要送指令的分頁（例如學生 A1 或老師 T 的分頁）開 DevTools Console，載入 client、以該分頁身分連線，並取得最新快照：

   ```js
   await import('/socket.io/socket.io.js');
   const socket = io({ auth: { token: sessionStorage.getItem('classroom.session.token') } });
   const snapshot = await new Promise((resolve) => socket.once('state', resolve));
   ```

   新連線後伺服器會立刻送一次完整 `state` 快照；`snapshot.groups` 列出各組 `id` 與組名，`answer:void` 需要的 `groupId` 就由此對照（例如「第一組」的 id）。

2. 送出指令並觀察 ack（ack 就是這個 `await` 的回傳值）：

   ```js
   // 學生送出答案（questionNumber 是題號；answers 每空格一個，長度需等於該題空格數）
   await socket.timeout(5000).emitWithAck('answer:submit', {
     questionNumber: 1,
     answers: ['甲', '乙'],
   });

   // 老師作廢某組某題（groupId 由上一步 snapshot.groups 對照）
   await socket.timeout(5000).emitWithAck('answer:void', {
     groupId: snapshot.groups[0].id,
     questionNumber: 1,
   });
   ```

3. 檢查回傳的 ack：`ok` 與 `error.code` 是否為該步驟預期的錯誤代碼（如 `INVALID_PHASE`、`ALREADY_SUBMITTED`、`SUBMISSION_NOT_FOUND`）；`ok: true` 時不回傳 rank 或 Submission id。

4. 清理：該分頁驗證完成後中斷測試連線（學生連線會短暫計入組內在線人數，中斷即回復；分頁的正式 UI 與原本連線不受影響）：

   ```js
   socket.disconnect();
   ```

## 人工驗證（對應驗收情境）

老師分頁 T；A1、A2 選第一組，B 選第二組；以 `fixtures/guided-notes/02-official-group.xlsx` 匯入並確認，使第 1、2 題各有 2 個空格。

| 步驟 | 操作 | 預期 | 驗收情境 |
|---|---|---|---|
| 1 | 學生 A1 在準備中依「測試 client」節送 `answer:submit`；老師 T 送 `answer:void` | 兩者都回 `INVALID_PHASE`；看板不變 | AC-003-02、31 |
| 2 | T 開啟搶答，檢查 A1、A2、B | 2 秒內看到全部題號；第 1 題有「（1）」「（2）」兩個輸入欄與題目敘述 | AC-003-01、22；AC-000-04 |
| 3 | A1 第 1 題只填一個空格，按送出 | 顯示必須填滿所有空格，不占用順位；B 畫面不變 | AC-003-23 |
| 4 | A1 在另一題填只有空白、再填超過 200 字 | 分別被拒絕並提示每格需填寫／最多 200 字；不占用順位 | AC-003-08（另覆蓋 Edge Case 長度） |
| 5 | A1 填完第 1 題兩個空格並送出 | A1、A2 2 秒內顯示第 1 題已送出與答案，不能再輸入；B 畫面完全沒有跡象 | AC-003-03、05、09、24 |
| 6 | B 檢查開發工具中的 `state` 封包 | 不含第一組的答案、狀態、rank、送出數量或 winner；B 若此題已送出也看不到 rank | AC-003-10、11 |
| 7 | A2 依「測試 client」節在 A2 分頁再送第一題的 `answer:submit`（正式 UI 已鎖定） | ack 回 `ALREADY_SUBMITTED`；原答案與順位不變 | AC-003-04 |
| 8 | A1、A2 對第二題幾乎同時按送出 | 只有一筆被接受，另一筆回 `ALREADY_SUBMITTED`；兩分頁顯示同一份答案 | AC-003-06 |
| 9 | B 送出第 1 題 | B 只看到已送出與自己的答案，看不到名次；T 看板 2 秒內顯示第一組 rank 1、第二組 rank 2、每格答案與題組內容 | AC-003-07、11、13、14 |
| 10 | T 查看進度 | 第 1 題顯示 2 組送出；第一組、第二組各自已送出題數也更新 | AC-003-15 |
| 11 | 讓不同組在不同題目各自先送出 | 各題 rank 從 1 起各自獨立，不互相影響 | AC-003-07、AC-003-24 |
| 12 | A1 開始填第三題但不要送出，然後直接重新整理 | 第三題未送出的輸入還在 A1；已送出的第 1、2 題仍顯示已送出與答案 | AC-003-26、28 |
| 13 | 重新啟動伺服器，再開 T 看板 | 所有已送出答案與 rank 與重啟前完全相同 | AC-003-27、SC-006 |
| 14 | T 在第一組已送出的第 1 題按「作廢」，接著按取消，再按作廢與確認 | 第一次只顯示確認區；確認後看板把第一組標為已作廢，第二組 rank 2 不變並成為本題搶答成功；進度只算第二組 | AC-003-29 |
| 15 | 觀察 A1、A2 與 B | A1、A2 2 秒內看到第 1 題已被老師作廢、可重新作答；B 完全收不到作廢資訊 | FR-030、AC-003-10、SC-002 |
| 16 | T 依「測試 client」節在 T 分頁對同一題第一組再送 `answer:void`（正式 UI 已無作廢按鈕） | 回 `SUBMISSION_NOT_FOUND`；看板不變 | AC-003-29（同筆不可重複作廢） |
| 17 | A1 重新填完第 1 題並送出 | 由於原本已有 rank 1、2，第一組新作答得到 rank 3；第二組仍是 rank 2；T 不重新整理即看到 | AC-003-30 |
| 18 | T 按結束搶答 | A1、A2、B 2 秒內切到結果；各題顯示搶答成功組別與答案；未送出的題標示無人作答 | AC-003-17、19；AC-000-07、SC-005 |
| 19 | B 檢查結果與自己組資訊 | 每題看到 winner；也看到自己組各題答案與 rank；未作答题標示未作答 | AC-003-18 |
| 20 | B 重新整理 | 結果、自己組答案與 rank 都保持 | AC-003-21 |
| 21 | B 與 T 各自在自己分頁依「測試 client」節，於已結束時分別送 `answer:submit` 與 `answer:void`（正式 UI 無操作入口） | 都回 `INVALID_PHASE`；結果不變且不送新的 `state` | AC-003-20、31；FR-013 |
| 22 | T 重設活動並檢查資料庫與準備中看板；再開啟搶答，待 A1 再次進入作答區後檢查草稿 | 重設後看板回到準備中且沒有本輪作答；A1 再次進入作答區後，`classroom.buzz-in.drafts.<舊 sessionId>...` 被移除且草稿區為空 | AC-003-32、AC-003-28（FR-027、FR-028） |
| 23 | A1 先填入未送出的草稿；T 結束搶答、重設回準備中，匯入並確認另一份學習單，再開啟搶答；待 A1 再次進入作答區後檢查 | `sessionId` 改變，舊草稿不會帶到新學習單的作答區 | AC-003-32、FR-027 |

步驟 6 與 15 的「完全沒有其他組／作廢資訊」需以瀏覽器網路工具或 Playwright 攔截檢查封包，不只確認畫面沒有顯示；步驟 8 的幾乎同時在人工測試只作近似，精確同步由整合測試驗證。結果記錄在 `docs/verification/`。

介面合約見 [contracts/](./contracts/)，資料模型見 [data-model.md](./data-model.md)。
