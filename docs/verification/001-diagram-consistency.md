# 001 圖表與程式一致性核對

核對範圍為 plan.md「圖表與模組對應」兩張表、001 的四張 PlantUML 圖，以及目前 `shared/src`、`server/src`、`web/src`。所有下列檔案均存在；結果只描述圖與程式，未修改程式。

| 圖中項目 | 程式位置 | 結果 | 差異說明 |
|---|---|---|---|
| 元件：身分驗證 (Access Control) | `server/src/app/access.ts`、`server/src/infra/http/authRoutes.ts` | 已修正圖 | 已標註兩個計畫模組；另標出處理離組的 `server/src/app/studentCommands.ts`。HTTP 進場直接以 `groupRepo.ts#getGroupById` 查組別，不是呼叫 domain 的組別名冊函式。 |
| 元件：組別管理 (Group Registry) | `server/src/domain/groupRegistry.ts`、`server/src/app/groupCommands.ts` | 已修正圖 | 模組齊全且依賴方向正確；圖補上經 `commandRouter.ts` 進入三個 `group:*` 指令，以及寫入 repository、刪組後呼叫 `invalidateGroup` 的路徑。 |
| 元件：活動階段管理 (Activity Phase Manager) | `server/src/domain/activity.ts`、`server/src/app/activityCommands.ts` | 已修正圖 | 模組齊全；圖補上三個 `activity:*` 指令、`open/close/reset`、repository 與倒數 callback。至少一組的檢查實際使用 `countGroups()`。 |
| 元件：倒數計時 (Countdown) | `server/src/app/countdown.ts` | 已修正圖 | `createCountdown`、`schedule/cancel` 存在；圖標明由 `index.ts` 接至 `onOpened/onClosed` 與 `closeExpiredActivity`，到期只有改變狀態才由組裝層廣播。 |
| 元件：狀態同步 (State Broadcaster) | `server/src/app/snapshot.ts`、`server/src/infra/socket/broadcaster.ts` | 已修正圖 | 模組齊全；另標出實際計算在線人數及更新 revision 的 `server/src/app/presence.ts`。快照依身分建立，事件為 `state` 與 `session:invalid`。 |
| 元件：活動資料儲存 (Activity Store) | `server/src/infra/db/database.ts`、`activityRepo.ts`、`groupRepo.ts`、`sessionRepo.ts` | 已修正圖 | 圖由 `db/*.ts` 展開成四個實際檔案；各用例直接經 repository 存取 SQLite。 |
| 元件：老師端畫面 | `web/src/features/teacher/TeacherPage.tsx`、`TeacherLogin.tsx`、`GroupManager.tsx`、`PhaseControl.tsx` | 已修正圖 | 目錄及主要畫面元件皆存在，已補入圖；登入走 HTTP，管理指令走 Socket.IO。 |
| 元件：學生端畫面 | `web/src/features/student/StudentPage.tsx`、`GroupPicker.tsx` | 已修正圖 | 元件皆存在，已補入圖；選組畫面直接消費 `state.groups`，沒有獨立的「取得組別清單」HTTP 端點。 |
| 類別：活動、階段 | `server/src/domain/activity.ts`：`ActivityState`、`ActivityTransition`；`server/src/infra/db/activityRepo.ts`：`Activity`；`shared/src/protocol.ts`：`Phase` | 已修正圖 | 圖已分開列出 domain 狀態與持久化型別的全部主要欄位，並保留 `open/close/reset` 純函式關係。計畫所列型別名稱與位置差異見下節。 |
| 類別：組別、組別名冊 | `server/src/domain/groupRegistry.ts`：`GroupRegistryEntry`、`GroupRegistryResult`、三個名冊函式；`server/src/infra/db/groupRepo.ts`：`Group` | 已修正圖 | `id/name/position` 一致；圖不再虛構 `GroupRegistry` 類別，並標明名冊其實是 `GroupRegistryEntry[]`。 |
| 類別：參與者、身分種類 | `server/src/app/access.ts`：`AccessIdentity` 及其三種 variant；`shared/src/protocol.ts`：`Role`；`server/src/infra/db/sessionRepo.ts`：`Session`、`SessionRole` | 已修正圖 | 圖以 `AccessIdentity` 表示連線參與者並另列持久化 `Session`；補上 `guest`、`groupId` 條件，並說明在線狀態不是 Session 欄位。 |
| 類別：活動狀態快照 | `shared/src/protocol.ts`：`SnapshotBase`、`GuestSnapshot`、`StudentSnapshot`、`TeacherSnapshot`、`Snapshot`、`GroupSummary` | 已修正圖 | 圖補齊 `revision/serverNow/phase/countdownEndsAt/groups`，以及學生專用 `myGroupId`、老師專用 `presence`，與 union 定義一致。 |

## 修改了哪些圖、為什麼

- **component**：保留八個中文概念名及原標題，逐一補上實際檔案；新增實際存在的 `commandRouter.ts` 指令路由，將 HTTP、Socket.IO、repository、broadcast callback 的方向改成程式真正路徑。actor 與所有新增 alias 均使用英數。
- **class**：以實際 enum 值、型別名稱及欄位取代純概念欄位。加入持久化 `Activity`、`Group`、`Session` 是為了區分 domain、身分解析與資料庫型別，沒有把函式庫或概念名稱冒充成不存在的類別。
- **seq-join**：改成先由 Socket.IO 收到完整 `state`，再走 `POST /api/student/join`；重連區分有效學生、群組已刪除與無效 token。事件名、`GROUP_NOT_FOUND`、token 處理及 presence revision 流程均對齊程式。
- **seq-open-close**：補上 `commandRouter.ts` 的「zod → 身分 → 用例」順序、`activity:open/close` 與 Ack；只有 `changed=true` 才保存及增加 revision，並呈現倒數排程、取消、到期廣播，以及手動冪等操作仍由路由廣播的現況。

## 未解決的差異

以下三項是 **plan.md 對應文字與程式** 的差異。已用實際型別修圖，程式不改；監督者已同步更新 plan.md 的類別對應表，三項皆已解決：

1. 計畫把活動對應為 `Activity`（domain／shared），實際 domain 型別是 `ActivityState`；`Activity` 位於 `activityRepo.ts`，shared 只定義 `Phase`。
2. 計畫列出 `Group`、`GroupRegistry` 都在 domain；實際 domain 只有 `GroupRegistryEntry` 陣列與純函式，`Group` 位於 `groupRepo.ts`，程式沒有 `GroupRegistry` 型別。
3. 計畫列出 `Session`、`Role` 都在 `access.ts`；實際 `access.ts` 匯出 `AccessIdentity` 等身分 variant，`Session` 在 `sessionRepo.ts`，`Role` 在 `shared/src/protocol.ts`。在線狀態也不是 `Session` 欄位，而是 broadcaster 的記憶體 Map。

各計畫元件的模組路徑都存在；本次核對未發現需要更動程式行為的差異。

---

PNG 已由監督者以 `scripts/render-diagrams.sh` 產生，`scripts/check-diagrams.sh` 通過。元件圖與類別圖標題由「概念層／領域物件」改為「技術層」。
