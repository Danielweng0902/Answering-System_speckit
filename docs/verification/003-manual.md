# 003 人工驗證紀錄（T052）

> 已於 2026-11-14 依 [`specs/003-buzz-in/quickstart.md`](../../specs/003-buzz-in/quickstart.md) 實際操作，23 個步驟全部通過。

- 執行人：philip110531（設計與驗證負責人）
- 日期：2026-11-14
- 裝置與瀏覽器：Windows＋Chrome。老師 T、學生 A1、A2（第一組）、B（第二組）各用一個獨立分頁（手動開新分頁，不用複製分頁），未使用手機

## 前置

依 001、002 quickstart 啟動系統（`npm run build && npm start`）並先 reset 到乾淨活動。老師分頁 `/teacher`；至少三個獨立分頁或裝置：第一組 A1、第一組 A2、第二組 B。需要檢查封包時再準備 guest 分頁。以 `fixtures/guided-notes/02-official-group.xlsx` 匯入並確認，使第 1、2 題各有 2 個空格。

## 測試 client（步驟 1、7、16、21 使用）

正式 UI 沒有入口的操作（AC-003-02、04、20、29、31）以測試 client 送 Socket.IO 指令並檢查 ack。作法（完整說明見 quickstart.md「測試 client」節）：在**該身分的同一個瀏覽器分頁**開 DevTools Console——

```js
// 1. 載入本機伺服器提供的 Socket.IO client，以該分頁身分連線並拿最新快照
await import('/socket.io/socket.io.js');
const socket = io({ auth: { token: sessionStorage.getItem('classroom.session.token') } });
const snapshot = await new Promise((resolve) => socket.once('state', resolve));

// 2. 送指令（questionNumber 是題號；answer:submit 不得帶 groupId，組別由身分決定）
await socket.timeout(5000).emitWithAck('answer:submit', { questionNumber: 1, answers: ['甲', '乙'] });
await socket.timeout(5000).emitWithAck('answer:void', { groupId: snapshot.groups[0].id, questionNumber: 1 });

// 4. 清理：中斷測試連線（不影響該分頁正式 UI）
socket.disconnect();
```

- 第 3 步的 ack 觀察：ack 就是 `await` 的回傳值，檢查 `ok` 與 `error.code` 是否為該步驟預期（`INVALID_PHASE`／`ALREADY_SUBMITTED`／`SUBMISSION_NOT_FOUND` 等）。`answer:void` 的 `groupId` 由 `snapshot.groups` 的組名對照。
- token 只留在分頁內，不複製、貼上或寫進檔案／指令／log；因此不使用需要把 token 傳入 shell 或腳本的本機 node 做法。
- 本操作方法已於 2026-11-14 在正式啟動（`npm run build && npm start`）的系統上實測可用（見 `003-automated.md` 的 T061 紀錄）。

## 步驟

