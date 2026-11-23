# 002 Guided Notes 匯入手動驗證與 Windows 環境設定

- session id：`2e8ec0bb-3080-4d59-ba63-8bce5d728539`
- 日期：2026-11-13
- 模型：anthropic/claude（claude.ai）
- 輪次：5

> 本檔由 claude.ai 的資料匯出整理：只保留對話本身，
> 工具呼叫與推理內容未收錄，截圖與檔案未收錄，機敏值已換成佔位符。

---

## 使用者

這份專案是我軟體工程課程的期末專案，採用spec kit的開發流程，目前已經由另一名組員進行初步開發，我負責測試、也希望能了解程式架構
目前我需要測試以下指令所說的東西，請協助我測試
這次做好的功能：老師可以把 Guided Notes（學習單 xlsx）匯入系統，系統會自動找出題目和空格。
程式和自動測試都已完成，現在需要真人實際操作一次，確認用起來沒問題。
大約需要 30–40 分鐘。

━━ 需要準備 ━━
・一台電腦（已裝 Node.js 24 以上、Git；不確定的話在終端機打 node -v 看版本）
・一支手機（扮演學生），跟電腦連同一個 Wi-Fi（學校 Wi-Fi 連不到的話改用手機熱點）
・一個隨便的 PDF 檔，和一個超過 5 MB 的檔案（任何檔案都行，用來測錯誤訊息）
・一個 Google 帳號（測試用連結匯入）

━━ 第一步：拿到程式 ━━
還沒下載過專案：
  git clone https://github.com/Danielweng0902/Answering-System_speckit.git
  cd Answering-System_speckit
已經下載過：
  cd Answering-System_speckit
  git pull
然後切到這次的分支並安裝：
  git fetch
  git checkout 002-guided-notes-import
  npm install

━━ 第二步：設定老師密碼（只有第一次要做）━━
  cp .env.example .env      （Windows 用 copy .env.example .env）
打開 .env，在 TEACHER_PASSWORD= 後面填一個自己決定的密碼。
這個檔案不會上傳，也請不要貼到群組。

━━ 第三步：啟動 ━━
  npm run build
  npm start
看到 Server listening 就成功了。
・老師（電腦）：瀏覽器開 http://localhost:3000/teacher，用剛剛的密碼登入
・學生（手機）：開 http://電腦的IP:3000/student
  電腦 IP 查法：Mac 打 ipconfig getifaddr en0；Windows 打 ipconfig 看 IPv4

━━ 第四步：照著做，每一步確認畫面對不對 ━━
測試檔都在專案裡的 fixtures/guided-notes/ 資料夾。

 1. 先新增一個組別，不匯入題目就按「開啟搶答」→ 應該被拒絕，提示要先匯入題目
 2. 上傳 01-official-single.xlsx → 出現摘要：6 題、6 個空格、題號 1–6、都是單題
 3. 按「取消」→ 題目清單還是空的
 4. 再上傳一次 01，按「確認匯入」→ 老師端出現題號 1–6；手機（學生）看不到題目
 5. 上傳 02-official-group.xlsx → 摘要提示「會取代現有題目」，4 題、第 1、2 題是題組
 6. 依序上傳 03、04、05（看摘要就好，可以按取消）→ 題數合理、05 顯示用的是「學習單」工作表
 7. 依序上傳 90、91、92 → 分別顯示：找不到表頭、題號 3 重複（附列號）、沒有題目；題目清單不變
 8. 上傳 PDF 和超過 5 MB 的檔案 → 說明只接受 xlsx、5 MB 以內
 9. Google 連結：把 01 上傳到 Google 雲端硬碟，用 Google 試算表開啟，
    共用設定改成「知道連結者可檢視」，複製網址貼到系統按讀取 → 摘要跟第 2 步一樣
10. 把共用改回「限制」再讀取一次；也貼一個普通網址（例如 https://www.google.com）
    → 都要說明原因，並建議改共用設定或下載成 xlsx 上傳
11. 確認匯入後開啟搶答，再嘗試匯入 → 被拒絕，題目不變
12. 結束搶答 → 重設活動 → 題目還在
13. 在終端機按 Ctrl+C 關掉伺服器，再打 npm start 重開 → 題目還在

