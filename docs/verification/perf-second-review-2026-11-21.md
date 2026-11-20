# 效能重構（PR #21）與壓測工具（C1）第二驗證報告｜2026-11-21

- 驗證者：第二驗證者（獨立覆核，GLM-5.3-max，唯讀＋量測）
- 覆核範圍：
  - **A**：`git diff daae80c..0b4d5cb`（PR #21，宣稱「純效能重構，行為完全不變」）。
  - **B**：`e2e/load/`（commit 3f8a341，C1 的 HTTP 壓力量測工具）。
- 本報告未修改任何程式碼；所有實驗都在系統暫存目錄
  `/private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/perf-review/`
  執行（差動測試 `diff-test.mjs`、邊界測試 `edge-test.mjs`、靜態檔實驗
  `static-test/experiment.mjs`、正式 app 重現 `real-app-repro.mjs`／`old-app-repro.mjs`）。

## 0. 驗證方法與環境

1. **隨機差動測試**：把 daae80c 的 `server/src` 抽到暫存目錄，與 HEAD 版本在**同一份**
   in-memory SQLite 上逐項比對。每個情境隨機產生 1–6 組、1–5 題（1–3 空）、
   10–70 個插入/作廢操作、隨機公平順位旗標、隨機 phase、隨機揭曉數，然後比對 14 個項目：
   `listAllSubmissions`、`listByQuestion`、`findValid`、`findLatest`、`listValidByGroup`、
   `buildMyAnswers`、`buildResults`、`buildClosedMyAnswers`、`buildBoard`、`buildProgress`、
   學生/老師 `createSnapshot`、`createProjectorSnapshot`、`computeSettlement`（舊）對
   `computeSettlementFromRecords`（新）。**300 個情境全部輸出一致**（含作廢後重送、
   空字串答案、同組多筆歷史、random `receivedAt` 觸發的 3 秒批次與 settling 分支）。
2. **邊界差動測試**：零作答、全部作廢（3 輪送出→作廢）、單組、結算邊界
   `now = batchStart + 3000ms ± 1`、公平順位作廢後連鎖改判、以及「兩題共用同一個
   `position`」（繞過應用層、直接改 DB）的 LEFT JOIN 去重風險——**全部一致**。
3. **既有測試**：`npm test --workspace @classroom/server` → **50 檔 422 項全部通過**。
4. **基準重跑**：`npm run bench --workspace @classroom/server` 重現改善
   （buildResults 2.95 ms、buildBoard 2.99 ms、buildProgress 0.76 ms、老師快照 3.94 ms，
   與 `docs/verification/perf-optimization-2026-11-20.md` 宣稱同數量級）。
5. **靜態檔實驗**：以舊寫法（`express.static(root)`＋`sendFile(indexPath)`）與新寫法
   （`dotfiles:'allow', index:false`＋`sendFile(indexPath,{dotfiles:'allow'})`）在
   「一般路徑」與「隱藏目錄路徑」各起一個伺服器，比對 9 種請求；再用**正式
   `createApp`**（新舊兩版）重現關鍵差異。
6. **壓測工具實跑**：短煙霧測試（成功路徑）、`kill -9` 父程序（例外路徑）、
   `node:http` 對 `https://` URL 的行為、殘留 DB 內容檢查。

---

## A. PR #21「純效能重構，行為完全不變」的逐項覆核

### A1. winner 判定一律來自結算 — 成立

- `buildResults`（[answerProjections.ts:127](../../server/src/app/answerProjections.ts)）與
  `buildBoard`（同檔）的 `winnerGroupId` 都只讀 `settlement.get(...)`；
  `createSubmissionIndex` 建立的索引只拿來**反查** winner 的有效作答（拿答案文字），
  沒有任何「最小 rank → winner」的推論。看板 cell 的順位在有效作答時也取自結算的
  `rankByGroup`（公平順位改判會反映），作廢 cell 才用 submission 原始 `rank`——與舊版相同。
- 舊版的 `listByQuestion(...).find(groupId && voidedAt === null)` 取「第一筆有效」，
  新版索引取「最後一筆有效」；因為 schema 有部分唯一索引
  `submissions_one_valid_per_group_question ON submissions(question_id, group_id) WHERE voided_at IS NULL`
  （[database.ts:74-76](../../server/src/infra/db/database.ts)），兩者必然同一筆。
  這個依賴在 `createSubmissionIndex` 的註解有明講，且由 DB 層強制，不是口頭假設。
