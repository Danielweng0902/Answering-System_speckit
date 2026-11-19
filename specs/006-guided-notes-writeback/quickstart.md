# Quickstart: 寫回線上 Google Sheets（006）

## 前置

### 一次性設定：Google 服務帳號（老師做一次）

寫回需要對那份線上試算表有**編輯權限**；「知道連結者可檢視」只能讀、不能寫。

1. **建立專案**：開 <https://console.cloud.google.com/> → 新增專案（例如 `classroom-quiz`）。
2. **啟用 API**：APIs & Services → Library → 搜尋 `Google Sheets API` → Enable。
3. **建立服務帳號**：IAM & Admin → Service Accounts → Create service account
   （名稱例如 `classroom-quiz-bot`）。**角色可以留空**——對試算表的權限來自檔案的「共用」，不是專案 IAM 角色。
4. **建立金鑰**：服務帳號 → Keys → Add key → Create new key → 選 JSON → 下載。
   這個 JSON 檔等同密碼，**不要丟到群組、issue 或版本控制**。
5. **填 `.env`**（把 JSON 裡的 `client_email` 與 `private_key` 填進去；`private_key` 貼成單行、把換行寫成 `\n`）：

   ```bash
   GOOGLE_SERVICE_ACCOUNT_EMAIL=classroom-quiz-bot@classroom-quiz.iam.gserviceaccount.com
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
   ```

6. **把試算表共用給服務帳號**：開那份線上試算表 → 右上角「共用」→ 加入上面那個信箱 → 權限選「**編輯者**」。
   （讀取仍建議保留「知道連結者可檢視」，匯入流程會用到。）

> 常見問題：若「共用」時跳出「無法新增共用者」，多半是試算表還在別人的「共用雲端硬碟」→ 先用「移至我的雲端硬碟」再共用一次。

### 每次測試前

- `.env` 已有服務帳號設定（**只放本機、不進版控**）：

  ```
  GOOGLE_SERVICE_ACCOUNT_EMAIL=your-bot@your-project.iam.gserviceaccount.com
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  ```

- 測試用的線上試算表已**共用給服務帳號信箱**（編輯者），並記得保留「知道連結者可檢視」讓讀取能用。
- `npm run build && npm start`

## 自動驗證

```bash
npm test          # 含寫入器請求內容、錯誤對映、JWT 簽章、寫回用例與路由
npm run check     # 型別、lint 與 PlantUML 圖檔檢查
```

> 自動測試全部注入假的 fetch 與假的寫入器，**不會連到 Google**，也不需要金鑰。

## 人工驗證（需要真實金鑰與線上試算表）

| # | 操作 | 預期 | 驗收情境 |
|---|---|---|---|
| 1 | 老師 T 以 Google Sheets 連結匯入 `02-official-group.xlsx`（連結指向自己的線上試算表） | 匯入成功，顯示 4 題、6 個空格 | 前置 |
| 2 | 學生 A、B 在第 1 題作答，老師結束搶答 | 結果畫面顯示搶答成功組別與答案 | 前置 |
| 3 | T 按「寫回 Google 試算表」 | 顯示「已寫回 N 格答案到 Google 試算表」 | AC-006-01 |
| 4 | 打開那份線上試算表 | 第 1 題的「（1）」「（2）」**保持原樣**，右側答案格出現搶答成功組的答案；其他題目、格式、公式都沒變 | AC-006-02、SC-001、SC-002 |
| 5 | 對照老師端結果 | 線上試算表的答案與老師端看到的完全一致 | SC-001 |
| 6 | 找一個沒有人作答的題目 | 該題的填空格沒有被寫入、內容沒變 | AC-006-04 |
| 7 | 把試算表的「共用」移除服務帳號，再按一次寫回 | 顯示「沒有這份試算表的編輯權限」並提示可以改用下載 xlsx | AC-006-06、AC-006-07 |
| 8 | 用上傳 xlsx 匯入的活動按寫回 | 按鈕停用並提示改用「匯出 Guided Notes」 | AC-006-05、FR-008 |
| 9 | 寫回前後都看一次老師端 | 作答、題目、順位、階段都沒變（寫回是唯讀動作） | FR-005、SC-004 |
| 10 | 學生身分直接呼叫 `POST /api/export/guided-notes/writeback` | 回 `403 FORBIDDEN` | AC-006-09 |

## 注意事項

- 步驟 7 需要先把服務帳號從試算表的共用名單移除，記得測完加回去。
- 線上試算表如果被改名或刪除，會得到 `SHEET_NOT_FOUND`（AC-006-07）。
- 寫回只寫答案值，老師原本的公式與格式不會被改動（可以在一個有公式的表單上確認）。
- **寫回只會覆寫「這次有搶答成功答案」的題目**：同一份試算表寫回第二次時，這次沒人作答的題目會保留上一場的答案（寫回不會清空它們）。重複使用同一份試算表時，請先自行清掉舊答案。（2026-11-18 人工驗證建議 4：04 那種「前綴＋答案在同一個合併格」的版面無法安全清空——清掉會連前綴一起刪掉，所以選擇明確寫在說明與成功訊息裡，而不是一併清空。）
- 寫回前系統會**重新讀取線上試算表，確認版面與匯入時完全一致才寫入**：
  - 版面一致 → 照匯入時的位置寫入答案。
  - **列欄被挪動或題目被改動** → 對應不起來，**不寫回**，畫面會提示改用「匯出 Guided Notes」下載含答案的 xlsx。
  - **讀不到線上試算表**（關掉「知道連結者可檢視」或網路不穩）→ 不寫回，可再按一次「寫回 Google 試算表」重試；仍不行就改用「匯出 Guided Notes」下載 xlsx。
- **短期使用建議**：匯入後盡量不要動版面；真的改了請用**「匯出 Guided Notes」下載含答案的 xlsx**（不要用「重新匯入」——匯入只能在「準備中」進行，活動結束後要重匯必須先重設，會把這場的作答清掉）。寫回前也先備份一份原表。