━━ 第五步：回報結果 ━━
最簡單的方式：直接在 PR 底下留言 ：https://github.com/Danielweng0902/Answering-System_speckit/pull/3
照這個格式就好：

  測試日期：
  電腦 / 手機：（例如 MacBook + iPhone 15，Chrome / Safari）
  1 ✅  2 ✅  3 ✅ …（每一步打勾或叉）
  有問題的步驟：第幾步、做了什麼、看到什麼、預期是什麼（有截圖更好）

會用 git 的話，也可以把結果寫成 docs/verification/002-manual.md，
commit 到 002-guided-notes-import 分支（不要直接推到 main）。

━━ 另外請設計負責人看一下 ━━
docs/verification/002-screenshots/ 裡有 5 張畫面截圖，請確認視覺 OK。
其中「連結未開放」那張，替代做法重複出現了兩次，看要不要改。

有任何卡住的地方直接問我！

## 助理

我先看一下你電腦上的專案資料夾目前是什麼狀態，再決定怎麼幫你跑這些測試。

我看了你電腦上的專案資料夾，也把這個分支 clone 到我這邊讀程式碼。伺服器最後還是要在你的電腦上跑：手機要連你電腦的 IP，Google 連結也要用你的帳號，而我這邊的環境裝不完套件（缺 `zod`，build 會失敗），Node 也只有 22 版。下面是照你電腦現況改寫的 Windows 步驟。

## 你的資料夾現在少了三樣東西

- **還在 `main` 分支**，要先切到 `002-guided-notes-import`。測試檔 `fixtures/guided-notes/` 雖然已經在了，但伺服器程式要切過去才是新的。
- **沒有 `node_modules`**，所以要先 `npm install`。
- **沒有 `.env`**。

在 PowerShell 依序打：

```powershell
cd <repo>
node -v                      # 要 v24 以上
git fetch
git checkout 002-guided-notes-import
git pull
npm install
copy .env.example .env
notepad .env                 # 在 TEACHER_PASSWORD= 後面填密碼，存檔
npm run build
npm start                    # 看到 "Server listening on ..." 就成功
```

另開一個 PowerShell 打 `ipconfig`，找 Wi-Fi 那段的 IPv4，手機就開 `http://那個IP:3000/student`。

## 容易卡住的地方

- **手機連不上：** 第一次 `npm start` 時 Windows 會跳防火牆視窗，要勾「私人網路」並允許。如果當時按掉了，到「Windows Defender 防火牆 → 允許應用程式」把 Node.js 打開。
- **第 8 步要的 5 MB 以上檔案：** 用 PowerShell 做一個 6 MB、副檔名是 .xlsx 的假檔。這樣測到的是「大小」限制，不會因為副檔名不對先被擋下來：
  ```powershell
  $f=[IO.File]::Create("$HOME\Desktop\big.xlsx"); $f.SetLength(6MB); $f.Close()
  ```
- **第 8 步要的 PDF：** 瀏覽器隨便開一頁，按 Ctrl+P，選「Microsoft Print to PDF」就有了。

## 每一步應該看到什麼

這是對照 `fixtures/guided-notes/expected.json` 和程式碼整理的：

| 檔案 | 預期 |
|---|---|
| 01 | 6 題、6 個空格、都是單題 |
| 02 | 4 題、6 個空格，第 1、2 題各有（1）（2）兩個子題 |
| 03 | 8 題、8 個空格（表頭不在第 4 列，測試解析器不寫死位置） |
| 04 | 7 題、11 個空格（第 2 題有 3 個子題） |
| 05 | 5 題，摘要要寫用的是「學習單」工作表，不是第一張的「說明」 |
| 90 / 91 / 92 | 找不到表頭／題號 3 重複／沒有題目 |
| PDF、超過 5 MB | 「請使用 xlsx 格式、5 MB 以內的學習單」 |
| 連結沒開放或不是試算表 | 列出兩個替代做法：「把共用設定改成知道連結者可檢視」、「下載成 xlsx 後上傳」 |

**第 10 步要多留意：** 組員說截圖裡替代做法重複出現了兩次。測的時候看實際畫面是不是也重複，有的話截圖附在回報裡。

**第 13 步的原理：** 伺服器每次啟動、開始接受連線之前，會先把存下來的資料讀回來。資料存在 `.env` 的 `DATA_DIR=./data`，所以重開後題目應該還在。

## 程式架構（給你理解用）

