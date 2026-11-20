# 決策對照表（D1～D25 × 我們的實作狀態）

> 給 OpenSpec 組（另一小組）的附件｜2026-11-20｜SpecKit 組整理
> 對應文件：[`FEATURE-CONTRACT.md`](./FEATURE-CONTRACT.md) v0.6（2026-11-17）

## 這份表在做什麼

契約裡的每條決策（D1～D25）目前有兩種狀態：

- **Confirmed**：兩組已同意，我們兩邊都照著實作。
- **Default**：只有我們這一邊照著實作（我們的預設值），**你們那邊可能用不同做法**。

這張表把「Default」那 18 條逐一列出**我們的實作位置與實際行為**，讓你們可以直接比對：
有落差的地方，要嘛我們跟你們對齊，要嘛你們回覆後我們把契約收成 Confirmed。

> 請直接看這張表就好，不用逐條從程式碼裡找。

## 一、已確認的決策（7 條，兩組已同意，我們都已實作）

| # | 決策 | 同意狀態 | 我們的實作 |
|---|---|---|---|
| D12 | 匯出回 Guided Notes（直接串接線上 Google Sheets 讀寫）| Confirmed（2026-11-17 依助教說明改版）| 讀取：`server/src/app/importService.ts`；寫回：`server/src/app/guidedNotesWriteBack.ts`；對應子功能 006 |
| D13 | CSV 欄位（8 欄含「公平順位」）| Confirmed（2026-11-17）| `server/src/app/csvBuilder.ts`；對應子功能 004／005 |
| D14 | 公平順位（老師選用、預設不啟用、3 秒同批、成功題數少者優先）| Confirmed（2026-11-17）| `server/src/domain/answerSettlement.ts`、`server/src/app/fairnessSettler.ts`；對應子功能 005 |
| D16 | 投影看板（搶答中零作答資訊、逐題揭曉依題號順序）| Confirmed（2026-11-17）| `server/src/app/snapshot.ts`（`createProjectorSnapshot`）、`web/src/features/projector/`；對應子功能 005 |
| D24 | 老師作廢 | Confirmed（2026-11-13）| `server/src/app/answerCommands.ts`（`answer:void`）；對應子功能 003 |
| D25 | 公平順位下的作廢重判與連鎖重算 | Confirmed（2026-11-17）| `server/src/domain/answerSettlement.ts`；對應子功能 005 |
| E3／E4 | 公平順位機制、倒數計時與投影看板 | Confirmed（2026-11-17）| 倒數：`server/src/app/countdown.ts`；對應子功能 001／005 |

## 二、尚待你們確認的決策（Default 18 條）

下表是我們的**實際做法**與**實作位置**。最下面三欄是請你們回覆的重點。

