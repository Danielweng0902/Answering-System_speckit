# 課堂搶答伺服器延遲審計｜2026-11-20

在 50 組、20 題的滿場資料上，一次成功送出只更新 3 條連線，伺服器仍花了 479 ms 組裝快照。一次全房更新花了 6.30 秒。首要修正是讓學生只讀本組作答，並讓老師的進度查詢略過答案文字。兩者都能保留現有事件、收件人與資料格式。

## 量測條件與讀法

版本 daae80c，Apple M1 arm64，Node 24.22.3。使用同一提交、已有相依套件的 main 工作目錄執行 `npm run bench --workspace @classroom/server`。SQLite 記憶體資料庫、open、每組每題一筆有效作答、每題一空、短答案、空學習單檔案。每函式暖身 1 次、連跑 20 次取算術平均。腳本用全場遞增 rank 與合成時間戳，不能當成公平順位正確性測試。

|函式|題給平均 ms|重跑平均 ms|每次 SQL 讀取|
|---|---:|---:|---:|
|computeSettlement|4.120|6.353|1,023|
|buildResults|74.111|120.052|21,065|
|buildBoard|71.283|121.135|21,065|
|buildProgress|66.863|113.462|20,042|
|老師快照|135.484|244.753|41,132|
|open 學生快照|66.459|115.570|20,066|
|投影快照|70.936|124.681|21,089|

計數方法為另跑相同種子，在建好資料後累計 StatementSync 的 all/get 呼叫，每進一項歸零。closed 學生在 20 題均有效時為 23,135 次。另在 Node 24 直接呼叫正式 broadcaster，放入 50 個不同組的學生、1 位老師、1 個投影連線，emit 只計數。定向 1 輪發出 3 份，82,288 次讀取、478.625 ms；全房 1 輪發出 52 份，1,065,522 次、6,295.722 ms。兩輪都包含計數開銷，沒有序列化、網路、真實連線或客戶端渲染。單樣本只反映同步工作量；沒有量到線上 p95。獨立執行 `npm test --workspace @classroom/server`，49 個檔案、408 項通過。E2E 依原始碼盤點。

## 建議順序與成本

下表以本次 Node 24 平均估算，同一條路徑的節省不能相加。為估計可移除的讀取成本，另在相同種子對候選 SQL 各暖身 1 次、執行 100 次。全場帶答案的兩個 JOIN 平均 1.40 ms；單組帶答案 0.035 ms；只取有效題組配對 0.312 ms；全場空格依鍵排序 0.010 ms。這些數字只涵蓋取列，尚需計入組裝與驗證成本。

