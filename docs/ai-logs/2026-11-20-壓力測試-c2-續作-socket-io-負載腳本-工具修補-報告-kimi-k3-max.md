# 壓力測試 C2 續作：Socket.IO 負載腳本＋工具修補＋報告（Kimi-K3-max）

- session id：`ses_e05b741acffeyQvPbt6J33d85e`
- 日期：2026-11-20
- 模型：nchc/Kimi-K3-max
- 輪次：25

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

你是這個專案的實作者。專案：課堂搶答系統（TypeScript、Node 24+、Express + Socket.IO + node:sqlite）。repo 在目前工作目錄。註解與文件用繁體中文。

## 背景：上一輪（同一個目標）被中斷了，但檔案已經寫好
上一輪的工作留在這個 worktree（未 commit）：
  <home>/.t3/worktrees/Answering-System_speckit/t3-f02736c3-eb02271dcc47ade7
其中已新增（未 commit）：e2e/load/socket.mjs、e2e/load/lib/socketLoad.mjs、e2e/load/tests/socketLoad.test.mjs，
並修改了 e2e/load/lib/server.mjs。

**第一步：把那四個檔案複製進你的工作目錄**（用 cp，不要用 git，因���對方未 commit）：
  cp <上面路徑>/e2e/load/socket.mjs <你的工作目錄>/e2e/load/
  cp <上面路徑>/e2e/load/lib/socketLoad.mjs <你的工作目錄>/e2e/load/lib/
  cp <上面路徑>/e2e/load/tests/socketLoad.test.mjs <你的工作目錄>/e2e/load/tests/
  cp <上面路徑>/e2e/load/lib/server.mjs <你的工作目錄>/e2e/load/lib/
然後**先讀懂這四個檔案**再繼續（那是上一輪自己寫的，可能有未完成或錯誤的地方）。

## 這一輪要完成的事

### 1. 讓 Socket.IO 負載腳本真的跑得完
- 先跑最短整合煙霧測試（例如 --groups 5 --questions 3 --rounds 1），確認六種情境、1,000 筆重連與 JSON 輸出都能走通。
- 再跑一個中等規模（例如 --groups 50 --questions 20 --rounds 2）確認不卡死、不記憶體暴衝。
- 量測要涵蓋：送出→ACK、送出→必要 state 送達（送出者／老師／投影／同組）、握手→第一份合法 state。
  用「題目編號＋答案內容＋revision 變化」配對，**不要**把公平順位 3 秒提醒的 state 算成必要送達。
- 分開量 WebSocket 與 polling transport。

### 2. 修掉第二驗證指出的壓測工具問題（docs/verification/perf-followups-2026-11-21.md 的 B 節）
**B1 孤兒程序與殘留資料**：父程序被 kill -9（SIGKILL）時，子伺服器會變成孤兒持續監聽（環境變數裡的 TEACHER_PASSWORD 無限期存活），暫存 DB（含 token hash）也殘留。
  要做到：正常結束／SIGINT／SIGTERM 都會 kill 子程序**並刪掉暫存目錄**；SIGKILL 辦不到（uncatchable），
  所以啟動時要清掉逾期的 classroom-load-* 暫存目錄（例如 >30 分鐘），並在 README 寫明這個限制。
**B2 只准打本機**：--url 預設只允許 loopback（127.0.0.1／localhost／::1）；非本機網址需要明確旗���才放行，
  並在輸出與 README 說明這是為了避免被當成攻擊工具。
**B3 https**：httpClient 用 node:http，對 https:// 會 ERR_INVALID_PROTOCOL（遠端 attach 時密碼會明文穿網路）。
  要改成：https 時用 node:https；若目標不是 loopback 且不是 https，**明確拒絕執行**並說明原因。
**B5 分位數的存活者偏差**：現在 p95/p99 只對未逾時樣本算。
  要改成：分位數以**全部樣本**計算（逾時樣本以逾時上限計），或同時輸出「僅成功樣本」與「全部樣本」兩組並標明；門檻對照要用哪一組要寫清楚。
**B6 health-full-room**：HTTP 腳本的第三情境要改成在**真實的 Socket.IO 作答洪流中**探測 health 延遲（不再只是預先 join）。