| # | 決策 | 我們的實際做法 | 實作位置 | 對應子功能 |
|---|---|---|---|---|
| D1 | 搶答方式 | 整場開放：老師開啟後所有題目同時可作答，每題各自比誰最快；結束後才公布結果 | `server/src/app/activityCommands.ts`、`server/src/app/answerSettlement.ts` | 001／003 |
| D2 | 活動階段 | `準備中` → `搶答中` → `已結束`，只能往前，由老師操作；倒數結束視同老師結束 | `server/src/domain/activity.ts`、`server/src/app/activityCommands.ts` | 001 |
| D3 | 學生身分 | 以組為單位進場，選組後進入；同組可多人同時在線 | `server/src/app/studentCommands.ts`、`server/src/domain/groupRegistry.ts` | 001 |
| D4 | 誰能送出 | 同組任一人都能送出；某題送出後全組該題鎖定並同步顯示「已送出」 | `server/src/app/answerCommands.ts` | 003 |
| D5 | 能否修改 | 已送出的答案不能修改（只有老師作廢後該組能重送）| `server/src/app/answerCommands.ts` | 003 |
| D6 | 一題多組送出 | 每組每題可送一次，全部記錄並依伺服器收到順序排順位，第 1 順位為搶答成功 | `server/src/domain/answerRanks.ts`、`server/src/app/answerSettlement.ts` | 003 |
| D7 | 搶答中學生可見範圍 | 只看到自己組的答案與送出狀態；看不到其他組是否已送出、也看不到某題是否已被搶走 | `server/src/infra/socket/broadcaster.ts`（作答變更只送老師與該組）、`server/src/app/answerProjections.ts` | 003 |
| D8 | 結束後學生可見範圍 | 每題的搶答成功組別與其答案，以及自己組在各題的順位 | `server/src/app/snapshot.ts`、`web/src/features/student/StudentResults.tsx` | 003 |
| D9 | 老師可見範圍 | 搶答中即時看到每題各組的送出狀態、答案與順位 | `web/src/features/teacher/AnswerBoard.tsx` | 003 |
| D10 | 題組 | 一個題組算一題：所有空格都填了才能送出，整題一起比順位 | `server/src/domain/guidedNotesParser.ts`、`server/src/app/answerCommands.ts` | 002／003 |
| D11 | 匯入 | 貼 Google Sheets 連結或上傳 xlsx；依表頭「題號／題目／作答」與合併範圍辨識題目與空格；匯入後顯示摘要讓老師確認 | `server/src/app/importService.ts`、`server/src/domain/importValidator.ts` | 002 |
| D15 | 倒數計時 | 老師開啟時可選是否設定時間；範圍 10 秒～60 分鐘；時間到自動結束 | `server/src/app/countdown.ts`、`server/src/app/activityCommands.ts` | 001 |
| D17 | 組別建立 | 老師在準備階段設定組數與組名（可新增／改名／刪除）| `server/src/app/groupCommands.ts` | 001 |
| **D18** | **老師身分** | **老師端需要密碼才能進入**（密碼由環境變數 `TEACHER_PASSWORD` 設定）；同一組同學共用一個密碼 | `server/src/infra/http/authRoutes.ts` | 001 |
| D19 | 重設活動 | 老師可在「已結束」後重設回到「準備中」（需再次確認）；組別保留、本次作答清空 | `server/src/app/activityCommands.ts` | 001 |
| **D20** | **數量限制** | **組名 1–30 字元且不重複、最多 50 組**；倒數 10 秒～60 分鐘；答案每格 1–200 字元 | `server/src/domain/groupRegistry.ts`、`server/src/app/countdown.ts`、`server/src/domain/answerValidation.ts` | 001／003 |
| D21 | 換組與重連 | 學生只能在「準備中」換組；重新整理或斷線重連後回到原組別與目前階段 | `server/src/app/studentCommands.ts`、`web/src/features/student/answerDrafts.ts` | 001／003 |
| D22 | 題目敘述 | 匯入時若有題目敘述則一併讀取，作答區在題號旁顯示；沒有也不影響 | `server/src/domain/guidedNotesParser.ts`、`web/src/features/student/AnswerArea.tsx` | 002／003 |
| D23 | 答案規則 | 每個空格的答案去除前後空白後 1–200 字元；**不判斷對錯** | `server/src/domain/answerValidation.ts` | 003 |

## 三、想請你們回覆的三件事

### 1️⃣ D18 老師身分：要不要密碼？

我們是**要密碼**（`TEACHER_PASSWORD` 環境變數）。聽說你們目前只能 loopback 開啟。

助教的說明提到要在**自己雲端的試算表**上工作，遠端講課時沒有密碼就開不了老師端——我們建議兩邊都要密碼。請回覆你們的作法，我們對齊。

### 2️⃣ D20 數量限制：組數上限 50 還是 100？

契約寫 **最多 50 組**，我們照 50 實作（`GROUP_LIMIT_REACHED`）。你們目前是 100，請回覆要統一成哪個。

### 3️⃣ 其餘 16 條 Default：我們的實作如上，有沒有要調整的？

如果照上表沒有問題，回覆「照你們的」即可，我們就把這些收成 Confirmed（契約升 v0.7）。

## 四、附帶說明（不是行為差異，但先講一聲）

- **介面呈現**：我們的介面改成「試卷／報紙」風格（視覺正本：[`design/DESIGN.md`](https://github.com/Danielweng0902/Answering-System_speckit/blob/main/design/DESIGN.md)），題號用 Q1／Q2、介面可切繁體中文／English（預設依使用者系統語言）。這些屬於**介面層**，不影響契約行為，但如果你們想對齊風格，可以直接參考那份文件。
- **契約版本**：你們那邊若有更新（例如 D18／D20 的回覆），請告訴我們，我們同步更新 `FEATURE-CONTRACT.md` 與本表。
- **我們的 repo**：https://github.com/Danielweng0902/Answering-System_speckit