- 差動測試含「公平順位＋作廢改判」情境：作廢 q1 的贏家後 q2 連鎖重算，
  新舊輸出一致（`edge-test.mjs` 輸出：改判前 `[[1,"g1"],[2,"g1"]]`、
  作廢後 `[[1,null],[2,"g1"]]`，新舊相同）。

### A2. 有效作答 vs 最新紀錄 — 成立

- 新 `readAnswers` 以 `LEFT JOIN submission_answers` 一次讀回，再以
  `if (row.answerText !== null) current.answers.push(...)` 組回（[answerRepo.ts:53-100](../../server/src/infra/db/answerRepo.ts)）。
  `submission_answers.answer_text` 是 `NOT NULL`（database.ts:84），所以 `answerText`
  為 null 的列只可能來自 LEFT JOIN 的「沒有任何答案明細」——此時舊版逐筆查詢回空陣列、
  新版也是空陣列，語意一致。**「answer_text 為 null 的提交」在兩版下都產生
  `answers: []`，無差異**（差動測試含「題目 0 空」極端 case）。
- 空白格順序：新版 `ORDER BY q.position, s.rank, a.blank_position`；`blank_position`
  是 `submission_answers` 主鍵的一部分，同一 submission 的列必然照原順序排列，
  與舊版 `ORDER BY blank_position` 相同。
- 同一組多筆作答：`createOwnSubmissionIndex` 的 `latestByQuestionNumber`
  「最後覆蓋即最新」依賴「rank 在題內唯一且隨時間遞增」——
  `submissions_question_rank_unique ON submissions(question_id, rank)`（database.ts:71-72）
  加上 `insertSubmission` 固定用 `maxRank + 1`（[answerCommands.ts:94](../../server/src/app/answerCommands.ts)）成立。
  與舊版 `findLatest`（`.at(-1)`）等價；差動測試的隨機作廢/重送序列覆蓋此點。
- 去重迴圈 `if (current?.id !== row.id)` 依賴「同一 submission 的列連續」。排序鍵
  `(q.position, s.rank)` 已足以唯一決定 submission（position 由匯入器循序產生
  [guidedNotesParser.ts:199](../../server/src/domain/guidedNotesParser.ts)，rank 題內唯一），
  我另外用「兩題手動改成相同 position＋相同 rank」直接測試，SQLite 排序器仍保持
  區塊連續、新舊輸出一致；此風險在應用層不可達，僅屬理論。

### A3. 結算的跨題依賴與兩條路徑 — 成立

- `computeSettlement` 現在只是 `computeSettlementFromRecords` 的包裝
  （[answerSettlementService.ts:73-89](../../server/src/app/answerSettlementService.ts)），
  兩者共用未修改的 `settleAll`；公平順位的「依成功題數連鎖重算」邏輯
  （`successCounts` 隨 `orderQuestions` 順序累積）一行未動。
- 呼叫端（`buildResults`/`buildBoard`/`buildClosedMyAnswers`）都是在同一個同步區塊內
  先讀 `activity`/`submissions`/`questions` 再交給 `computeSettlementFromRecords`；
  Node 單執行緒內沒有 await，不可能讀到「寫入中途」的混合狀態。
  `exportCommands.ts:147` 仍用 `computeSettlement`（DB 版），同一入口，無分行為。
- **沒有跨寫入快取**：所有投影每次呼叫都重新讀 DB；`computeSettlementFromRecords`
  只重用「同一個同步呼叫內」讀到的紀錄。零揭曉短路（見 A5）也不快取。
- 邊界：零作答、全部作廢、只有一組作答、`now` 恰在 `batchStart + 3000ms` 的
  前後 1 ms——差動測試全部一致（`settling` 的 `now < batchStart + WINDOW` 邊界
  由未修改的 `settleAll` 決定，兩版同值）。

### A4. 投影輸出欄位 — 成立

差動測試逐欄比對（canonical JSON）了 open/closed 學生快照（`state`、`answers`、
`rank`）、老師快照（board cells 的 `state`/`answers`/`rank`、`winnerGroupId`、
`settling`、`fairnessApplied`、progress）、投影快照（`revealed`、`groupWinCounts`
為 `null` 或空陣列的差別）。特別確認：