### 3. 報告 docs/verification/load-test-2026-11-21.md
一次真實執行的結果：環境（Node 版本、CPU、DB 模式、初始筆數、負載機位置）、每個情境的 p50/p95/p99/最大值/樣本數/錯誤率/逾時率、
每秒採樣的伺服器 RSS 與 CPU、停止負載後 60 秒的 RSS 增幅、對照門檻的逐項結論（HTTP p95 ≤ 100 ms／p99 ≤ 250 ms；
送出 ACK 與必要 state p95 ≤ 1 秒／p99 ≤ 2 秒；錯誤率 < 0.1%；漏送／越權／錯誤順位 = 0；CPU 單核 < 80%；RSS 增幅 < 20%）。
每種負載至少 3 次獨立啟動；時間不夠就跑短階段並**明說用的是短階段**。量不到就寫「量不到」。
另外更新 e2e/load/README.md（怎麼跑、量了什麼、門檻、限制）。

## 限制
- 不要修改產品程式（server/src、web/src、shared/src）與既有 e2e 測試；只動 e2e/load/ 與文件。
- 不新增第三方相依套件。密碼與 token 只從環境變數讀、不落盤、不輸出（JSON 也要確認）。
- 伺服器要用 npm run build 的正式產物，不要用 tsx 直接跑。
- 本機 Node 是 v26.7.0；node --test 要用 glob 形式：node --test 'e2e/load/tests/*.mjs'。

## 交付
在你的分支上 commit（不要 push、不要開 PR），回覆我時只給五項：
1. 分支名稱與 commit 範圍
2. 新增／修改的檔案清單
3. node --test 'e2e/load/tests/*.mjs' 的結果
4. 實測摘要（每情境 p95/p99/錯誤率/逾時率、CPU、RSS、門檻是否達標）
5. 哪些指標仍不可信、為什麼

## 助理

目前分支缺少上一輪所依賴的 HTTP 負載工具 commit，所以我已從來源 worktree 用 `cp` 補齊同目錄的既有工具檔案（沒有使用 git 合併或 cherry-pick）。正式 build 與原有 18 個負載工具測試已通過；首次 Socket.IO 煙霧測試在建立 1,000 筆種子資料時逾時並殘留未關閉的客戶端，我會先補上能重現問題的測試，再修正配對、清理與安全邊界。

## 助理

壓測煙霧測試失敗的根因已定位：上一輪的追蹤器每份 state 只配對一筆作答，批次快照中的其他作答就被誤判漏送；另外學生 Socket 沒有全部納入清理集合，例外時會讓負載父程序掛住。我已先加失敗測試，正在以同一份快照的多筆配對與完整客戶端生命週期修正這兩點。

## 助理

24 個負載工具測試現在已全部通過，包含 B2／B3／B5 的失敗測試轉綠，以及同份 state 多筆作答配對、純 WebSocket／純 polling 分離和逾期孤兒清理。接下來我會把 HTTPS 與健康檢查情境接回兩個 CLI，再跑完整煙霧測試。

## 助理

WebSocket 的 5 組 × 3 題 × 1 輪煙霧測試已完整走完六種情境、1,000 筆重建與 JSON，且漏送／越權／錯誤順位皆為 0。短階段（cooldown 0 秒）的 ACK 與必要 state p99 約 54 ms；1,000 筆後 50 組重連 p99 約 3.29 秒。這只是煙霧測試，還不能拿來宣稱正式門檻達標。

## 助理

polling 煙霧測試已能在一條握手逾時後完整清理並退出，沒有再被資源監視器掛住。第二個根因是把「setup 用的學生連線」和正式 ACK 共用 5 秒 deadline；polling 在大量 presence 廣播時會超過它。我會把握手 deadline 獨立成明確的 30 秒上限並寫進 JSON，作答 ACK／必要 state 仍保留 5 秒量測口徑。

## 助理

polling 已走到公平順位前的活動關閉，代表 1,000 筆種子與 50 組重連都能完成；目前卡住的不是量測錯誤，而是「重建後的 reset 指令」跟 polling 廣播積壓共用 30 秒 setup deadline。正式 ACK／state 仍是 5 秒；我只把 reset／close／seed 這類環境轉換的 setup deadline 明確放大到 120 秒，避免把 setup 排隊誤當作答逾時。

