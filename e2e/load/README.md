# 課堂搶答系統：負載量測工具（e2e/load）

只用 Node 內建模組與既有專案相依（`socket.io-client`、`exceljs`）；**不新增第三方
相依**，也不修改產品程式。伺服器固定使用 `npm run build` 後的
`server/dist/index.js`，不用 `tsx` 跑開發伺服器。

## 檔案

| 檔案                   | 用途                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `http.mjs`             | HTTP 固定到達率：health、join、真實 Socket.IO 作答洪流下的 health-full-room |
| `socket.mjs`           | Socket.IO 六種情境，分別量純 WebSocket 與純 HTTP long-polling               |
| `lib/httpClient.mjs`   | HTTP／HTTPS 發送器；以單調時鐘記錄整體 deadline                             |
| `lib/measure.mjs`      | 分位數與逾時統計；主欄位使用**全部樣本**                                    |
| `lib/server.mjs`       | 正式 build 子伺服器：暫存資料庫、訊號與孤兒清理                             |
| `lib/socketLoad.mjs`   | Socket.IO 情境、作答／state 配對、資源採樣與 HTTP 背景作答洪流              |
| `lib/socketSetup.mjs`  | 老師登入與組別建立的最小 Engine.IO polling 設定客戶端                       |
| `lib/targetSafety.mjs` | loopback-only 預設與遠端 HTTPS 強制                                         |
| `tests/*.mjs`          | `node:test` 單元與安全邊界測試                                              |

## 使用

前置：

```bash
npm ci
npm run build
node --test 'e2e/load/tests/*.mjs'
```

本機 Node **v26.7.0** 不能用「目錄」形式跑測試；請保留單引號 glob：
`node --test 'e2e/load/tests/*.mjs'`。

### Socket.IO 六種情境

```bash
# 最短完整煙霧測試：兩種 transport 各養一個正式伺服器
node e2e/load/socket.mjs --groups 5 --questions 3 --rounds 1 \
  --cooldown-seconds 0 --json socket-smoke.json

# 中等量測（每次先做 1,000 筆重建，再量 50 組重連）
node e2e/load/socket.mjs --groups 50 --questions 20 --rounds 2 \
  --cooldown-seconds 60 --json socket-medium.json

# 只跑單一 transport
node e2e/load/socket.mjs --transport websocket --groups 50 --questions 20 --rounds 2
node e2e/load/socket.mjs --transport polling --groups 50 --questions 20 --rounds 2

# attach 到既有本機伺服器；老師密碼只從環境變數讀，不輸出
TEACHER_PASSWORD=… node e2e/load/socket.mjs \
  --url http://127.0.0.1:3000 --server-pid 1234 \
  --transport websocket --groups 5 --questions 3 --rounds 1
```

參數：

- `--transport websocket|polling|both`（未給 `--url` 且未給此參數時為 both）。
- `--groups 1..50`（預設 50）、`--questions 1..100`（預設 20）、
  `--rounds >= 1`（預設 10）。
- `--timeout-ms`（預設 5000）：正式 ACK／必要 state deadline；逾時以這個
  上限計入全體分位數。
- 握手、reset、1,000 筆重建是 setup，另有較寬 deadline（握手 30 秒、
  setup 120 秒），不代表門檻是這些數字；正式樣本仍用 `--timeout-ms`。
- `--burst-interval-ms`（預設 250）：同一輪每題送出的排程間隔。
- `--cooldown-seconds`（預設 60）：停止負載後繼續採樣 RSS。
- `--json`：輸出不含密碼與 token；寫檔前會掃描並拒絕疑似憑證欄位。

六種情境：

1. **冷啟作答**：`groups × questions × rounds`，量 ACK 與四路必要 state。
2. **1,000 筆重建＋重連**：先建立 50 組 × 20 題，再依序重接 50 名送出者，
   量「握手 → 第一份合法 state」。注意：目前 setup 的 1000 筆用 WebSocket
   產生，量測 transport 才用該次指定的 transport；JSON 的
   `seedSetupTransport` 明確標記。