- 零揭曉且**題數為 0** 時 `groupWinCounts` 是 `[]` 不是 `null`
  （`revealedCount >= questions.length` 即 `0 >= 0` 為真）——與舊版一致，
  优化文档第 22 行的宣稱正確。
- 零揭曉且題數 > 0 時 `questions: []`、`groupWinCounts: null`——與舊版一致。

### A5. 為了快犧牲正確性的捷徑 — 未發現

- 唯一的「捷徑」是 `createProjectorSnapshot` 的零揭曉短路
  （[snapshot.ts:146](../../server/src/app/snapshot.ts)：`revealedCount === 0` 時不呼叫
  `buildResults`）。輸出等價（A4），且新增單元測試
  `answerProjectionEfficiency.test.ts` 直接斷言「不準備任何 `FROM submissions` 查詢」。
- 理論差異：舊版在零揭曉時仍會執行 `buildResults` → `timeOf(receivedAt)`，
  若 DB 有無效的 `received_at` 字串舊版會 throw、新版不會。但 `receivedAt` 一律由
 伺服器 `new Date().toISOString()` 產生（[answerCommands.ts:55,95](../../server/src/app/answerCommands.ts)），
  應用層不可達，僅記錄備查。
- `buildProgress` 改讀 `listValidSubmissionPairs`（不讀答案文字）後以 Set 去重計數，
  與舊版「listByQuestion + filter + Set」語意相同（同一 (question, group) 多筆有效
  由唯一索引排除；就算有重複，兩邊都會去重）。

### A6. 既有測試有沒有被削弱 — 沒有

- `answerCommands.test.ts`：`expect(` 74 → 115、`it(` 17 → 21；
  測試名 diff 只有新增（50 組 20 題、同組連送五十次、多空長答案、連續十輪作廢重送），
  無刪改名。removed lines 全是 printWidth-80 格式重排與 helper 抽出
  （對照 commit 0b4d5cb「還原專案既有程式碼格式」），抽查之斷言語意未變。
- e2e `001-activity-session.spec.ts`（expect 51 → 66）、`003-buzz-in.spec.ts`
  （161 → 173）同樣只增不減。
- `npm test --workspace @classroom/server`：50 檔 422 項全部通過（本機重跑）。

### A7. 靜態檔 dotfile 放行 — **不成立，有兩個未宣稱的行為變化**

背景（實驗 `static-test/experiment.mjs`＋正式 `createApp` 重現）：`send` 的 dotfile
檢查作用在**送進 `send` 的路徑**。`res.sendFile` 的路徑是絕對檔案路徑，因此 repo
放在隱藏目錄（如本 worktree 的 `.t3/...`）時，**舊版 SPA fallback 在該環境完全壞掉**
（`GET /teacher` → 404，`send` 把 `.t3` 段當 dotfile「ignore」）——
`sendFile(indexPath, { dotfiles: 'allow' })` 是**必要且正確**的修復，我已驗證修復有效。
問題在另外兩處：

**(1) `express.static(webDistPath, { dotfiles: 'allow', ... })`（[app.ts:116](../../server/src/infra/http/app.ts)）
會把 `web/dist` 內的 dotfile 直接送出。** 對正式 `createApp`（新舊兩版）實測：

| 請求 | daae80c（舊） | HEAD（新） |
| --- | --- | --- |
| `GET /` | 200 index.html | 200 index.html |
| `GET /teacher` | 200 index.html | 200 index.html |
| `HEAD /` | **200** | **404** |
| `GET /.env`（dist 內放置 `.env`） | 200 index.html（SPA fallback，**檔案不外洩**） | **200 `SECRET=...`（檔案內容外洩）** |

- 舊版 `dotfiles` 預設 `ignore`：dotfile 請求落到 SPA fallback 回 index.html，
  檔案永遠不會被送出；新版任何落在 `web/dist` 的 dotfile（`.env`、`.DS_Store`、
  `.git/...`、`.well-known/...`）都變成可下載。`web/dist` 是 vite build 輸出
  （build 會清空目錄），但 macOS 上用 Finder 開過 dist 就會生 `.DS_Store`，
  部署流程若原樣複製即外洩；課程規定「密碼不得出現在可取得範圍」，這是防護倒退。