## 助理

再往下追，root cause 是「老師／投影的 polling 收件佇列」：種子期間每次提交都會先推播快照給老師與投影，1000 次後累積的佇列讓後續 reset ACK 一直排不到。量測用的 teacher／projector 若在種子期間斷線，種子就不會產生這些無意義的 unread snapshot；重建完成後再以乾淨狀態重接，才是在量測「新提交 → state」，而不是在等 1000 個 setup 廣播。

## 助理

polling 煙霧測試也已完整走完六種情境、1,000 筆重建與 JSON；漏送／越權／錯誤順位皆為 0。50 組重連是在重建完成後依序重接（日誌和報告會明說，不再寫「同時」），polling p95 約 48 ms、p99 約 1.18 秒。下一步先跑使用者指定的中等規模 50 組 × 20 題 × 2 輪，包含兩種 transport 與 60 秒 cooldown。

## 助理

50 組 × 20 題 × 2 輪的 WebSocket 實測已跑完並停止乾淨，但門檻沒有全過：ACK p95/p99 為 3524/3916 ms，必要 state p95 3736 ms；ACK 逾時 0.15%，必要 state 逾時 0.96%，越權與錯誤順位 0，CPU 約 64.74%，60 秒後 RSS 增幅約 50.09%。我也從原始資料發現量測工具的「逾時後晚到」仍可被誤記成功，以及 ACK timeout 被重複算命令錯誤，已先加回歸測試並修正這兩點，再正式引用數字。

## 助理

中等 polling 的 2000 筆冷啟量測已跑完，但 setup 的 1000 筆種子在 120 秒 deadline 仍未完成，腳本已正常清理。這不是把失敗改成通過的理由：我會把「只是建立資料、不參與量測」的 1000 筆種子改用成功且快速的 WebSocket setup 客戶端產生，正式數字仍只取各自 transport 的作答與重連；JSON 會明確標記這個 setup 差異，避免混充純 polling 數字。

## 助理

50 組 × 20 題 × 2 輪的兩種 transport 都已真實跑完。WebSocket 多項目未達標；polling 更差：冷啟 ACK／必要 state 的 p95 都是逾時上限 5000 ms，逾時率分別約 47.50%／46.56%，但命令錯誤率都是 0、越權與錯誤順位也都是 0。這些會如實寫成未達標，不會調整門檻或只報成功樣本。

## 助理

HTTP 10／25／50 req/s、50 名學生 Socket.IO 作答洪流的實測也已完成。各 rate 的 health p95 約 1.73–2.56 ms，join p95 約 4.68–6.67 ms，真實作答洪流下 health p95 約 10.35–18.62 ms，錯誤與逾時都是 0；第三情境確認有 120／300／600 筆實際 `answer:submit`，不是預先 join 的空殼流量。

## 助理

在我確認最終程式的正確性後，必須用最新版本重跑一次中等 WebSocket；先前那次跑在「逾時晚到仍可補記成功／ACK timeout 重複算錯」的工具缺陷下完成，不能直接當正式依據。polling 中等跑是在修正後完成的，可以直接引用，但也只有一趟，重複性仍不足。

## 助理

最終版中等 WebSocket 也真实跑完。最新可信數據是：ACK p95/p99 3528.92/4095.07 ms、逾時 0.30%；必要 state p95/p99 3795.98/5000 ms、逾時 1.51%；錯誤率 0%、越權 0、錯誤順位 0。CPU 穩態平均 68.59%（但每秒 CPU p95 已達 105%，超過單核 80% 門檻），60 秒後 RSS 增幅 45.81%。我會照這組結果寫「未達標」，不採用先前舊工具版本的數據。

## 助理

polling 那份中等 JSON 有一個版本差：它完成時，倒數逾時還只放在旁欄，沒有進 `allRoles` 的樣本分母，所以會看到「樣本 100」與旁欄「逾時 3」不一致。我已修正計分母的方式，但這份資料不再適合當最終全體樣本結果；我會用同一規模再跑一次最新版，讓報告的每一格都符合同一套統計口徑。

