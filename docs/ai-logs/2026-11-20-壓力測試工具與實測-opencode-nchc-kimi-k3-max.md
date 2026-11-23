# 壓力測試工具與實測（opencode/nchc/Kimi-K3-max）

- session id：`ses_e0631fefcffejpFfW3NN02tZQR`
- 日期：2026-11-20
- 模型：nchc/Kimi-K3-max
- 輪次：6

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

你是這個專案的實作者。專案是「課堂搶答系統」（TypeScript、Node 24+、Express + Socket.IO + node:sqlite），repo 在目前工作目錄。文件與註解一律用繁體中文。

## 背景

前一輪已完成廣播效能最佳化（server 快照投影改為批次讀取），本輪要補上**壓力測試**（Part C）。審計報告在 `docs/verification/perf-audit-2026-11-20.md`（第 70–83 行有本輪的規格），效能最佳化報告在 `docs/verification/perf-optimization-2026-11-20.md`。

前一輪刻意**沒有**交付半套的負載產生器，理由是：「只把負載產生器寫出來但讓它重複打同一個資料庫，會產生誤導性指標」。本輪請把那個理由解決掉——**腳本必須能自己重啟伺服器、每輪換新的拋棄式 SQLite**，並給出一次可信的實測結果。

## 目標

交付一個**可重跑、可相信**的壓力測試工具，並用它跑一次，把結果寫成文件。

## 要交付的東西（放在 `e2e/load/`，與 `e2e/tests/` 的 Playwright 測試分開）

1. `e2e/load/lib/server.mjs`
   - 以子程序啟動**正式 build 的伺服器**（`npm run build` 產出的 `server/dist`，不要用 tsx 直接跑）：每次測試用新的暫存資料夾與新的 SQLite 檔，測完刪除。
   - 等待 `GET /api/health` 回 200 才算就緒；提供 `stop()` 乾淨關閉（關閉子程序、刪除暫存目錄）。
   - 老師密碼由環境變數注入（每次測試隨機產生，不要寫進檔案、不要印出來）。

2. `e2e/load/lib/measure.mjs`（共用）
   - 量測工具：用**單調時鐘**記錄「排定時間 → 完成」的延遲，輸出 p50 / p95 / p99 / 最大值 / 樣本數。
   - 逾時的樣本**要計入分母**並另外標記逾時率。
   - 不保存 token、密碼或任何憑證。

3. `e2e/load/http.mjs`
   - 介面：`node e2e/load/http.mjs --url <url> --rate 10,25,50 --seconds 120`（也支援 `--rate 25 --seconds 10` 這種短煙霧測試）。
   - 分開量三種負載：① `GET /api/health`（固定到達率）② `POST /api/student/join`（已存在的組別）③ **滿房作答時用 health 探測事件迴圈**（這是看伺服器在作答洪流下還能不能即時回應的關鍵指標）。
   - 每階固定到達率、暖身 30 秒；每輪用新的資料庫（join 會建立 session）。

4. `e2e/load/socket.mjs`
   - 介面：`node e2e/load/socket.mjs --url <url> --groups 50 --questions 20 --rounds 10`，用 socket.io-client。
   - 分開量：WebSocket transport 與預設升級（polling）transport。
   - 場景要涵蓋：空資料冷啟、已有 1,000 筆作答時的重連、從空題開始的合法送出；每題 50 組同時送、每題用**排定時間**（不要等前一次 ACK 才送下一個樣本）；另外測公平順位開關、4 空長答案、作廢重送、50 組同時重連、倒數到期。
   - 要量：送出→ACK、送出→老師/投影/同組**必要 state**送達、握手→第一份合法 state；用題目、答案與前後 revision 配對，避免把公平順位提醒算成送達。
   - 每輪清場；10 輪 = 10,000 筆合法送出；稀有事件不足 100 次要另外報最大值。

5. `e2e/load/README.md`
   - 怎麼跑、量了什麼指標、門檻、限制與注意事項（同機負載會互相搶 CPU，要註明）。

6. `docs/verification/load-test-2026-11-21.md`
   - **一次真實執行的結果**：環境（Node 版本、CPU、DB 模式、初始筆數、負載機位置）、每個情境的 p50/p95/p99/最大值/錯誤率/逾時率、CPU 與 RSS（每秒採樣伺服器 PID 的 RSS 與 CPU；100% = 一個核心）、以及對照門檻的結論。

## 驗收門檻（要逐項對照，達不到也要誠實寫出來並指出第一個超標的階段）