| # | 操作 | 預期 | 驗收情境 | 結果 | 備註 |
|---|---|---|---|---|---|
| 1 | 學生 A1 在準備中依「測試 client」節送 `answer:submit`；老師 T 送 `answer:void` | 兩者都回 `INVALID_PHASE`；看板不變 | AC-003-02、31 | 通過 | A1 的 `answer:submit` 與 T 的 `answer:void` 都回 `INVALID_PHASE`；看板不變 |
| 2 | T 開啟搶答，檢查 A1、A2、B | 2 秒內看到全部題號；第 1 題有「（1）」「（2）」兩個輸入欄與題目敘述 | AC-003-01、22；AC-000-04 | 通過 |  |
| 3 | A1 第 1 題只填一個空格，按送出 | 顯示必須填滿所有空格，不占用順位；B 畫面不變 | AC-003-23 | 通過 |  |
| 4 | A1 在另一題填只有空白、再填超過 200 字 | 分別被拒絕並提示每格需填寫／最多 200 字；不占用順位 | AC-003-08（另覆蓋 Edge Case 長度） | 通過 | 通過；只填空白時的提示為「每個空格都要填寫答案；尚未填寫的空格：第 1 格（答案）」，建議修改（見下方建議 1） |
| 5 | A1 填完第 1 題兩個空格並送出 | A1、A2 2 秒內顯示第 1 題已送出與答案，不能再輸入；B 畫面完全沒有跡象 | AC-003-03、05、09、24 | 通過 |  |
| 6 | B 檢查開發工具中的 `state` 封包 | 不含第一組的答案、狀態、rank、送出數量或 winner；B 若此題已送出也看不到 rank | AC-003-10、11 | 通過 | 初始快照走 HTTP polling，以 Network 搜尋檢查；後續快照以 WebSocket Messages 篩選檢查。搜尋 A1 答案文字與 `rank` 皆無結果 |
| 7 | A2 依「測試 client」節在 A2 分頁再送第一題的 `answer:submit`（正式 UI 已鎖定） | ack 回 `ALREADY_SUBMITTED`；原答案與順位不變 | AC-003-04 | 通過 | 回 `ALREADY_SUBMITTED`；原答案不變 |
| 8 | A1、A2 對第二題幾乎同時按送出 | 只有一筆被接受，另一筆回 `ALREADY_SUBMITTED`；兩分頁顯示同一份答案 | AC-003-06 | 通過 | 以兩分頁快速切換送出近似同時；只接受一筆，兩分頁顯示同一份答案 |
| 9 | B 送出第 1 題 | B 只看到已送出與自己的答案，看不到名次；T 看板 2 秒內顯示第一組 rank 1、第二組 rank 2、每格答案與題組內容 | AC-003-07、11、13、14 | 通過 |  |
| 10 | T 查看進度 | 第 1 題顯示 2 組送出；第一組、第二組各自已送出題數也更新 | AC-003-15 | 通過 |  |
| 11 | 讓不同組在不同題目各自先送出 | 各題 rank 從 1 起各自獨立，不互相影響 | AC-003-07、AC-003-24 | 通過 | 改用第 4 題（第 3 題保留給步驟 12）：第二組先送出得 rank 1，第一組 rank 2 |
| 12 | A1 開始填第三題但不要送出，然後直接重新整理 | 第三題未送出的輸入還在 A1；已送出的第 1、2 題仍顯示已送出與答案 | AC-003-26、28 | 通過 |  |
| 13 | 重新啟動伺服器，再開 T 看板 | 所有已送出答案與 rank 與重啟前完全相同 | AC-003-27、SC-006 | 通過 |  |
| 14 | T 在第一組已送出的第 1 題按「作廢」，接著按取消，再按作廢與確認 | 第一次只顯示確認區；確認後看板把第一組標為已作廢，第二組 rank 2 不變並成為本題搶答成功；進度只算第二組 | AC-003-29 | 通過 |  |
| 15 | 觀察 A1、A2 與 B | A1、A2 2 秒內看到第 1 題已被老師作廢、可重新作答；B 完全收不到作廢資訊 | FR-030、AC-003-10、SC-002 | 通過 | B 的 WebSocket Messages 篩選 `void`、`作廢` 皆無結果 |
| 16 | T 依「測試 client」節在 T 分頁對同一題第一組再送 `answer:void`（正式 UI 已無作廢按鈕） | 回 `SUBMISSION_NOT_FOUND`；看板不變 | AC-003-29（同筆不可重複作廢） | 通過 | 回 `SUBMISSION_NOT_FOUND` |
| 17 | A1 重新填完第 1 題並送出 | 由於原本已有 rank 1、2，第一組新作答得到 rank 3；第二組仍是 rank 2；T 不重新整理即看到 | AC-003-30 | 通過 |  |
| 18 | T 按結束搶答 | A1、A2、B 2 秒內切到結果；各題顯示搶答成功組別與答案；未送出的題標示無人作答 | AC-003-17、19；AC-000-07、SC-005 | 通過 | 第 3 題（只有草稿）顯示無人作答 |
| 19 | B 檢查結果與自己組資訊 | 每題看到 winner；也看到自己組各題答案與 rank；未作答题標示未作答 | AC-003-18 | 通過 |  |
| 20 | B 重新整理 | 結果、自己組答案與 rank 都保持 | AC-003-21 | 通過 |  |
| 21 | B 與 T 各自在自己分頁依「測試 client」節，於已結束時分別送 `answer:submit` 與 `answer:void`（正式 UI 無操作入口） | 都回 `INVALID_PHASE`；結果不變且不送新的 `state` | AC-003-20、31；FR-013 | 通過 | B 與 T 都回 `INVALID_PHASE`；結果不變 |
| 22 | T 重設活動並檢查資料庫與準備中看板；再開啟搶答，待 A1 再次進入作答區後檢查草稿 | 重設後看板回到準備中且沒有本輪作答；A1 再次進入作答區後，`classroom.buzz-in.drafts.<舊 sessionId>...` 被移除且草稿區為空 | AC-003-32、AC-003-28（FR-027、FR-028） | 通過 | 未直接開資料庫，以老師看板回到準備中且無作答確認（資料庫內容由自動測試涵蓋）；Application → Local Storage 確認舊 `classroom.buzz-in.drafts.` 項目已移除 |
| 23 | A1 先填入未送出的草稿；T 結束搶答、重設回準備中，匯入並確認另一份學習單，再開啟搶答；待 A1 再次進入作答區後檢查 | `sessionId` 改變，舊草稿不會帶到新學習單的作答區 | AC-003-32、FR-027 | 通過 | 重設後匯入 `01-official-single.xlsx`；舊草稿未帶入，Local Storage 舊項目已移除 |

## 填寫須知

- 步驟 6 與 15 的「完全沒有其他組／作廢資訊」需以瀏覽器網路工具或 Playwright 攔截檢查封包，不只確認畫面沒有顯示；步驟 8 的幾乎同時在人工測試只作近似，精確同步由整合測試驗證（已通過，見 `003-automated.md`）。
- 每步結果建議記 `通過`／`不通過`＋實際觀察；不通過時另開 GitHub issue 並在本表備註編號。
- 全部通過後，由負責人在 `specs/003-buzz-in/tasks.md` 勾選 T052。

## 結果與建議

23 個步驟全部通過，未發現功能問題，未開 GitHub issue。以下為介面文字與呈現的改善建議，不影響功能驗收：

1. **空白作答的提示（步驟 4）**：目前為「每個空格都要填寫答案；尚未填寫的空格：第 1 格（答案）」，句子長且「第 1 格（答案）」不直覺。建議改為「答案不可為空白」，題組可加上格號，例如「第（2）格不可為空白」。
2. **老師看板的作答進度**：目前為「第 1 題：0 組送出」「第一組：已送出 0 題」，看不出總數。建議改為「已完成／總數」：
   - 每題：`第 1 題：13/15`（已送出組數／總組數）
   - 每組：`第一組：3/6`（已送出題數／總題數）

   老師可直接看出還差多少組、多少題。
3. 其餘 UI／UX 調整由設計負責人另行整理，不列入本次驗收。