- `shared/`：前端和後端共用的資料格式定義（zod schema、socket 協定）。
- `server/src/domain/`：不碰 I/O 的核心邏輯。
  - `guidedNotesParser.ts` 從「題號／題目／作答」表頭和合併儲存格找出題目和空格。
  - `importValidator.ts` 負責抓重複題號、沒有題目這類錯誤。
- `server/src/app/importService.ts`：處理匯入流程。上傳只回傳摘要，按確認才寫入；搶答開始後就不准再匯入。
- `server/src/infra/`：對外的部分。
  - `xlsx/workbookReader.ts` 讀 xlsx 檔。
  - `sheets/googleSheetsFetcher.ts` 把 Google 連結轉成 `/export?format=xlsx` 去下載，超過 5 MB 會中途停止，不會整個讀完。
  - `http/questionRoutes.ts` 是 HTTP 路由，會先檢查身分再讀檔案內容。
  - 資料庫和 socket 也在這一層。
- `web/src/features/teacher/QuestionImport.tsx`：老師端的匯入畫面，錯誤訊息和替代做法都寫在這個檔案。

## 回報範本（貼到 PR #3）

```
測試日期：2026-11-13
電腦 / 手機：Windows ___ + ___，瀏覽器 ___ / ___
1 ☐  2 ☐  3 ☐  4 ☐  5 ☐  6 ☐  7 ☐  8 ☐  9 ☐  10 ☐  11 ☐  12 ☐  13 ☐
有問題的步驟：第_步｜做了什麼｜看到什麼｜預期是什麼
```

如果你希望，我可以直接操作你的電腦，開 PowerShell 跑上面的指令，再開瀏覽器做第 1–8、11–13 步並截圖；手機和 Google 雲端那兩段（第 4 步的學生端、第 9–10 步）還是要你自己做。要我來的話，回覆一聲，我會請你開放螢幕操作權限。

## 使用者

我的node和npm指令都無效

## 助理

看起來你的電腦還沒裝 Node.js，或者裝了但 PowerShell 找不到它。npm 是跟著 Node.js 一起裝的，所以兩個指令一起失效，原因多半是同一個。

**1. 先確認是不是沒裝**

在 PowerShell 打：
```powershell
Test-Path "C:\Program Files\nodejs\node.exe"
```
- 顯示 `False`：還沒裝，照第 2 步安裝。
- 顯示 `True`：已經裝了，只是 PowerShell 找不到，跳到第 3 步。

**2. 安裝 Node.js（二選一）**

- **方法 A（最簡單）：** 到 https://nodejs.org 下載標示 **LTS** 的 Windows 安裝檔（.msi）。版本號 24 以上都可以。一路按「Next」，選項維持預設就好，其中「Add to PATH」要保持勾選。
- **方法 B（用指令）：** 在 PowerShell 打：
  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

**3. 關掉所有 PowerShell 視窗，重新開一個**

這一步很重要：已經開著的視窗不會讀到新安裝的路徑，一定要開新的。然後打：
```powershell
node -v
npm -v
```
`node -v` 顯示 `v24.x.x` 或更新就成功了。如果第 1 步顯示 `True`、重開後還是找不到，重開機一次通常就會好。

**4. 如果 `node -v` 正常，但 `npm` 出現紅字「因為這個系統上已停用指令碼執行…」**

這是 PowerShell 預設不讓 npm 的啟動腳本執行。打下面這行，問你要不要變更時回答 `Y`：
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

另外，第一步的指令也會用到 `git`。順便打 `git --version` 確認一下；如果也說找不到，到 https://git-scm.com 下載安裝，選項同樣維持預設。

`node -v` 和 `npm -v` 都有出現版本號之後，就可以回到上一則的指令，從 `cd <repo>` 開始。如果還是出現錯誤，把整段紅字貼給我。

## 使用者

我執行你給的安裝指令  winget install OpenJS.NodeJS.LTS後，Test-Path "C:\Program Files\nodejs\node.exe"顯示true了，但node -v和npm -v等指令還是無法辨識，已經有重開powershell了

## 助理

node 已經裝好，只是 PowerShell 還找不到它。最常見的原因是你重開的是同一個程式裡的新分頁，例如 Windows Terminal 的新分頁或 VS Code 內建的終端機。新分頁會沿用舊的環境設定，所以要把整個程式完全關掉再開；有時候需要重開機。

**1. 先用完整路徑確認 node 能不能跑**

```powershell
& "C:\Program Files\nodejs\node.exe" -v
```
有顯示版本號（v24 以上）就代表 node 本身沒問題，問題只在 PowerShell 找不到它，繼續做第 2 步。

