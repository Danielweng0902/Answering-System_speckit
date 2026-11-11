# Contract: HTTP API（001）

所有回應為 JSON。錯誤格式：`{ "error": { "code": "<代碼>", "message": "<給使用者看的中文訊息>" } }`。

## POST /api/teacher/login

老師登入（FR-002、FR-003；AC-001-11、12、13）。

- Request: `{ "password": string }`
- 200: `{ "token": string, "role": "teacher" }`
- 401 `WRONG_PASSWORD`：密碼錯誤
- 503 `TEACHER_PASSWORD_NOT_SET`：系統未設定老師密碼
- 429 `TOO_MANY_ATTEMPTS`：短時間內嘗試太多次
- 400 `INVALID_INPUT`：缺少或格式錯誤

## POST /api/student/join

學生選擇組別進場（FR-004、FR-011；AC-001-07、10）。

- Request: `{ "groupId": string }`
- 200: `{ "token": string, "role": "student", "groupId": string }`
- 404 `GROUP_NOT_FOUND`：組別不存在
- 400 `INVALID_INPUT`

## GET /api/health

- 200: `{ "ok": true }`。供測試與啟動檢查使用。

## 靜態檔

`npm run build` 之後，伺服器在 `/` 提供前端頁面；`/teacher`、`/student` 由前端路由處理。

## 備註

- token 是隨機字串，前端保存在 sessionStorage，連線 Socket.IO 時放在 `auth.token`。
- 伺服器 MUST NOT 在 log 中輸出密碼或 token。
