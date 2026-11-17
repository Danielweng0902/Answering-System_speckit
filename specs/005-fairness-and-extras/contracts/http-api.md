# Contract: HTTP（005）

005 **不新增 HTTP 端點**。理由：公平順位設定與揭曉都是「改變狀態」的操作，沿用既有的 Socket.IO 指令路徑（與 001 的 `activity:open`／`activity:close`／`activity:reset` 一致）；投影看板的資料來自既有的 Socket.IO `state` 事件，只是多一種檢視模式（[socket-events.md](./socket-events.md) 第 3 節）。

## 1. 既有端點的行為變更

| 端點 | 變更 |
|---|---|
| `GET /api/teacher/login` | 不變；登入後取得的 token 可用於投影頁（同一個老師 session） |
| `GET /api/health` | 不變 |

## 2. 靜態資源

投影頁是既有 React SPA 的一條路由（`/projector`），由既有的 Vite build 產物提供，**不需要新的後端路由**。

- 未登入時開啟 `/projector`：前端顯示「請先以老師身分登入」並提供前往 `/teacher` 的連結；同時伺服器對未登入的投影連線只給訪客級內容（無作答資訊，FR-015、FR-022）。
- 已登入但非老師：同樣視為訪客。

## 3. 權限與可見範圍

| 情境 | 結果 |
|---|---|
| 老師開啟 `/projector` | 取得 `ProjectorSnapshot`：階段、倒數、各組是否在線、是否啟用公平順位、已揭曉的結果 |
| 學生開啟 `/projector` | 訪客級內容；畫面提示需要老師身分（FR-022、AC-005-18） |
| 搶答中任何人開啟 `/projector` | **沒有**答案、沒有送出狀態、沒有送出數量（FR-015、AC-005-14、SC-004） |

這裡的「沒有」指的是**送給瀏覽器的資料本身就不包含**（伺服器過濾，R6／原則 VI），不是前端 CSS 隱藏。

## 4. 錯誤回應

005 不新增 HTTP 錯誤代碼。指令失敗沿用 Socket.IO ack 的既有格式：

```json
{ "error": { "code": "INVALID_PHASE", "message": "目前階段不能執行這個操作" } }
```
