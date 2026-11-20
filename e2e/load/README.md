# 課堂搶答系統：負載量測工具（e2e/load）

只用 Node 內建模組（`node:http`、`node:child_process`、`node:fs/promises`、
`node:test`、`node:perf_hooks`），**無第三方相依**，也不修改產品程式。
本輪只有 HTTP 負載；Socket.IO 作答負載腳本留到下一輪。

## 檔案

| 檔案                     | 用途                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `lib/measure.mjs`        | `summarizeSamples`／`percentile`：最近秩法分位數、逾時率                                |
| `lib/server.mjs`         | 子程序啟動正式 build 伺服器（新的暫存 DATA_DIR、隨機老師密碼）                          |
| `lib/httpClient.mjs`     | 以單調時鐘量測的 HTTP 發送器（整體 deadline 逾時）                                      |
| `lib/socketSetup.mjs`    | 設定用：老師登入、以 Socket.IO `group:create` 建組別（Engine.IO v4 polling 最小客戶端） |
| `http.mjs`               | 固定到達率負載腳本（health／join／滿房 health 探測）                                    |
| `tests/measure.test.mjs` | 量測統計的 `node:test` 單元測試                                                         |

## 使用

前置：`npm install` 且 `npm run build`（需要正式 build 的 `server/dist`）。

```bash
# 短煙霧測試：每個情境暖身 2 秒、量測 10 秒、25 req/s、預先加入 20 名學生
node e2e/load/http.mjs --rate 25 --seconds 10 --warmup 2 --students 20

# 完整量測：三個到達率依序跑，結果存 JSON
node e2e/load/http.mjs --rate 10,25,50 --seconds 120 --warmup 30 --json load-result.json

# 量測既有伺服器（需 TEACHER_PASSWORD 環境變數才能跑 join／滿房情境）
TEACHER_PASSWORD=… node e2e/load/http.mjs --url http://127.0.0.1:3000 --rate 25 --seconds 10
```

參數：`--rate`（預設 `10,25,50`）、`--seconds`（預設 120）、`--warmup`
（預設 30）、`--timeout-ms`（預設 5000，單次請求整體 deadline）、
`--students`（預設 200，滿房情境的預先加入人數）、`--json <路徑>`、
`--url`（不給則由腳本啟動全新伺服器）。

三種情境（每個 rate 依序各跑一次，暖身＋量測視窗分開）：

1. **health**：`GET /api/health`，固定到達率。
2. **join**：`POST /api/student/join`，對量測前以**老師 API**（登入＋
   Socket.IO `group:create`）建立的已存在組別。
3. **health-full-room**：預先加入 `--students` 名學生後，用 health 探測
   事件迴圈；同時有同速率的背景 join 流量（不納入探測樣本）。
   **限制**：本輪沒有 Socket.IO 作答負載，「滿房作答」目前以「滿房＋背景
   join」代替，health 數字**尚未反映真實作答壓力**。

attach 模式若未提供 `TEACHER_PASSWORD`，只有 health 情境會執行，join 與
滿房情境在 JSON 的 `skipped` 標記「量不到」及原因。

## 量測定義

- 樣本 `{ scheduledAt, completedAt, status }` 來自 `performance.now()`
  單調時鐘；`scheduledAt` 是**實際送出前**的時間，`completedAt` 是回應
  完整收到的時間。
- **逾時計入分母**（`sampleCount`），並給 `timeoutCount`／`timeoutRate`；
  分位數只對完成樣本算。`p95 = 第 ceil(0.95 × n) 小`（最近秩法）。
- `status:'ok'` 只代表未逾時。**錯誤率**由 `http.mjs` 另外計：
  連線失敗或非 200 回應 ÷ 樣本數（HTTP 狀態分佈一併輸出，方便判讀）。
- 排程採開放迴路固定到達率、絕對時間校正的 `setTimeout`。若負載機事件
  迴圈來不及排程，下一次到達會立即補送（catch-up），不跳過到達；高延遲
  時請同時看 `maxMs` 與樣本數是否符合 `rate × seconds`。
- 連線使用 keep-alive agent（每情境獨立、結束時 destroy），不計每次
  TCP 握手成本；量到的是同一機器 loopback 的伺服器延遲。

## 單元測試

```bash
node --test 'e2e/load/tests/*.mjs'
```

注意：本機 Node **v26.7.0** 執行 `node --test e2e/load/tests/`（目錄形式）
會把目錄誤當模組入口而拋 `MODULE_NOT_FOUND`，改用等價的 glob 形式即可。

## 安全約定

- 老師密碼每次由 `http.mjs` 在記憶體隨機產生，只經子程序環境變數傳遞
  （managed 模式）或讀自 `TEACHER_PASSWORD` 環境變數（attach 模式）；
  取得 token 後即丟棄密碼參照。console 與 JSON 輸出都不含密碼與 token。
- 量測用暫存資料夾在 `stop()` 時刪除，不會留下 SQLite 檔。