|優先|位置與根因|建議與預估節省|契約與驗收風險|
|---|---|---|---|
|1|answerProjections.ts:46 每題 findLatest；answerRepo.ts:152 在 JS 過濾全場。一次學生快照把 1,000 筆完整載入 20 遍|新增單組明細查詢，以 submissions LEFT JOIN submission_answers、WHERE group_id=?、依 question_id、rank、blank_position 排序，一次建每題最新紀錄。open 每人估省 105–115 ms，全房 50 人約 5.25–5.75 秒|不變。保留作廢歷史、未答題、空格順序；closed 的第 112、134 行也可共用單組資料，避免每少一題有效答案就多 1,001 次讀取|
|2|answerProjections.ts:221 的進度讀取 20,000 次答案明細，最後只計有效組別|buildProgress 改用 SELECT question_id, group_id FROM submissions WHERE voided_at IS NULL，再依現有題目、組別補零。113.462 ms 減去取列與組裝，估省 108–113 ms／老師|不變。部分唯一索引保證有效配對唯一；作廢後計數歸零、重送只加一|
|3|snapshot.ts:134 在揭曉 0 題時仍算 20 題結果及勝場|先求揭曉數，題數大於零且揭曉零題直接回空清單、勝場 null；估省 115–120 ms／投影。部分揭曉只讀必要結果，保留公平結算的跨題依賴|不變。零題時現行勝場是空陣列；全部揭曉才提供勝場|
|4|answerRepo.ts:35、191，answerProjections.ts:75、171。readAnswers 每次先做 1 次 submissions JOIN questions，再按每筆作答讀答案 1 次。看板與有 winner 的結果各做 21 次全讀；看板 1,000 格另逐格 find，種子資料共比對 25,500 次|全場投影一次讀有序明細，建立每題、每組、有效及最新紀錄的 Map；buildResults 依結算 winner 取有效答案。將同一份送達資料交給原結算函式。估省 105–117 ms／看板或完整結果。寫入用 findValid（answerRepo.ts:133）另以題、組及有效條件點查|不變。保留 rank 歷史、已作廢答案及公平改判。不得把原始最小 rank 當成 winner|
|5|snapshot.ts:81、109 與 broadcaster.ts:112 對同輪重建。老師看板、進度各讀題庫，closed 學生的結果與本組各結算 1 次。全房測例雖只有 1 個 now，仍做 52 次快照|每輪惰性共用活動、題庫、組別、明細與結算；依角色、投影模式、groupId 分別組裝。基準下少一次結算約 6.35 ms；相同組第二分頁可少一次完整組裝，目前約 115.57 ms。前四項修後須重估|同輪有效，不跨寫入或公平判定時間。保留老師全場 revision、學生本組 revision、guest 活動 revision；每個 socket 仍各送一次，同輪失敗隔離照舊|
|6|questionRepo.ts:132 每次列題做 1+20 次查詢；:165 的老師 metadata 也選出 file BLOB|題目、空格各 1 次有序批讀並依 id 組合，少 19 次讀取／列題。metadata 只 SELECT 所需欄位。空檔、20 空格時兩者暫估小於 1 ms／呼叫，大檔收益待測|不變。保留 position 排序，完整檔案查詢留給匯出|

上述程式位置以 server/src 為根，answerProjections、snapshot 位於 app，兩個 Repo 位於 infra/db。computeSettlement 位於 app/answerSettlementService.ts:26，只使用組別、rank、送達及作廢時間，目前連答案文字也載入。結算不是第一順位。

### 索引與查詢計畫

infra/db/database.ts:48–89 的 blanks 與 submission_answers 複合主鍵分別以題目及 submission_id 開頭，已能支援依 position 讀取。EXPLAIN QUERY PLAN 顯示有效配對掃 submissions_one_valid_per_group_question，單組從 submissions_by_group_valid 搜尋，全場明細掃 submissions_question_rank_unique，兩種明細都以 submission_answers_by_submission 找答案，最後用暫存 B-tree 排序。原程式問題在沒下 WHERE 就還原全場資料；單靠新索引無法消掉 20 次全讀。新增含作廢歷史的 (question_id,group_id,rank) 之前先量單組歷史長度；現有有效唯一索引不含作廢列。答案單欄索引與複合主鍵前綴重疊，但實測計畫確實選用它，不建議此次移除。匯出的三個 JOIN（answerRepo.ts:238）只讀有效列，不能直接拿來建需要作廢歷史的看板。

## 事件成本與收件人

依 infra/socket/commandRouter.ts:138、broadcaster.ts:112–193 與 index.ts:165–310。設 N 為當下所有 socket 數，T 為一般老師，P 為投影老師，S 為當事組連線數。廣播同步完成後才送成功 ACK，慢快照會佔住 Node 事件迴圈。

