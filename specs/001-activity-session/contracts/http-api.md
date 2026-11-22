# Contract: HTTP API（001）

所有回應為 JSON。錯誤格式：`{ "error": { "code": "<代碼>", "message": "<給使用者看的中文訊息>" } }`。

## POST /api/teacher/login

老師登入（FR-002、FR-002a；AC-001-11、12、13、30）。

- Request: `{ "password": string }`
- 200: `{ "role": "teacher", "authenticated": true }`，並以 `Set-Cookie` 發出登入狀態
  （`classroom.teacher.session=<token>; HttpOnly; SameSite=Lax; Path=/`）
- 401 `WRONG_PASSWORD`：密碼錯誤
- 503 `TEACHER_PASSWORD_NOT_SET`：系統未設定老師密碼
- 429 `TOO_MANY_ATTEMPTS`：短時間內嘗試太多次
- 400 `INVALID_INPUT`：缺少或格式錯誤

> 2026-11-22（D18 與 OpenSpec 組對齊）：登入狀態改由 **HttpOnly cookie** 保存，
> 回應本文**不含憑證**，頁面 JavaScript 讀不到 token。

## GET /api/teacher/session

查詢老師登入狀態（FR-002b；AC-001-33）。**不需登入即可呼叫**。

- 200: `{ "authenticated": boolean, "passwordConfigured": boolean }`
  - `authenticated`：目前的 cookie 是否仍是有效的老師登入狀態
  - `passwordConfigured`：伺服器是否已設定老師密碼

## POST /api/teacher/logout

老師登出（FR-002b；AC-001-32）。

- Request: 無
- 200: `{ "ok": true }`，並清除 cookie（`Max-Age=0`）
- 沒有登入狀態時也回 200（冪等）

## POST /api/student/join

學生選擇組別進場（FR-004、FR-011；AC-001-07、10）。

- Request: `{ "groupId": string }`
- 200: `{ "token": string, "role": "student", "groupId": string }`
- 404 `GROUP_NOT_FOUND`：組別不存在
- 429 `TOO_MANY_ATTEMPTS`：同一來源的進場請求過多（速率限制；門檻可由環境變數調整，預設遠高於一堂課的合法規模）
- 400 `INVALID_INPUT`

## GET /api/health

- 200: `{ "ok": true }`。供測試與啟動檢查使用。

## 靜態檔

`npm run build` 之後，伺服器在 `/` 提供前端頁面；`/teacher`、`/student` 由前端路由處理。

## 老師端點的身分檢查

所有老師端點（匯入學習單、匯出結果、寫回試算表）在**檢查階段與內容之前**先檢查登入：

- 沒有登入狀態，或登入狀態已失效 → 401 `TEACHER_AUTH_REQUIRED`
- 已登入但不是老師（學生的 session） → 403 `FORBIDDEN`

憑證來源：先讀 HttpOnly cookie（瀏覽器路徑），再看 `Authorization: Bearer <token>`
（指令列工具與整合測試）。兩者都只在伺服器端處理。

## 備註

- 學生的 token 是隨機字串，前端保存在 sessionStorage，連線 Socket.IO 時放在 `auth.token`。
- 老師的登入狀態是 HttpOnly cookie（2026-11-22 D18）：Socket.IO 握手時不帶 token，
  伺服器改從 cookie 判定老師身分。
- 伺服器重新啟動時，所有老師的登入狀態失效（FR-002d）；學生的 session 不受影響。
- 伺服器 MUST NOT 在 log 中輸出密碼或 token。