- 此選項對「隱藏目錄 worktree」的修復**沒有貢獻**：實測舊寫法的 `express.static`
  在隱藏目錄 root 下本來就正常（static 的 dotfile 檢查只看 URL path，不看 root）；
  需要修的只有 `sendFile`。建議：`express.static` 恢復預設（或明確 `dotfiles:'ignore'`），
  只保留 `sendFile` 的 `dotfiles:'allow'`（或改用 `root` 選項限定）。
- `index: false`：`GET /` 由 SPA fallback 送 index.html，內容不變；但 fallback
  只收 `request.method === 'GET'`（[app.ts:123](../../server/src/infra/http/app.ts)），
  且 static 在 `index:false` 下不處理目錄請求，造成 **`HEAD /` 從 200 變 404**
  （HEAD 對一般存在的檔案仍正常）。影響：用 `HEAD /` 做健康檢查的監控會誤報。
- 正式部署路徑（repo 不在隱藏目錄）：`sendFile` 的 `dotfiles:'allow'` 無副作用
  （indexPath 固定）；行為差異只剩上表兩項。

---

## B. C1 壓測工具（e2e/load/）

### B1. 憑證處理 — 常規路徑乾淨，例外路徑有實測缺口

做得對的（程式碼＋實跑核對）：

- 老師密碼由 `http.mjs` 以 `randomBytes(24)` 在記憶體產生，只經子程序環境變數傳遞
  （[server.mjs:103-112](../../../e2e/load/lib/server.mjs)）；不進 argv、不寫檔。
- 換到 token 後立即丟棄密碼參照（[http.mjs:288](../../../e2e/load/http.mjs) `password = null`）。
- console 與 JSON 輸出逐行核對：只有 url、port、dataDir 路徑、統計數字；
  無密碼、無 token（`loginTeacher` 的 token 只存在記憶體供 socket 握手用）。
- 暫存 DB 只存 token 的 SHA-256（`sessions.token_hash`），不存密碼——我解剖了
  SIGKILL 殘留的 `app.db`，只有 `eb1f128e…` 的 hash。
- 成功與失敗路徑：`finally { stopServer() }`＋`startServer` 內 `catch { stop() }`，
  暫存目錄會 `rm -rf`（實測成功路徑目錄已清）。

缺口（實測重現）：

- **父程序被 SIGKILL（或 segfault）時**：`process.once('exit', killOnParentExit)`
  （[server.mjs:123](../../../e2e/load/lib/server.mjs)）不會執行，`stop()` 的
  `rm(dataDir)`（server.mjs:139）也不會執行。實測結果：
  1. 子程序伺服器**孤兒化**（PPID=1）繼續監聽隨機 port——其環境變數中的
     `TEACHER_PASSWORD` 與記憶體中的密碼**無限期存活**，且 `index.ts` 的
     `httpServer.listen(port)`（[index.ts:76](../../server/src/index.ts)）未綁 host，
     對所有介面監聽，量測期間與孤兒期間**整個 LAN 都連得到**。
  2. 暫存目錄 `classroom-load-*` 與 `app.db` 殘留（實測留下
     `classroom-load-DSGZhp/app.db`，已手動清除）。
  - 修法建議：`'exit'` hook 補 `rmSync(dataDir, { recursive: true, force: true })`；
    更根本的是子程序改用 `detached`＋PR_SET_PDEATHSIG 等價機制或定期由父程序回報，
    並讓 managed 伺服器綁 127.0.0.1。
- 子程序環境變數在「結束後」不殘留（process 結束即釋放）——但孤兒情況下程序
  **沒有結束**，等同殘留（見上）。

### B2. 會不會變成攻擊面 — 會，且缺「只准打本機」保護

- `--url` 接受任意目標、無 loopback 檢查（[http.mjs:63-64](../../../e2e/load/http.mjs)），
  `--rate` 無上限：任何人可以拿這支腳本對**別的**服務做固定到達率洪水
  （health 情境不需要任何憑證）。