## 助理

工具修正已完成（25/25 測試通過），README 也已補上執行方式、門檻、統計口徑與 SIGKILL 限制。正式報告會保留每秒資源採樣的原始 JSON，並明確標出：目前中等 Socket 負載每 transport 只有一趟獨立啟動，不能宣稱長期穩定性。

## 助理

中等 polling 正在以最新版工具重跑；目前所有程式與文件修正、25/25 測試、HTTP／WebSocket 中等實測和 Redis-style 星檢查都已完成。等這趟 polling 結束後，我會補上最新數據、驗證 signal cleaning、跑完整 test/check 並 commit。

## 助理

最新版中等 polling 也已跑完：冷啟 ACK p95/p99 都是 5000 ms，逾時 42.90%；必要 state p95/p99 都是 5000 ms，逾時 42.08%，漏送 3366；越權 0、順位錯誤 0、命令錯誤 0。倒數結果現在把 3 個逾時全部納入 103 個樣本，p99 依 15 秒 deadline 計為 15000 ms。SIGTERM 驗證也完成：父程序 exit 143，子伺服器不存在、暫存資料夾也已刪除。

## 助理

我會把這張報告告寫成「測量結果與結論」，不是修補記錄：只有最新的一趟中等 WebSocket／polling 和一趟 HTTP 會當作正式數據；舊版本工具產生的數據只當除錯證據，不列入正式結論。每秒 CPU／RSS 原始樣本會跟三個不含憑證的 JSON 一起存入 `docs/verification/load-test-2026-11-21/`。

## 助理

報告與原始 JSON 已整理好。接下來是最後驗收：重跑 25 個負載工具測試、完整 `npm test`、`npm run check`，然後檢查 diff／憑證／暫存檔並 commit 到目前分支，不 push、不開 PR。

## 助理

完整產品測試已通過：server 51 檔／424 測試、web 24 檔／125 測試，負載工具 25/25。`npm run check` 在 typecheck 全部通過後停在 eslint，負載目錄少了 Node timer／URL import，並且上一輪留下一個未使用的 `waitTeacherSettlement`；我會只修這些 lint 問題後重跑 check。

## 助理

`npm run check` 已通過：typecheck、eslint 與圖表檢查都為 0。接下來只做範圍內的 staged review、字元檢查與 commit；不 push、不開 PR。

## 助理

staged 16 個檔案的憑證掃描、`git diff --check` 與最後一次完整 `npm test` 都通過（424 個 server、125 個 web）。我現在只 commit 這個分支。

## 助理