3. **公平順位**：第一組先贏一題，第二組在批次窗口內較晚送出但應因較少
   成功題數取勝；錯誤順位必須是 0。
4. **四空長答案**：每空恰好 200 個 Unicode code point，含 emoji。
5. **作廢後重送**：同組同題第一次送出、老師作廢、再次送出。
6. **倒數自然到期**：開 10 秒倒數，量各角色在到期時間後收到 `phase: closed`。

作答與 state 的配對依「題號＋完整答案內容＋ revision」進行，不依賴封包
先後；學生還要求 `groupId` 對得上自己。四路必要 state 是送出者、同組
第二位學生、老師、投影。公平順位的 3 秒提醒只視為同一 revision 的重複
通知，不當成第一次必要送達。

### HTTP 三種情境

```bash
# 短煙霧
node e2e/load/http.mjs --rate 5 --seconds 2 --warmup 1 --students 5

# 三個 rate、50 名學生的 Socket.IO 作答洪流
node e2e/load/http.mjs --rate 10,25,50 --seconds 10 --warmup 2 \
  --students 50 --json http-load.json

# attach（預設仍只准 loopback）
TEACHER_PASSWORD=… node e2e/load/http.mjs --url http://127.0.0.1:3000 \
  --rate 10 --seconds 10
```

第三種 `health-full-room` 會以 WebSocket 連接老師、投影與 `--students`
名學生，同時跑真實 `answer:submit`；不是預先 join 或只打 join 的背景流。
`--students 0` 沒有作答洪流，第三情境明確標記「量不到」。

## 安全邊界

### 只准量測本機

`--url` 預設只允許 loopback：`127.0.0.0/8`、`localhost`、IPv4-mapped
`::ffff:127/8` 與 `::1`。其他主機會在發送任何量測請求前失敗。要量測
權責內的遠端目標，必須明確加 `--allow-remote`，而且遠端只接受 HTTPS：

```bash
# 可放行（仍請確認你有權對該目標產生負載）
TEACHER_PASSWORD=… node e2e/load/socket.mjs \
  --url https://example.invalid --allow-remote \
  --transport websocket --groups 5 --questions 3 --rounds 1

# 會明確拒絕：非 loopback 的 HTTP 會讓密碼與 token 明文穿網路
node e2e/load/http.mjs --url http://example.com --allow-remote
```

這是為了避免工具被拿去對陌生主機產生大量連線或請求。`--url` 內嵌帳號
密碼也會拒絕。

### 暫存資料與 SIGKILL 限制

`lib/server.mjs` 每次建立新的 `classroom-load-*` DATA_DIR：

- 正常 `stop()`：先 SIGTERM，逾時後 SIGKILL，再刪目錄；
- SIGINT／SIGTERM：負載主程序會先等 `stop()`，再以正確 exit code 離開；
- 未預期正常 exit：同步清理子程序與目錄；
- **SIGKILL（`kill -9`）不能捕捉，所以當下無法保證刪出子程序或 SQLite**。

為限制 SIGKILL 後遺症，DATA_DIR 內只放 `load-owner.json`（父／子 PID；
沒有密碼、token 或 hash 原文）。下次啟動 managed server 會清理超過
30 分鐘、且父 PID 已不活躍的 classroom-load-* 目錄；子 PID 仍活著時先送
SIGTERM。若伺服器仍在管理程序裡執行（父 PID 存在），即使目錄已存在較久
也不會被清掉。舊版沒有 owner marker 的逾期目錄只能刪檔，無法可靠得知
哪個子程序要終止。

### 憑證

老師密碼每次由腳本在記憶體用 CSPRNG 建立（managed），或讀
`TEACHER_PASSWORD`（attach）。所有密碼與 token 都只留 process 記憶體，
不進 README、console、JSON 或 git。`startServer` 將完整父 process env 傳給
子伺服器；別以 unmanaged 本機 `.env` 代用量測伺服器的密碼。正式 build
目前對所有介面監聽（產品部署需求），量測時只把 URL 固定在 127.0.0.1；
如需完全不對 LAN 開放，請在網路層另行限制，這一輪不改產品程式。