- **attach 模式只能打明文 HTTP**：`httpClient.mjs` 用 `node:http` 的 `request`，
  對 `https://` URL 直接 throw `ERR_INVALID_PROTOCOL`（實測）。後果有二：
  1. 打不了正常的 TLS 正式站（某種意外保護）；
  2. 一旦目標是遠端 plain-HTTP（例如內網、反代後的 http://port），
     `TEACHER_PASSWORD` 會**以明文穿過網路**送進 `/api/teacher/login`。
- attach＋密碼模式會在目標上**建組別**（`group:create`，名 `load-<hex>`）與
  大量 session（join 情境每請求一筆）——這是對正式資料的寫入，不只是量測。
- managed 模式伺服器綁 0.0.0.0（index.ts:76 未指定 host）：量測期間臨時伺服器
  （隨機 port、隨機密碼）對 LAN 開放；`/api/student/join` 無需認證（只需猜中
  groupId UUID，隨機產生不可猜）。
- 建議：`--url` 預設僅允許 `127.0.0.1`／`localhost`／`::1`，打外部需明確
  `--allow-remote`（或環境變數）＋警告密碼將以明文傳送；managed 模式給子程序
  加 `HOST=127.0.0.1` 支援。

### B3. 現有資安防護現況（實讀確認）

| 面向 | 現況 | 證據 |
| --- | --- | --- |
| 登入速率限制 | 60 秒視窗、10 次失敗後 429、只計失敗、成功不清除、依 `request.ip` | [authRoutes.ts:20-21,113-121](../../server/src/infra/http/authRoutes.ts)，與宣稱一致 |
| `express.json` | 預設 100 KB（102,400 bytes） | app.ts:80；body-parser 預設 |
| 匯入 raw body | 限 5 MB 且**先過老師授權**再讀 body | questionRoutes.ts:151＋路由順序 |
| 解壓後上限 | 50 MiB（`MAX_WORKBOOK_UNCOMPRESSED_BYTES`） | workbookReader.ts:12 |
| Engine.IO 訊息 | 預設 `maxHttpBufferSize = 1e6`（未覆寫） | index.ts:152 `new SocketIOServer(httpServer)` 無選項；engine.io 預設 |
| 單格長度 | 200 code point（trim 後） | answerValidation.ts `MAX_ANSWER_LENGTH=200` |

**沒有被保護的面向**（皆為既有狀態，非本 PR 引入）：

1. **合法登入無上限**：密碼正確就發 token，每次登入 INSERT 一筆 session
   （authRoutes.ts:125 → `issueSession`）——知道密碼的人（或腳本）可無限灌
   sessions 表。速率限制只擋失敗。
2. **`/api/student/join` 完全無節流、無認證**（authRoutes.ts:129-148）：只要
   groupId 存在就發 token＋INSERT session；groupId 是 UUID 難猜，但一旦取得
   （例如投影畫面、log、側錄）即可無限灌 DB。壓測工具自己的 join 情境
   （50/s × 120 s = 6,000 筆）就是這個攻擊的示範。
3. **連線數無上限**：`io.on('connection')` 無 maxConnections／per-IP 限制。
4. **指令送出頻率無上限**：`answer:submit` 等指令無 per-socket 節流；
   `answers` 陣列在 zod 層無長度上限（schemas.ts:67），先進記憶體才在
   use case 檢查筆數（answerCommands.ts:73）。
5. **單請求上限管不住在途總量**：1 MB/訊息 × 並發連線數＝未設上限的總記憶體；
   匯入 5 MB × 並發同理（雖需老師 token）。
6. 速率限制的 `failures` Map 以來源 IP 為 key 無上限（IPv6 輪替可灌 Map 本身）；
   單一 source 的清單有視窗修剪，風險小。

### B4. 方法論

會產生**誤導性結論**的點：

1. **「health-full-room」目前不反映作答壓力**（工具自己有誠實標註，但命名與
   門檻對照時易被誤讀）：prejoin 的 200 名「學生」只是 HTTP join 產生的 session
   rows，**沒有半條 Socket.IO 連線**；背景流量也是 HTTP join（INSERT session），
   不是 `answer:submit`。真實作答壓力的主成本——`broadcastSubmissionChanged`
   對每個老師＋該組學生送完整 snapshot（board = 20 題 × 50 組 cell）、SQLite
   submission 寫入、`incrementGroupAnswerRevision`——一概沒被觸發
   （[broadcaster.ts:123-144](../../server/src/infra/socket/broadcaster.ts)）。
   health p95 2–5 ms 的「達標」與門檻「HTTP p95 ≤ 100 ms」對照後容易讓人
   誤以為滿房作答沒問題；audit 文件的門檻組（ACK/state p95 ≤ 1 s）目前**整組量不到**。
