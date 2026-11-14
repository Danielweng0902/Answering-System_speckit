# Research: Guided Notes 匯入

本檔只記錄 002 新增的決策。語言、框架、儲存、測試、身分與同步方式沿用 [001 research](../001-activity-session/research.md)，不重新選型。

## R1 xlsx 讀取套件

- **Decision**: `exceljs` 4.4.0，只在伺服器使用。以 `package.json` 的 `overrides` 把間接依賴 `uuid` 升到已修正的版本。
- **Rationale**: 讀得到合併範圍（`worksheet.model.merges`）、工作表名稱與每格的值，也能寫回 xlsx 並保留原有格式，004 匯出可以沿用同一套件。已用 `fixtures/guided-notes/02-official-group.xlsx` 與 `05-two-sheets.xlsx` 實測：題組的 `B5:B6` 合併、前綴「（1）」、第二張工作表都正確讀出。`npm audit` 報的 2 個中等風險都來自 `uuid` 的 v3/v5/v6 傳入 buffer 的情況，exceljs 只用 v4，以 overrides 升版消除。
- **Alternatives considered**: SheetJS（`xlsx`）：npm 上的版本已停止更新，新版只在作者 CDN；寫回時不保留格式，對 004 不利。自己用 JSZip 解析 XML：可控但工作量大，合併範圍、共用字串、樣式都要自己處理。

## R2 把試算表轉成「格子模型」再解析

- **Decision**: infra 層把 exceljs 的工作表轉成與套件無關的 `SheetGrid`（工作表名稱、每格文字、合併範圍清單）。domain 層的解析器只吃 `SheetGrid[]`，是純函式。
- **Rationale**: 解析規則（找表頭、判斷題組、讀前綴、檢查重複）是最需要測試的部分，與套件解耦後可以用手寫的小格子做單元測試，也能直接用 fixtures 做整合測試。連結與上傳兩種來源最後都是 xlsx，走同一條路，FR-001「同一份內容結果相同」自然成立。
- **Alternatives considered**: 解析器直接操作 exceljs 物件：測試必須準備 xlsx 檔，邊界情況難以構造。

## R3 解析規則的細節

- **表頭**：在每個工作表逐列尋找同一列中同時有「題號」「題目」「作答」三格的列。比對時去除前後空白（含全形空白 U+3000）後必須完全相等（spec Clarifications）。三個欄位的位置以該列找到的欄為準。
- **工作表選擇**：依活頁簿順序，使用第一個「有表頭且至少有一題」的工作表。都沒有表頭 → `HEADER_NOT_FOUND`；有表頭但都沒有題目 → `NO_QUESTIONS`。
- **題號**：表頭列以下，題號欄的格子若是正整數（數字 `1`、`1.0` 或文字「1」「 1 」）就是一題；其他內容（空白、文字、小數、0、負數）不是題目。合併儲存格以左上角的值為準。
- **題組**：題號格屬於一個「垂直跨多列」的合併範圍時是題組；範圍內每一列一個空格，順序依列。否則是單題，一個空格。
- **空格位置**：作答欄在該列的格子；若該格在合併範圍內，取合併範圍的左上角。同一題中重複的位置只算一次（作答欄跨列合併的情況）。位置以 A1 表示法保存（例如 `G5`），這是解析時依結構找到的結果，不是寫死的座標（原則 V）。
- **前綴**：空格內容開頭符合 `（數字）` 或 `(數字)` 的部分是前綴（保留原字元）；前綴之後還有其他文字，或單題空格本身有內容，視為「已有內容」，列入提醒。
- **題目敘述**：題目欄在題號所在列（題組取第一列）的文字；空白則為空字串。
- **提醒事項**（不阻擋匯入）：題號不連續或不是從 1 開始；空格已有內容；活頁簿中有多個工作表含表頭（顯示使用的工作表）。
- **錯誤**（拒絕匯入）：找不到表頭（列出三個欄名）；沒有題目；題號重複（列出題號與所在列，列號以 1 起算，與試算表一致）。

## R4 Google Sheets 連結

