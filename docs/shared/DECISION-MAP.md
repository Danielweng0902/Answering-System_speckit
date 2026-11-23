# 決策對照表（D1～D25 × 我們的實作狀態）

> 給 OpenSpec 組（另一小組）的附件｜2026-11-20 初版｜**2026-11-22 更新：D18、D20 已與 OpenSpec 組確認**｜SpecKit 組整理
> 對應文件：[`FEATURE-CONTRACT.md`](./FEATURE-CONTRACT.md) v0.7（2026-11-22）

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

## 二、尚待你們確認的決策（Default 17 條：D1～D11、D15、D17、D19、D21～D23）

下表是我們的**實際做法**與**實作位置**。最下面三欄是請你們回覆的重點。

> 2026-11-22 更新：D18、D20 已被你們回覆並確認（見第三節），從這 17 條裡移出。

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
| **D18** | **老師身分** | **老師端需要密碼才能進入**（密碼由環境變數 `TEACHER_PASSWORD` 設定）；**登入狀態存 HttpOnly cookie**（`HttpOnly; SameSite=Strict; Path=/`，不設 `Max-Age`、不設 `Secure`；頁面 JS 讀不到）、可登出、**伺服器重啟後須重新登入**；未登入呼叫老師端點回 **401 `TEACHER_AUTH_REQUIRED`** | `server/src/infra/http/authRoutes.ts`、`server/src/infra/http/teacherSession.ts` | 001 |
| D19 | 重設活動 | 老師可在「已結束」後重設回到「準備中」（需再次確認）；組別保留、本次作答清空 | `server/src/app/activityCommands.ts` | 001 |
| **D20** | **數量限制** | **組名 1–30 字元且不重複、最多 100 組**；倒數 10 秒～60 分鐘；答案每格 1–200 字元 | `server/src/domain/groupRegistry.ts`、`server/src/app/countdown.ts`、`server/src/domain/answerValidation.ts` | 001／003 |
| D21 | 換組與重連 | 學生只能在「準備中」換組；重新整理或斷線重連後回到原組別與目前階段 | `server/src/app/studentCommands.ts`、`web/src/features/student/answerDrafts.ts` | 001／003 |
| D22 | 題目敘述 | 匯入時若有題目敘述則一併讀取，作答區在題號旁顯示；沒有也不影響 | `server/src/domain/guidedNotesParser.ts`、`web/src/features/student/AnswerArea.tsx` | 002／003 |
| D23 | 答案規則 | 每個空格的答案去除前後空白後 1–200 字元；**不判斷對錯** | `server/src/domain/answerValidation.ts` | 003 |

## 三、已對齊的問題（2026-11-22 回覆結果）

### 1️⃣ D18 老師身分：兩邊都要密碼 ✅ Confirmed

我們與 OpenSpec 組 2026-11-22 確認：

- 兩邊都是**單一密碼**（環境變數 `TEACHER_PASSWORD`），未設定時拒絕登入。
- 錯誤代碼兩邊一致：`WRONG_PASSWORD`（401）、`TOO_MANY_ATTEMPTS`（429，60 秒 10 次）、
  `TEACHER_PASSWORD_NOT_SET`（503）。
- **未登入呼叫老師端點的代碼統一為 `TEACHER_AUTH_REQUIRED`（401）**——OpenSpec 組原本用這個名稱，
  我們由 `UNAUTHORIZED` 改為同名，避免兩組對照時的名稱落差。
- 登入狀態一律存 **HttpOnly cookie**（我們原本放 sessionStorage，已改）；老師可**登出**；
  **伺服器重新啟動後老師須重新登入**。這三點是我們參照 OpenSpec 組 teacher-auth 規格補上的。

### 2️⃣ D20 數量限制：統一為 100 組 ✅ Confirmed

我們原本照契約寫 50 組；OpenSpec 組回報**實際有 64 組的班級**，50 組會擋到能上課的班級，
因此 2026-11-22 兩組統一為 **100 組**（我們的 FR-009、錯誤訊息、測試與壓測工具上限都已更新）。

我們的 100 組實測（本機、正式 build、WebSocket、100 組 × 20 題 × 2 輪＝4,000 筆作答）：
ACK p50 **88 ms**／p95 **158 ms**、逾時 **0%**、漏送 0、老師看板更新 p95 179 ms。
（量測方法與原始數字見 [`../verification/load-test-2026-11-22-100groups.md`](../verification/load-test-2026-11-22-100groups.md)。）

### 3️⃣ O3（結束後老師改選最終勝者）：不納入共同契約

我們的結果判定是**純函式衍生**（依送達時間與順位即時計算，不落庫），要支援「結束後改選勝者」
就得新增覆寫欄位，並連動老師看板、學生結果頁、CSV 第 8 欄與 Guided Notes 寫回；
核心需求（C1～C11）也沒有這項。**兩邊都不做**，OpenSpec 組已表示尚未實作，維持現狀即可。

### 4️⃣ 其餘 16 條 Default：我們的實作如上，有沒有要調整的？

如果照上表沒有問題，回覆「照你們的」即可，我們就把這些收成 Confirmed（契約升 v0.7）。

## 四、附帶說明（不是行為差異，但先講一聲）

- **介面呈現**：我們的介面改成「試卷／報紙」風格（視覺正本：[`design/DESIGN.md`](https://github.com/Danielweng0902/Answering-System_speckit/blob/main/design/DESIGN.md)），題號用 Q1／Q2、介面可切繁體中文／English（預設依使用者系統語言）。這些屬於**介面層**，不影響契約行為，但如果你們想對齊風格，可以直接參考那份文件。
- **契約版本**：你們那邊若有更新（例如 D18／D20 的回覆），請告訴我們，我們同步更新 `FEATURE-CONTRACT.md` 與本表。
- **我們的 repo**：https://github.com/Danielweng0902/Answering-System_speckit

## 五、資安加固（2026-11-21；要不要對齊請回覆）

這兩項是**部署面的保護**，不影響正常課堂的行為，但會改變「邊界情況」的可見行為，
所以先講一聲，看你們要不要採同樣的做法：

| # | 項目 | 我們的實際做法 | 實作位置 | 邊界行為 |
|---|---|---|---|---|
| S1 | 進場速率限制 | `POST /api/student/join` 加上「爆發額度＋持續速率」的令牌桶：同一來源瞬間可進場 1000 次、持續 30 次／分（環境變數可調） | `server/src/infra/http/rateLimiter.ts`、`server/src/infra/http/authRoutes.ts` | 超過時回 429 `TOO_MANY_ATTEMPTS`（沿用既有的錯誤代碼）。門檻遠高於 100 組班級的合法規模，正常上課不會遇到 |
| S2 | 同時在線連線數上限 | 預設 1000 條 Socket.IO 連線；超過上限時**新的**連線在握手階段被拒（HTTP 403），既有連線不受影響 | `server/src/infra/socket/connectionCap.ts` | 客戶端會自動退避重連，名額空出來就能進場。正常上課不會遇到 |

> 為什麼門檻開那麼寬：100 組班級約 400 人，而且雲端部署時**全班共用同一個對外 IP**，
> 門檻必須容得下整班同時進場，否則會擋掉自己的學生。真正要防的是「持續灌水」，
> 那是 `JOIN_RATE_LIMIT_PER_MINUTE` 這一側在擋。

說明見 [`docs/deployment.md`](../deployment.md)。