**2. 檢查 node 的資料夾有沒有加進系統路徑（PATH）**

```powershell
[Environment]::GetEnvironmentVariable("Path","Machine") -split ";" | Select-String nodejs
```
- **有印出 `C:\Program Files\nodejs\`：** 路徑已經設好，只是這個視窗還沒讀到。打下面這行，讓目前的視窗重新讀取：
  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  node -v
  npm -v
  ```
  這樣只對目前這個視窗有效。之後把 Windows Terminal 或 VS Code 整個關掉再開，或重開機一次，新的視窗就會自己讀到。

- **什麼都沒印出來：** 安裝程式沒有把路徑加進去，手動加上即可：
  ```powershell
  [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";C:\Program Files\nodejs", "User")
  ```
  然後把所有終端機視窗完全關掉，重開一個再打 `node -v`。

**3. `npm -v` 如果出現「已停用指令碼執行」的紅字**

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
問你要不要變更時回答 `Y`。

第 1 步的完整路徑能跑出版本號的話，照第 2 步做通常就會好。如果還是不行，把第 1、2 步顯示的內容貼給我。

## 使用者

我已經測試完畢，一切都依照他給的提示說的進行，都是正常，請幫我依他說的測試結果寫md來表達我的測試結果

## 助理

測試結果寫好了，在你電腦的 `<repo>\docs\verification\002-manual.md`，對話裡也附上了同一份 `002-manual.md`。

檔名和格式照組員在 `002-automated.md` 裡指定的（任務 T057）。13 個步驟寫成「操作／預期／結果」表格，全部打 ✅，並寫明沒有發現需要另開 issue 的問題。檔案最後有一段備註：「連結未開放」那張截圖裡替代做法重複的問題，由設計負責人另外確認，不算在你的測試結果裡。

上傳前還有兩件事：

1. **補上裝置資訊。** 電腦瀏覽器、手機型號、手機瀏覽器這三格我不知道，留了「＿＿＿」。用記事本打開填進去就好。
2. **Commit 並推到 002 分支**（不要推到 main）：
   ```powershell
   cd <repo>
   git status          # 確認目前在 002-guided-notes-import
   git add docs/verification/002-manual.md
   git commit -m "002 人工驗證紀錄（T057）：13 步驟全部通過"
   git push
   ```
   如果推不上去，可能是你沒有這個 repo 的寫入權限。那就改用組員說的另一個方法：把表格內容貼到 PR #3 底下留言。

[檔案：002-manual.md，未收錄]

## 使用者

我電腦的瀏覽器是直接在vscode裡面開的欸 這是甚麼瀏覽器
然後設計負責人應該就是我

## 助理

VS Code 裡開的是它內建的瀏覽器，叫 **Simple Browser**，核心是 Chromium（跟 Chrome 同一套）。我在報告裡填成「VS Code 內建瀏覽器（Simple Browser，Chromium 核心）」。現在只剩手機型號和手機瀏覽器兩格要你自己填。

**注意：** 我這次直接覆蓋了你電腦裡的 `002-manual.md`。如果你剛剛已經在裡面填過東西，要再填一次。

既然你就是設計負責人，我把 5 張截圖看過，在報告最後加了一節「視覺檢查」，要不要照我的判斷寫，由你決定：

- **04「連結未開放」（建議改）：** 兩個替代做法確實出現了兩次。錯誤訊息那句話裡講一次，下面的清單又列一次。原因是那句話寫在 `shared/src/protocol.ts` 的 `LINK_NOT_SHARED`，清單則寫在 `QuestionImport.tsx`。建議把訊息縮短成「無法讀取這份試算表，可以改用以下方式：」，替代做法只留在清單裡。
- **01、03（OK）：** 摘要和錯誤訊息都清楚，03 還附了列號。
- **02（OK，有小重複）：** 清單裡已經標了「題組」，下面又多一行「第 1、2 題是題組」，可以不改。
- **05（OK，有小重複）：** 題目清單是「1. 第 1 題」，編號出現兩次，可以不改。

我另外確認了程式碼：「確認後會取代現有題目」只會在系統裡已經有題目時才出現，這個行為是對的。

這些判斷如果你都同意，填好手機資訊就可以 commit。04 要不要改，記得在 PR #3 跟組員說一聲。

[圖片：截圖，未收錄]

[檔案：002-manual.md，未收錄]