|事件|成功時的 state 次數|備註|
|---|---|---|
|編輯作答草稿|0|伺服器只有 answer:submit 入口|
|送出、老師作廢、作廢後有效重送|各 1 輪，T+P+S|其他組與 guest 皆 0；重複無效送出 0 輪。公平模式某題首筆有效答案另安排 3 秒提醒，回呼全房 N 份|
|學生接上／斷線|各 1 輪，各 N 份|接上包含本人、斷線只算剩餘連線。即使同組 2→1 仍重算。50 組依次上線，若兩位老師已連，合計 1,375 份|
|老師、投影、guest 連線／斷線|接上只送本人 1 份，斷線 0|學生 token 所屬組已刪除另送 invalid 並降 guest|
|換組|preparing 成功 leave 全房 1 輪；新組連線全房 1 輪|leave 先降 guest，舊連線之後斷開不再觸發學生 presence；介面中間重連 guest 另收本人 1 份。HTTP join 本身 0 輪|
|開啟倒數、手動關閉、自動到期|開啟 N，成功關閉 N；逐秒 0|排程只有到期回呼；競態只成功關閉一次。其他一般成功群組指令、揭曉各 1 輪 N；刪組另外向被刪組每個 socket 發 1 個 invalid|

presence 不宜先改收件人。可以先共用當輪資料維持 revision 與初始 state。若要合併或略過通知，需要另行確認兩組契約。

## 可直接排入測試的缺口

下列為建議案例名稱及斷言。伺服器檔案位於 server/tests/integration，瀏覽器檔案位於 e2e/tests，除特別註明外都是擴充既有檔案。

|情境與現有證據|建議檔案與測試名稱|應斷言|
|---|---|---|
|edgeCases 已測第 51 組拒絕，answerCommands:510 已測 10 組同題；003-buzz-in:59 是 2 組 6 題|answerCommands.test.ts「50 組完成 20 題」|1,000 筆有效紀錄，每題 rank 1–50、進度 50，每組完成 20 題|
|answerCommands:618、651、688 與 003-buzz-in:467 已測 2 空與順序|003-buzz-in.spec.ts「多空長答案結算後仍逐格一致」|20 題各 4 空，每空 200 code point，含 emoji；各格全文、順序一致，單一空格 201 即整題拒絕且 revision 不動|
|unit/answerValidation 已測 200 字及 emoji，answerCommands:318 已測 201；長文與滿房結合缺口|answerResults.test.ts「滿場長答案投影隔離」|1,000 筆、4,000 格，老師看板全文相符，open 學生沒有其他組答案，投影未揭曉為 0 筆|
|answerCommands:366、459 已測同組重送與 2 連線競爭|answerCommands.test.ts「同組連送五十次」|1 成功、49 ALREADY_SUBMITTED，1 筆有效紀錄，revision 只增加一次，失敗不廣播|
|answerCommands:937、003-buzz-in:936 已測作廢後重送|answerCommands.test.ts「連續十輪作廢重送」|末次 rank 11、10 筆歷史、僅 1 筆有效，進度仍為 1；每輪核對 winner 與本組狀態|
|reconnect:33、83 已測原組與離線期間階段變化；003-buzz-in:810 測重新整理|reconnect.test.ts「五十組重連期間結束活動」|最後 presence 每組 1、各自收到 closed 與正確答案；第一份以實際連入時已提交的階段為準|
|unit/activity:45、61 已驗 9、10、3600、3601；countdown:127、196 已測到期及競態；001 E2E 用 30 秒手動關閉|countdown.test.ts「滿場兩個倒數端點」與 001-activity-session.spec.ts「10 秒自動關閉」|假時鐘分別推到截止前 1 ms 仍 open、截止後只關閉一次；真瀏覽器驗各角色收到 closed；另外記錄滿載排程落後量|
|edgeCases:74 是同組 2 人，無 50 個不同組同時在線的收件人斷言|presence.test.ts「50 組在線的定向送出與整房 presence」|52 連線，送出只到 3 位；第 50 組斷開其餘 51 位收到 state，重連 52 位收到，投影沒有未揭曉答案|

## 壓測執行計畫

建議於 e2e/load/ 新增 http.mjs、socket.mjs 及共用種子程式，與 Playwright 的 e2e/tests 分開。以下是腳本完成後的預定介面。本次只做同步投影量測。壓測限獨立的本機測試實例與拋棄式 SQLite 檔。以 Node 24、鎖檔相依版本及 production build 啟動；將 runtime、提交、CPU、SQLite 模式、DB 初始筆數與負載機位置隨結果保存。單獨啟動負載程序，避免把產生負載的 CPU 算進伺服器。