2. **單機 loopback＋keep-alive＋同機負載**：量到的是事件迴圈＋SQLite 的純延遲，
   不含 TCP 握手、TLS、真實 RTT、proxy；50 組 Wi-Fi 客戶端的真實尾端延遲會
   完全不同。正式環境的「CPU 單核 < 80%」「RSS < 20%」在與伺服器搶同一顆
   CPU 的量測下也不適用（負載機本身吃 CPU）。
3. **每輪換新 DB**：避免 bloat 干擾，但也量不到 sessions/submissions 長期成長
   的退化（join 情境一輪就 6,200 筆 sessions）。
4. 門檻數字本身（p95 ≤ 100 ms 等，出自
   [perf-audit-2026-11-20.md:77](perf-audit-2026-11-20.md)）作為工程門檻合理，
   且文件明言「待校準」；問題不在數字而在**目前工具量不到其中大半**
   （ACK、state 送達、CPU、RSS），對照時只能得到「未測」而非「通過」。

### B5. JSON 輸出

- 足以重現的部分：tool 名稱、node 版本、platform、startedAt/finishedAt、
  target mode＋url、完整 config（rates/seconds/warmup/timeout/students）、
  每情境 summary（sampleCount/success/timeout 率、p50/p95/p99/max）、
  狀態分佈、prejoin 統計、背景 join 計數、限制註記；skipped 有明確理由。
  「量不到」的處理（attach 無密碼→skipped；全逾時→null＋`formatMs` 印「量不到」）
  是誠實的。
- 不足與誤標風險：
  1. **p95/p99 只對未逾時樣本計算，且包含錯誤回應的延遲**：伺服器過載改成快速
     429/500 時 p95 反而變漂亮；部分逾時（如 10%）時存活者 p95 仍可「達標」。
     errorRate/timeoutRate 有另列，但門檻對照若只看 p95 會誤判。
  2. 未記錄受測伺服器的 git commit／build 來源（managed 模式用的是當下 worktree
     的 `server/dist`，JSON 無法回答「量的是哪一版」）。
  3. 未記錄量測機 CPU 型號／背景負載，也未取樣伺服器 RSS/CPU——audit 門檻中的
     這兩項在 JSON 裡不存在，容易被「沒有數字」當成「沒有問題」。
  4. 環境（負載機＝伺服器同機）只有 README 說明，JSON 本身無標註。

---

## 結論

### 「行為完全不變」的判定：**有例外**

- **成立的部分**（核心業務行為，證據：300 隨機差動情境＋邊界差動＋422 項測試）：
  結算（含公平順位連鎖重算）、winner 判定、有效/最新作答語意、五個投影、
  學生/老師/投影快照的所有欄位、`computeSettlement` 與
  `computeSettlementFromRecords` 的等價、CSV 匯出路徑。
- **例外**（都在 HTTP 靜態層，PR 文件只宣稱了「修復 worktree 相容」而未提下列兩點）：
  1. `express.static` 的 `dotfiles:'allow'` 使 `web/dist` 內的 dotfile
     （`.env`、`.DS_Store` 等）從「不送出」變成「可下載」（應修）。
  2. `index:false`＋GET-only fallback 使 `HEAD /` 從 200 變 404（建議）。
  3. （理論）零揭曉短路讓「無效 `received_at`＋零揭曉」從 throw 變不 throw——
     應用層不可達，僅記錄。

### 發現清單（依嚴重度）