- **Decision**: 只接受 `https://docs.google.com/spreadsheets/d/<ID>/...` 形式的連結。伺服器取出 `<ID>`，自己組出 `https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx` 下載，不使用使用者提供的其他網址部分。跟隨轉址，但最終網址的主機必須是 `docs.google.com` 或 `*.googleusercontent.com`；回應不是試算表檔（例如被導到 `accounts.google.com` 的登入頁）視為未開放檢視。逾時 10 秒，下載超過 5 MB 即中止。
- **Rationale**: 符合 FR-002（只需「知道連結者可檢視」，不需金鑰），也避免伺服器被利用去存取任意網址（SSRF）。匯出的 xlsx 與老師手動下載的內容相同，兩種來源結果一致（FR-001）。
- **Alternatives considered**: Google Sheets API：需要 API 金鑰或 OAuth，違反 FR-002 與原則 IV。匯出 CSV：沒有合併範圍，無法辨識題組。

## R5 上傳方式與大小限制

- **Decision**: `POST /api/questions/import/file`，請求本體直接是 xlsx 位元組（`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 或 `application/octet-stream`），以 `express.raw({ limit: '5mb' })` 接收。解析前先用 JSZip（exceljs 的依賴）讀中央目錄，解壓後總大小超過 50 MB 就拒絕。
- **Rationale**: 只有一個檔案，不需要 multipart 套件。5 MB 是 FR-003 的上限；解壓上限防止壓縮炸彈。
- **Alternatives considered**: multer（multipart）：多一個依賴，對單一檔案沒有好處。Base64 放 JSON：多 33% 傳輸量。

## R6 讀取與確認分成兩步

- **Decision**: 讀取（HTTP）只解析並回傳摘要與 `importId`，不改任何資料；伺服器在記憶體保留最近一次讀取結果（原檔位元組＋解析結果）15 分鐘。確認是 Socket 指令 `questions:confirm { importId }`，走 001 的指令路由：驗證 → 老師身分 → 準備中 → 在同一個 transaction 取代題目並 `revision` +1 → 廣播。取消不需要通知伺服器。
- **Rationale**: FR-014「確認後才成為題目」、FR-019「失敗不改資料」由結構保證：讀取路徑沒有寫入。確認沿用 001 的指令與廣播機制，所有老師分頁同步看到新題目。只保留最近一次讀取，記憶體用量固定。
- **Alternatives considered**: 讀取時就寫入「草稿」資料表：伺服器重啟後才需要，但草稿 15 分鐘內就會被確認或放棄，不值得多一張表。

## R7 HTTP 身分

- **Decision**: 匯入的 HTTP 端點以 `Authorization: Bearer <token>` 帶老師 token，伺服器用 001 的 `resolveIdentity` 解析。不是老師 → 403 `FORBIDDEN`；不在準備中 → 409 `INVALID_PHASE`。
- **Rationale**: 沿用 001 的 token 機制，不新增身分系統；token 不放網址，避免進入 log。

## R8 開啟搶答需要題目（FR-020）

- **Decision**: 001 的 `open` 在 `NO_GROUPS` 之後、倒數範圍之前檢查題目數，沒有題目回 `QUESTIONS_REQUIRED`。001 的測試與 e2e 改為先建立題目（整合測試以 repository 直接寫入；e2e 以上傳 `fixtures/guided-notes/01-official-single.xlsx` 匯入）。
- **Rationale**: 001 data-model 已寫明「002 完成後另需要至少一題」。用新的錯誤代碼，與解析時的 `NO_QUESTIONS`（檔案裡沒有題目）區分。

## R9 題目的保存與重設

- **Decision**: 題目、空格位置與原檔都存在 SQLite，伺服器重啟後保留（與 001 FR-021 一致）。重設活動時保留題目（spec FR-021）。取代題目時刪除舊的學習單、題目、空格後寫入新的，在同一個 transaction。
- **Rationale**: 004 匯出需要原檔與空格位置；重啟後題目不見會讓老師重新匯入，違反 001 的重啟保證精神。
