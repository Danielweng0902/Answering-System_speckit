# 壓力測試 C2：Socket.IO 負載腳本與完整報告（Kimi）

- session id：`ses_e06181eafffePvAuQ75svL4RLN`
- 日期：2026-11-20
- 模型：nchc/Kimi-K3-max
- 輪次：10

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

你是這個專案的實作者。專案是「課堂搶答系統」（TypeScript、Node 24+、Express + Socket.IO + node:sqlite），repo 在目前工作目錄。註解與文件用繁體中文。

## 背景

前一輪（C1）已經完成並 commit 在目前分支上（commit 3f8a341）：
- `e2e/load/lib/measure.mjs` — summarizeSamples／percentile（最近秩法、逾時計入分母、單調時間倒退 throw）
- `e2e/load/lib/server.mjs` — 子程序啟動正式 build 的伺服器（暫存 DATA_DIR、隨機密碼只走環境變數、health 輪詢就緒、stop() 乾淨關閉）
- `e2e/load/lib/httpClient.mjs` — 單調時鐘 HTTP 發送器
- `e2e/load/lib/socketSetup.mjs` — 最小 Engine.IO v4 polling 客戶端（老師登入＋group:create 建組別）
- `e2e/load/http.mjs` — 三情境 HTTP 負載腳本（health／join／health-full-room）＋ `--json`
- `e2e/load/tests/measure.test.mjs` — 7 項單元測試（用 `node --test`）

**先讀這些檔案再動手，沿用它們的介面，不要另起一套。**

## 這一輪：Socket.IO 負載腳本（Part C 的最後一塊）

### 1. `e2e/load/lib/socketLoad.mjs` + `e2e/load/socket.mjs`

介面：`node e2e/load/socket.mjs --url <url> --groups 50 --questions 20 --rounds 10`，也要支援短煙霧測試（例如 `--groups 5 --questions 3 --rounds 1`）。

要量到的（用 measure.mjs 的 summarizeSamples 統計）：
- **送出 → ACK**（answer:submit 的 ack 回來）
- **送出 → 必要 state 送達**：送出者自己、老師、投影、同組其他成員各自收到對應 revision 的 state。用「題目編號＋答案內容＋revision 變化」配對，**不要**把公平順位 3 秒提醒的 state 算成必要送達。
- **握手 → 第一份合法 state**（含 role 正確、revision 合理的 state）
- **切換組別 leave → 下一輪的正確身分**

情境要涵蓋：
1. 空資料冷啟 → 50 組進場 → 每題 50 組同時送（每題用**排定時間**，不要等前一次 ACK 才送下一個樣本）→ 10 輪 = 10,000 筆合法送出。
2. 已有 1,000 筆作答時的**重連**（50 組同時重連）。
3. 公平順位**開啟**時的同批搶送（要能量到「後送達但因順位勝出」的情境）。
4. 4 空長答案（每空 200 字、含 emoji）。
5. 作廢後重送（老師 answer:void → 該組重送）。
6. 倒數到期（啟動倒數後等它自然結束，量各角色收到 closed 的延遲）。

分開量 **WebSocket transport 與預設升級（polling）transport**。

### 2. 讓 HTTP 腳本的第三情境變成真的「滿房作答」

現在的 `health-full-room` 只是預先加入學生＋背景 join，**沒有反映 `answer:submit` 的 transaction 與廣播壓力**。這一輪要讓它在**作答洪流進行中**探測 health 延遲（例如每秒 25 次 health，同時背景在送答案），並在 JSON 裡去掉「尚無 Socket.IO 負載」的註記（若真的接上了）。

### 3. `docs/verification/load-test-2026-11-21.md`

一次**真實執行**的結果：
- 環境：Node 版本、CPU、DB 模式（記憶體／檔案）、初始筆數、負載機位置（同機要註明數字偏保守）。
- 每個情境的 p50/p95/p99/最大值/樣本數/錯誤率/逾時率。
- **每秒採樣伺服器 PID 的 RSS 與 CPU**（100% = 一個核心）；停止負載後 60 秒的 RSS 相對暖身後增幅。
- 對照門檻的逐項結論：HTTP p95 ≤ 100 ms／p99 ≤ 250 ms；送出 ACK 與必要 state p95 ≤ 1 秒／p99 ≤ 2 秒；一般命令錯誤率 < 0.1%；漏送／越權／錯誤順位 = 0；穩態 CPU 單核 < 80%；RSS 增幅 < 20%。
- **每種負載至少跑 3 次獨立啟動**；時間不夠就跑短階段並**明說用的是短階段**。
- 哪個指標不可信、原因、要做什麼才能可信（例如尾端延遲需要真實網路）。

### 4. 更新 `e2e/load/README.md`

補上 socket 腳本怎麼跑、量了什麼、門檻、限制。

## 限制

- **不要修改產品程式**（`server/src`、`web/src`、`shared/src`）與既有 e2e 測試；只動 `e2e/load/` 與文件。
- 不新增第三方相依套件（socket.io-client 已是 repo 的相依 ✓ 可用）。
- 密碼與 token 只從環境變數讀、不落盤、不輸出（JSON 輸出也要確認沒有敏感字樣）。
- **量不到就寫「量不到」並說明原因，不要編數字。**
- 若 `server/dist` 沒 build，先 `npm run build`（build 產物不要 commit）。
- 本機 Node 是 v26.7.0；`node --test e2e/load/tests/` 的**目錄**形式在 Node 26 會失敗，要用 `node --test 'e2e/load/tests/*.mjs'`（這點已確認，別踩）。

## 交付

在你的分支上 commit（不要 push、不要開 PR），回覆我時**只給這五項**（不要貼原始工具呼叫或大段日誌）：
1. 分支名稱與 commit 範圍
2. 新增／修改的檔案清單
3. `node --test 'e2e/load/tests/*.mjs'` 的結果
4. **實測摘要**：每個情境的 p95/p99/錯誤率/逾時率、CPU 與 RSS、對照門檻是否達標（達不到要指出第一個超標的階段）
5. 哪些指標仍然不可信、為什麼

## 助理

我會先補 Socket.IO 配對與長答案的單元測試，確認測試因模組尚未存在而失敗，再實作負載腳本。

## 助理

先補上作答／快照配對、逾時統計與長答案這些純邏輯，讓新測試轉綠。

## 助理

先檢查活動重設與開啟的階段限制，避免負載腳本誤用指令。

## 助理

接著把連線管理、正式伺服器量測、資源採樣與情境編排接起來；先補 `server.mjs` 回傳 PID 供資源採樣。

## 助理

`server.mjs` 已能提供 PID；現在加入 Socket.IO 正式客戶端、Workbook 設定與資源採樣。

## 助理

接上情境編排：建立 50 組、四空格題目、正式 WebSocket／升級模式量測，以及六種情境。

## 助理

我會先跑單元測試與語法檢查，抓到連線／resource 新的整合錯誤再修。

## 助理

目前 worktree 的 `node_modules` 是 production/hoist 狀態，少了 repo 已宣告的 `socket.io-client` dev dependency；我會先用既有 lockfile 補齊安裝，不新增任何相依。

## 助理

建置完成。現在先跑最短整合煙霧測試，驗證六種情境、1,000 筆重連與 JSON 都能實際走通。