1. HTTP：執行 `node e2e/load/http.mjs --url http://127.0.0.1:3000 --rate 10,25,50 --seconds 120`。每階固定到達率、暖身 30 秒，分測 GET /api/health、已存在組別的 POST /api/student/join，再於滿房作答時以 health 探測事件迴圈。成功登入獨立測，測試密碼從環境讀，不保存 token 或本體。每輪使用新 DB，因 join 會建立 session。
2. Socket.IO：執行 `node e2e/load/socket.mjs --url http://127.0.0.1:3000 --groups 50 --questions 20 --rounds 10`。使用 socket.io-client，記錄實際 transport；分測 WebSocket 與預設升級。先逐步接入 1、10、25、50 組，加老師與投影各 1。區分空資料冷啟、已存 1,000 筆的重連與從空題開始的合法送出。每題 50 組同時送，各題使用排定時間，記錄實際發送延誤；不能等前次 ACK 才開始下一個樣本。另測公平開關、4 空長文、作廢重送、50 同時重連與倒數到期。每輪清場，10 輪得到 10,000 筆合法送出；每個情境分開報有效樣本數，稀有事件不足 100 次另報最大值。
3. 使用同一個負載程序的單調時鐘，量排定到完成、送出到 ACK、送出到老師／投影／同組看見對應版本，以及握手到首份合法 state。按角色與事件分開報 p50/p95/p99、最大值、吞吐、排隊時間。以題組、答案與前後 revision 配對，避免把公平提醒算成送達。同時核對預期收件人、漏發、重複、斷線、錯誤碼。超時仍計入分母並列超時門檻，負載機送不出排定速率的輪次註記失真。
4. 每秒採樣伺服器 PID 的 RSS 與 CPU（100% 表示一個核心），另用測試專用啟動探針記錄 heapUsed、eventLoopDelay p99；保留冷啟峰值與穩態時間序列。每種負載至少 3 次獨立啟動。建議驗收門檻為 HTTP p95 ≤100 ms、p99 ≤250 ms，送出 ACK 與必要 state 各 p95 ≤1 秒、p99 ≤2 秒；正常命令錯誤率 <0.1%，漏送／越權／錯誤順位 0，穩態 CPU 單核平均 <80%，停止負載後 60 秒 RSS 相對暖身後增幅 <20%。這些是待校準的工程門檻；瀏覽器兩秒可見另以 Playwright 小樣本驗證。容量不足時以第一個超標的階段定位。

### 登入與本體限制

infra/http/authRoutes.ts:20、38、112 以 request.ip 記錄最近 60,000 ms 內的失敗。10 次錯密碼回 401，第 11 次起連正確密碼也回 429；恰好 60,000 ms 仍計入。只有失敗計數，成功不清除；無效 schema 先回 400。Map 在程序記憶體、按來源被存取時清理；同一教室共用出口可能共用額度，多程序各有自己的 10 次。這只保護老師密碼比對，對合法登入、學生 join、連線數與送出頻率都沒有吞吐上限。隔離實例重跑 teacherLogin.test.ts:74，另用注入時鐘驗 60,000／60,001 ms；預期拒絕與正常請求的錯誤率分開。

infra/http/app.ts:80 的 express.json 預設 102,400 bytes；infra/http/questionRoutes.ts:151 在老師授權後以 raw parser 限制 5,242,880 bytes，questionImport.test.ts:498、512 驗證超限與解壓後超過 50 MiB 回 413。index.ts:152 使用 Engine.IO 預設 maxHttpBufferSize 1,000,000 bytes。200 code point 是單格業務限制。建議各測界線及 +1 byte，記錄狀態／斷線原因與 DB 零變更；合法上傳另用有效工作簿。單請求大小限制無法約束同時在途的總記憶體，須在上述 50 組測試同步記錄 RSS。此輪沒有量到真實網路吞吐、正式環境代理限制或瀏覽器尾端延遲。