- HTTP：p95 ≤ 100 ms、p99 ≤ 250 ms
- 送出 ACK 與必要 state 送達：p95 ≤ 1 秒、p99 ≤ 2 秒
- 一般命令錯誤率 < 0.1%；漏送／越權／錯誤順位 = 0
- 穩態 CPU 單核平均 < 80%；停止負載後 60 秒 RSS 相對暖身後增幅 < 20%
- 正常命令與拒絕請求的錯誤率要分開統計

## 限制與誠實要求

- **不要修改產品程式**（`server/src`、`web/src`、`shared/src`）；只新增 `e2e/load/` 與文件。若發現產品有阻擋壓測的問題（例如沒有 rate limit），**寫在文件裡、不要自己改**。
- 只用**公開 API**（HTTP 與 Socket.IO 協定）產生負載，不要直接改資料庫。
- 密碼與 token 只從環境變數讀、不落盤、不輸出。
- 壓測機與伺服器盡量分離（同機時在文件註明「同機，數字偏保守」）。
- **量不到或不可信就寫「量不到」並說明原因，不要編數字**。
- 每種負載至少跑 3 次獨立啟動。
- 總執行時間請控制在合理範圍（完整 120 秒 × 多階段可能很久；可用較短階段取得方向性結果，並在文件說明用的是短階段）。

## 交付

- 在你的分支上 commit（不要 push、不要開 PR），回覆訊息給我：分支名稱、commit 範圍、**實測結果摘要**（每個情境的 p95/p99 與是否達標）、腳本怎麼跑、報告路徑。
- 若某個指標真的做不出來，明確說明並給出替代做法建議。

## 助理

我先確認既有規格、審計門檻、伺服器啟動方式與公開 API，再建立不碰產品程式的獨立壓測工具。完成後會實際跑多輪獨立啟動，核對量測數據與資源取樣，最後在分支上 commit。

## 助理

規格確認了兩個關鍵點：在途請求逾時不能丟掉，且每輪都必須換資料庫。我也會把「正常命令失敗」與「預期拒絕」分開記錄；接下來先盤點登入、匯入、作答、作廢、揭曉與重連的實際封包格式，避免壓測腳本誤配事件。

## 助理

啟動面已確認：正式 build 入口是 `server/dist/index.js`，可用 `PORT=0` 取得臨機埠、`DATA_DIR` 指到新暫存資料夾、`TEACHER_PASSWORD` 只放子程序環境。接下來讀共用 schema、快照語意與既有測試工具，然後先寫會失敗的負載工具單元測試。

## 助理

快照語意與既有審計一致：學生作答不增加全域 revision，老師且看板只送老師／投影與本組；公平提醒會再送一輪。因此送達配對必須用「題號＋組別＋唯一答案」，不能只用 revision 跳動。我接下來檢查匯入解析器的表頭／合併規則，讓負載腳本用公開 HTTP 動態產生 20 題×4 空的合法學習單。

## 助理

依測試先行，我先建立量測統計與正式伺服器生命週期的測試（此時沒有實作，預期因模組不存在而失敗）。測試會驗證：逾時樣本進分母與逾時率、p95/p99、單調時間不得倒退，以及 `status: 'timeout' } },
];

test('逾時要計入分母，並以最近秩法輸出分位數與逾時率', () => {
  const summary = summarizeSamples(otherwiseSamples);

  assert.equal(summary.sampleCount, 15);
  assert.equal(summary.successCount, 12);
  assert.equal(summary.timeoutCount, 3);
  assert.equal(summary.timeoutRate, 0.2);
  assert.equal(summary.p50Ms, 20);
  assert.equal(summary.p95Ms, 90);
  assert.equal(summary.p99Ms, 90);
  assert.equal(summary.maxMs, 90);
});

test('單調時間不得倒退；空樣本明確回 null', () => {
  assert.throws(
    () =>
      summarizeSamples([
        {
          scheduledAt: 20,
          completedAt: 10,
          status: 'ok',
        },
      ]),
    /單調時間/,
  );

  const empty = summarizeSamples([]);
  assert.equal(empty.sampleCount, 0);
  assert.equal(empty.p50Ms, null);
  assert.equal(empty.successCount, 0);
});
<|close|>argument<|sep|><|open|>argument key="path" type="string"<|sep|>e2e/load/tests/measure.test.mjs<|close|>argument<|sep|><|close|>call<|sep|><|close|>tools<|sep|>