## 統計口徑

每個樣本都是 `{scheduledAt, completedAt, status}`；時間來自
`performance.now()` 單調時鐘。`scheduledAt` 是實際送出前，不取 planned
到達時間；`completedAt` 是完整收到回應／ACK／target state 的時間。

- 主要 `p50Ms/p95Ms/p99Ms/maxMs` 一律以**全部樣本**算；逾時樣本以對應
  deadline 作保守下界，避免「只看未逾時樣本」的存活者偏差。
- `summary.completedOnly` 另存僅完成樣本的同一組數字，僅供診斷，
  門檻對照不使用它。
- 逾時後才到達的 state 不補記成功，仍視為逾時。
- `commandErrorRate` 不含 ACK `TIMEOUT`（它已列在 timeoutRate）。
- HTTP `status:'ok'` 只代表未逾時；非 200 或連線錯誤由 `errorRate` 計。
- Socket 漏送是四路必要 state 中逾時的樣本總數；越權與錯誤順位必須是 0。

門檻口徑固定為：

| 指標                                  | 門檻                                                      |
| ------------------------------------- | --------------------------------------------------------- |
| HTTP health / join / health-full-room | 全體 p95 ≤ 100 ms；p99 ≤ 250 ms                           |
| Socket `answer:submit` ACK            | 全體 p95 ≤ 1000 ms；p99 ≤ 2000 ms                         |
| Socket 送出 → 四路必要 state          | 全體 p95 ≤ 1000 ms；p99 ≤ 2000 ms                         |
| 錯誤率（不含逾時）                    | < 0.1%                                                    |
| 越權／錯誤順位                        | 0；必要 state 漏送也是 0（逾時會在 timeoutRate 同步呈現） |
| 伺服器 CPU                            | 每秒樣本 p95 < 80%（100%=單一核心），穩態平均值供對照     |
| 停止負載 60 秒後 RSS                  | 相對暖身結束當下增幅 < 20%                                |

資源以每秒 `ps -p <pid> -o rss= -o time=` 取 server PID。CPU 穩態是
（累計 CPU 秒差 ÷ 牆鐘秒差），100% 是一核心；每秒 CPU 分位數由兩次
採樣差分。RSS 基準是暖身結束當下，不取伺服器啟動時較低的平均值。
JSON 保留 `capturedAt/rssBytes/cpuSeconds` 每秒原始樣本。

## 限制

- 負載機與被測伺服器在同一台機器 loopback；數字不含教室 LAN/Wi-Fi。
- `createGroupViaTeacherSocket` 只有 Engine.IO polling 的最小設定客戶端，
  不是正式量測通道。
- 1,000 筆種子是 setup；為免 polling 的 setup 廣播積壓而失真，種子固定
  用 WebSocket 產生，再切回目標 transport。正式冷啟、公平、長答案、
  作廢、倒數與 50 名重連握手都仍用本輪目標 transport。
- 50 組「重連」是依序連接以避免一次造成 50×50 presence 風暴；它不是
  真正同刻 50 條全部發起。報告應逐條寫明。
- 執行一輪不算穩定基準。正式報告若只有一趟中等負載，就必須標註
  「不能宣稱長期穩定性」；若時間不足，只能跑短階段重複，也要說明所用
  規模。

## 測試

```bash
node --test 'e2e/load/tests/*.mjs'
```

測試覆蓋：

- 全體樣本與 completedOnly 的分位數；
- 作答／state 配對、提醒排除、越權、逾時晚到不能補記成功；
- WebSocket／polling transport 分離；
- HTTPS request 不再拋 `ERR_INVALID_PROTOCOL`；
- 預設 loopback-only、遠端 HTTPS 強制；
- SIGKILL 後逾期 owner marker 的最佳清理；
- `ps` 時間格式跨 `mm:ss`／`hh:mm:ss`／日數解析。