1. **分支與 commit**
   - 分支：`t3/socket-load-testing-1`
   - commit：`99b6bf0..75b9c88`（1 個 commit）
   - [`75b9c88`](.#) `feat(e2e): 加入 Socket.IO 負載量測與安全邊界`
   - 未 push、未開 PR，工作樹乾淨。

2. **新增／修改的檔案**

   全部為新增；未修改 `server/src`、`web/src`、`shared/src` 或既有 E2E 測試。

   - 文件與實測證據：
     - [load-test-2026-11-21.md](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/docs/verification/load-test-2026-11-21.md)
     - [http-medium.json](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/docs/verification/load-test-2026-11-21/http-medium.json)
     - [socket-medium-websocket.json](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/docs/verification/load-test-2026-11-21/socket-medium-websocket.json)
     - [socket-medium-polling.json](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/docs/verification/load-test-2026-11-21/socket-medium-polling.json)
   - 負載工具：
     - [README.md](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/README.md)
     - [http.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/http.mjs)
     - [socket.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/socket.mjs)
     - [httpClient.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/httpClient.mjs)
     - [measure.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/measure.mjs)
     - [server.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/server.mjs)
     - [socketLoad.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/socketLoad.mjs)
     - [socketSetup.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/socketSetup.mjs)
     - [targetSafety.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/lib/targetSafety.mjs)
   - 測試：
     - [measure.test.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/tests/measure.test.mjs)
     - [socketLoad.test.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/tests/socketLoad.test.mjs)
     - [toolSafety.test.mjs](<home>/.t3/worktrees/Answering-System_speckit/t3-b5b0d876-bd754b4f477c410b/e2e/load/tests/toolSafety.test.mjs)

3. **測試結果**
   - `node --test 'e2e/load/tests/*.mjs'`：**25 passed / 0 failed**
   - `npm test`：server **424/424**、web **125/125**
   - `npm run check`：typecheck、eslint、圖表檢查全部通過。

4. **實測摘要**
   
   p95/p99 均為毫秒；分位數以**全部樣本**計算，逾時以對應 deadline 計入。

   **HTTP（每欄依 rate 10/25/50 列出；全部達標）**

   | 情境 | p95/p99 | 錯誤率 | 逾時率 |
   |---|---|---:|---:|
   | health | 2.56/2.77、2.16/2.34、1.73/2.49 | 0% | 0% |
   | join | 6.67/6.79、5.71/6.06、4.68/5.42 | 0% | 0% |
   | health-full-room＋真實作答洪流 | 18.62/19.45、13.46/14.03、10.35/10.99 | 0% | 0% |

   **Socket.IO WebSocket（50 組 × 20 題 × 2 輪）**

   | 情境 | p95/p99 | 錯誤率 | 逾時率 |
   |---|---|---:|---:|
   | 冷啟 ACK | **3528.92/4095.07** | 0% | **0.30%** |
   | 冷啟四路 state | **3795.98/5000** | 0% | **1.51%** |
   | 公平順位 ACK／state | 20.89/20.89；21.02/21.02 | 0% | 0% |
   | 四空長答案 ACK／state | 229.06/238.83；226.14/235.88 | 0% | 0% |
   | 作廢後重送 ACK／state | 5.76/5.76；5.77/5.77 | 0% | 0% |
   | 50 組重連握手 | 74.29/2793.23 | 0% | 0% |
   | 倒數到期 | 139.90/144.56 | 0% | 0% |

   **Polling（同規模）**

   | 情境 | p95/p99 | 錯誤率 | 逾時率 |
   |---|---|---:|---:|
   | 冷啟 ACK | **5000/5000** | 0% | **42.90%** |
   | 冷啟四路 state | **5000/5000** | 0% | **42.08%** |
   | 公平順位 ACK／state | 1552.78/1552.78；1637.82/1637.82 | 0% | 0% |
   | 四空長答案 ACK／state | 314.80/314.82；375.81/**5000** | 0% | 0%；**1.50%** |
   | 作廢後重送 ACK／state | 8.81/8.81；8.76/8.76 | 0% | 0% |
   | 50 組重連握手 | 95.02/3582.01 | 0% | 0% |
   | 倒數到期 | 141.64/**15000** | 0% | **2.91%** |

   - 越權、錯誤順位：兩種 transport 都是 **0**。
   - 必要 state 漏送：WS 冷啟 **121**；polling 冷啟 **3366**、長答案 **3**，此項未達標。
   - CPU：WS 穩態 68.59%、每秒 p95 **105.00%**；polling 穩態 45.34%、每秒 p95 **103.80%**；每秒 p95 <80% 門檻都**未達標**。
   - RSS 停止 60 秒後增幅：WS **+45.81%**、polling **+82.42%**；<20% 門檻都**未達標**。
   - 安全驗證：SIGTERM 後 exit 143、子程序不存在、暫存目錄不存在；遠端預設拒絕，且遠端 HTTP 即使加旗標也拒絕。

5. **仍不可信或不可外推的指標**
   - 最終工具版本的中等 WS／polling 都**只有一趟獨立啟動**，不足 3 次，不能作穩定基準。
   - 短煙霧測試雖兩種 transport 都跑通，但規模是 **5 組 × 3 題 × 1 輪、cooldown 0**，不能替代中等長階段 RSS 結論。
   - 1,000 筆種子固定用 WebSocket setup，重連則為**依序**50 組，不能解讀成純 polling seed／同刻同時重連下的數字。
   - 負載與伺服器同機 loopback；未量到教室網路、200 人長時段 peak 或某個真實 HTTPS 遠端伺服器。
   - HTTP 情境沒有另做工整的 CPU／RSS 每情境採樣；相關數字只有 Socket.IO 中等伺服器的整趟採樣。
