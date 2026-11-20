# 效能與壓測的後續待辦｜2026-11-21

來源：第二驗證（GLM-5.3-max）對 PR #21 與 C1 壓測工具的覆核報告
（[`perf-second-review-2026-11-21.md`](./perf-second-review-2026-11-21.md)）。

這份是**待辦清單**，不是完成紀錄。每項標示嚴重度與「要不要做」的判斷，最後一欄是決策。

## A. 已修（PR #21）

| # | 問題 | 嚴重度 | 處置 |
|---|---|---|---|
| A1 | `express.static(webDistPath, { dotfiles: 'allow', index: false })` 讓 `web/dist` 內的 `.env`／`.DS_Store` 可被下載（回 200 與檔案內容）| 應修 | ✅ 已修：static 還原預設（不放行 dotfile、index 預設開），只有 `sendFile(indexPath, { dotfiles: 'allow' })` 放行那**一個明確檔案**（隱藏目錄的 worktree 才需要）|
| A2 | `index: false` 使 `HEAD /` 由 200 變 404（監控常以 HEAD 做健康檢查）| 建議 | ✅ 已修：還原 index 預設值，`GET /` 與 `HEAD /` 都是 200 |
| A3 | 沒有回歸測試守住上述兩點 | 應修 | ✅ 已補 `server/tests/integration/staticServing.test.ts`（dotfile 不得回傳內容、`GET /` 與 `HEAD /` 都 200）|

## B. 壓測工具待修（PR #22／`feat/009-load-test`）

| # | 問題 | 嚴重度 | 處置 |
|---|---|---|---|
| B1 | 父程序被 `kill -9`（SIGKILL）時，**子伺服器變成孤兒**（PPID=1，持續監聽所有介面，環境變數裡的 `TEACHER_PASSWORD` 無限期存活），且暫存 DB（含 token hash）殘留。exit hook 只 kill child、沒刪資料夾，而 SIGKILL 下兩者都不會執行 | 應修 | 待修：SIGINT／SIGTERM／正常結束都要刪資料夾；啟動時清理逾期的 `classroom-load-*` 暫存目錄；子程序改為可隨父程序群組退出 |
| B2 | 壓測工具**沒有「只准打本機」保護**：`--url` 接受任意主機、rate 無上限，可被拿去當 DoS 工具 | 應修 | 待修：預設只允許 loopback；非本機網址需要明確旗標才放行 |
| B3 | attach 模式對 `https://` 會 `ERR_INVALID_PROTOCOL`（`node:http` 不支援 TLS）→ 遠端 attach 時**老師密碼明文穿網路** | 應修 | 待修：改用 `node:https`，或在非 loopback 且非 https 時**明確拒絕** |
| B4 | managed 伺服器 `listen(port)` 未綁 host → 量測期間對整個 LAN 開放 | 建議 | 待修（工具端）：量測時優先綁 127.0.0.1；產品端的 host 設定屬另一件事（課堂部署需要 LAN 存取，不能直接改成只綁本機）|
| B5 | 分位數有**存活者偏差**：p95/p99 只對未逾時樣本計算，且把錯誤回應的延遲算進去 → 過載時快速回 429/500 反而讓 p95 變好看 | 建議 | 待修：分位數改以全部樣本計算（逾時以逾時上限計），或同時輸出「僅成功樣本」與「全部樣本」兩組數字並標明 |
| B6 | `health-full-room` 情境只做了 HTTP join，**沒有半條 socket**，沒觸發廣播成本 | 建議 | C2 進行中：以真實的 Socket.IO 作答負載取代 |

## C. 產品面未保護的面向（**會改變行為，需先決定**）

GLM 讀程式碼確認的現況（`server/src/infra/http/authRoutes.ts`、`server/src/infra/http/app.ts`、
`server/src/infra/http/questionRoutes.ts`、`shared/src/schemas.ts`、`server/src/index.ts`）：

**已有的防護**
- 登入速率限制：10 次失敗／60 秒，只計失敗、成功登入**不清除**，依 `request.ip`
- `express.json` 預設 100 KB；匯入 raw body 5 MB ＋ 解壓後 50 MiB
- Engine.IO `maxHttpBufferSize` 1 MB；單格答案 200 code point

**未被保護的面向**
1. **合法登入沒有上限**：每次登入都新增一筆 session，session 表可無限成長
2. **`/api/student/join` 完全沒有節流也沒有認證**：每個請求 INSERT 一筆 session（壓測工具的 join 情境就是示範）
3. **連線數與指令頻率沒有上限**：連線數只受 OS 限制
4. **`answers` 陣列在 zod 層沒有長度上限**（單格 200 字有，但一題可以送幾千個空格組合沒有上限）
5. **單請求大小限制管不住同時在途的總記憶體**
6. **速率限制的 Map 沒有上限**（每個來源一個 entry，沒有總數上限）

**要不要做？** 這幾項都會改變系統行為（例如限制 join 會影響「同一教室大量學生同時進場」），
依專案規則需要先與另一小組（OpenSpec 組）確認，且要先決定門檻。
建議排在期末專題之後，作為「部署前的硬化（hardening）」工作。

| 決策 | 選項 |
|---|---|
| C 是否要做 | ⏸ 待你決定（我傾向：做 2 與 3，1、4、6 先做觀測不擋）|
| 門檻由誰定 | 老師端的環境（教室網路、班級人數）決定 → 需要你們提供一個「一堂課最多幾組、幾人同時在線」的數字 |