| # | 嚴重度 | 發現 | 證據 |
| --- | --- | --- | --- |
| 1 | 應修 | `express.static` dotfile 放行＝靜態根內機密檔可被下載（`.DS_Store` 實務上最可能出現） | app.ts:116；正式 createApp 實測 `GET /.env` → 200 `SECRET=...`（舊版 200 index.html） |
| 2 | 應修 | 壓測工具父程序 SIGKILL 後：伺服器孤兒化（帶密碼 env、監聽所有介面）＋暫存 `app.db` 殘留 | server.mjs:123 只 kill child 不刪 dataDir；實測 PPID=1 孤兒＋`classroom-load-DSGZhp/app.db` |
| 3 | 應修 | 壓測工具無「只准本機」限制；`node:http` 使 attach 必為明文（`TEACHER_PASSWORD` 明文上網路），且會在目標寫入組別與 sessions | http.mjs:63-64；httpClient.mjs:9；實測 https → `ERR_INVALID_PROTOCOL` |
| 4 | 建議 | `HEAD /` 404（原 200），影響 HEAD 健康檢查 | app.ts:116,123；正式 createApp 新舊對照實測 |
| 5 | 建議 | 未保護面向：合法登入無限發 session、`/api/student/join` 無節流無認證、連線數/指令頻率無上限、單請求限制管不住在途總記憶體、速率限制 Map 無上限 | authRoutes.ts:125,129-148；index.ts:152；schemas.ts:67；B3 清單 |
| 6 | 建議 | 「health-full-room」不含 socket/作答/廣播，與門檻對照易誤讀為「滿房作答達標」；CPU/RSS 門檻目前量不到 | broadcaster.ts:123-144 未被觸發；工具輸出註記＋JSON 無 CPU/RSS 欄位 |
| 7 | 建議 | p95/p99 只算未逾時存活者且含錯誤回應延遲；過載時快速失敗會讓 p95 變好 | measure.mjs:54-64（timeout `continue`）＋httpClient.mjs（非 2xx 也計延遲） |
| 8 | 建議 | JSON 缺受測版本（commit）、機器資訊與同機標註，重現性不完整 | http.mjs report 結構 |

### 最小重現步驟

**Bug 1（dotfile 外洩，可在 `npm test --workspace @classroom/server` 重現的形式）**

```ts
// server/tests/integration/staticDotfiles.test.ts（草案，本輪未加入）
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeDatabase } from '../../src/infra/db/database.js';
import { createApp } from '../../src/infra/http/app.js';

it('web/dist 內的 dotfile 不得被送出', async () => {
  const dist = join(tmpdir(), `static-dotfile-${Date.now()}`);
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html></html>');
  writeFileSync(join(dist, '.env'), 'SECRET=should-not-leak');
  const db = new DatabaseSync(':memory:');
  initializeDatabase(db);
  const server = createServer(createApp({ database: db, teacherPassword: 'x', webDistPath: dist }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const res = await fetch(`${base}/.env`);
  expect(res.status).not.toBe(200); // HEAD 現況：200 + 檔案內容 → 失敗即重現
  server.close(); rmSync(dist, { recursive: true, force: true }); db.close();
});
```

指令形式（不必寫測試）：

```bash
mkdir -p web/dist && cp web/index.html web/dist/ 2>/dev/null || echo '<html></html>' > web/dist/index.html
echo 'SECRET=demo' > web/dist/.env
npm run build --workspace @classroom/server && TEACHER_PASSWORD=x DATA_DIR=/tmp/loadtest node server/dist/index.js &
sleep 1 && curl -s http://127.0.0.1:3000/.env   # → SECRET=demo（應修；舊版回 index.html）
curl -sI http://127.0.0.1:3000/ | head -1        # → HTTP/1.1 404 Not Found（HEAD / 回歸）
```

**Bug 2/3（壓測工具孤兒與外部目標）**

```bash
npm run build
node e2e/load/http.mjs --rate 5 --seconds 60 --students 5 &   # 記下 pid
sleep 6 && kill -9 $! && sleep 2
pgrep -f 'server/dist/index.js'        # → 仍有孤兒程序（PPID=1）
ls -d ${TMPDIR}/classroom-load-*        # → 暫存目錄與 app.db 殘留
# 外部目標：node e2e/load/http.mjs --url http://<任意主機>:3000 --rate 10000 --seconds 600
# 目前無任何本機限制，也不會先確認目標是否為自己的實例。
```

## 附註

- 本報告僅寫入此檔案，未修改任何程式或測試、未 commit。
- 實驗產物（暫存目錄）：`/private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/perf-review/`
  （`diff-test.mjs`、`edge-test.mjs`、`static-test/`、`real-app-repro.mjs`、`old-app-repro.mjs`、
  `load-smoke.json`、`sigkill-run.log`）；孤兒程序與殘留暫存已於驗證後清除。
