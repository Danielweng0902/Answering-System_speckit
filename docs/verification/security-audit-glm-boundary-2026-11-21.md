# 資安審計報告：邊界繞過、攻擊面與可用性｜2026-11-21

- 審計者角色代號：**glm-boundary**（GLM-5.3-max，焦點：繞過 perimeter 後能怎樣）
- 對象：`main`（commit `99b6bf0`），TypeScript／Express 5 + Socket.IO 4 + node:sqlite
- 方法：靜態程式碼審閱 + 本機實驗伺服器實測（暫存目錄、獨立 DB、隨機埠、實驗密碼 `audit-pass-2026`；實驗後已全部清理）
- 威脅模型：perimeter（防火牆／VPN）視為已被繞過或不存在；攻擊者可直接觸及伺服器的 HTTP 與 Socket.IO 埠。

---

## 一、逐項結論表

實測結果代號：✅ 守住 ／ ⚠️ 可繞過或缺口 ／ ➖ 不適用（無此防護需求或設計如此）。

### 1. 未認證端點盤點

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 1.1 | HTTP 路由總盤點 | — | 共 8 條：`GET /api/health`（無需憑證）、`POST /api/teacher/login`（密碼）、`POST /api/student/join`（**只需 groupId，無任何憑證**）、`POST /api/questions/import/file`（teacher token）、`POST /api/questions/import/link`（teacher token）、`GET /api/export/guided-notes`（teacher token）、`GET /api/export/results.csv`（teacher token）、`POST /api/export/guided-notes/writeback`（teacher token）。路由定義：`server/src/infra/http/authRoutes.ts:100,129`、`questionRoutes.ts:142,193`、`exportRoutes.ts:96,121,146` |
| 1.2 | 未認證讀資料 | ✅ | 實測：export×3、import×2 未帶 token 全部 401（E2，見附錄 A） |
| 1.3 | 未認證改狀態（HTTP） | ⚠️ | `POST /api/student/join` 未認證即 INSERT 一筆 session 並簽發 student token（`authRoutes.ts:129-148`）。實測 1000 次 join 全部 200（E7） |
| 1.4 | Socket.IO 事件總盤點 | — | 12 個指令事件（`server/src/index.ts:233-309`）：`group:create/rename/delete`、`activity:open/close/reset/fair-ranking`、`questions:confirm`、`answer:submit`（student）、`answer:void`、`reveal:next/all`（teacher）、`student:leave`（student）。身分由握手 token 決定（`broadcaster.ts:159-167`），未帶 token 一律 guest |
| 1.5 | 未認證 socket 讀資料 | ⚠️ | guest 連線（無 token）即持續收到 `state` 廣播，**含全部組別 id+名稱**（`snapshot.ts:51-54`；實測 E4：`groups:[{id:"d92b2964-…",name:"第二組"},…]`） |
| 1.6 | 未認證 socket 改狀態 | ✅ | 所有改狀態事件都有 role 檢查（`commandRouter.ts:122-126`）；實測 teacher 命令以 student 身分送回 FORBIDDEN（E10 10a） |

### 2. 認證與授權

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 2.1 | 老師密碼錯誤處理不洩漏存在性 | ✅ | 唯一錯誤碼 `WRONG_PASSWORD`（`authRoutes.ts:119-123`）；未設密碼回 503 `TEACHER_PASSWORD_NOT_SET`（`authRoutes.ts:108-111`，屬必要提示） |
| 2.2 | 密碼比對時序洩漏 | ✅ | 先各自 sha256 再 `timingSafeEqual`（`authRoutes.ts:87-93`），長度差不洩漏 |
| 2.3 | 登入速率限制（10 次/60 秒） | ✅ 同機制生效 | 實測第 10 次失敗起 429（E3a） |
| 2.4 | 速率限制抗 X-Forwarded-For 偽造 | ✅ | 實測帶 `X-Forwarded-For: 1.2.3.4` 仍 429（E3b）— Express 5 未設 trust proxy，`request.ip` 為 socket 位址（`authRoutes.ts:113`） |
| 2.5 | 速率限制抗換 IP（IPv6） | ⚠️ **可繞過** | 實測 127.0.0.1 被鎖後改連 `[::1]` 立即回到 401 可繼續猜，且從 `[::1]` 用正確密碼直接登入成功（E3d/E3e）。限制以 `request.ip` 為 key（`authRoutes.ts:113-117`），任何多位址來源（IPv6 /64、多出口）可完全繞過 |
| 2.6 | 密碼強度政策 | ⚠️ | `TEACHER_PASSWORD` 只檢查非空（`config.ts:27`、`authRoutes.ts:108`），`teacherLoginSchema` 也只有 `min(1)`（`shared/src/schemas.ts:115-117`）；無最小長度，弱密碼+2.5 即可線上暴力 |
| 2.7 | token 隨機性與長度 | ✅ | `randomBytes(32)` base64url（256-bit）（`server/src/app/access.ts:21-23`），猜測不可行 |
| 2.8 | token 存放 | ✅ | DB 只存 SHA-256 digest（`access.ts:29-43`、`sessionRepo.ts:24-35`）；前端存 sessionStorage（`web/src/lib/session.ts:4-11`），不用 cookie |
| 2.9 | token 重放 | ⚠️ | 不綁連線、不綁裝置：同一 teacher token 同時開多條連線全部有效（實測 E12）；無使用計數或單一活動階段限制 |
| 2.10 | token 過期處理 | ⚠️ **無過期機制** | `sessions` 表只有 `created_at`，`resolveIdentity` 不檢查時間（`access.ts:51-71`）；`activity:reset` 保留組別與 sessions（`activityCommands.ts:185-207`、spec FR-022）。實測 reset 後舊 student token 仍有效（E12'）。唯一撤銷路徑：`student:leave`（僅 preparing）、刪組 CASCADE |
| 2.11 | Socket.IO 握手：未帶 token 的身分 | ✅（設計如此） | 未帶/無效 token → guest；guest 快照無題目、無作答（`snapshot.ts:59-61`，實測 E4 keys 只有 base 欄位） |
| 2.12 | `view=projector` 偽造 | ✅ | 快照邏輯：`view==='projector' && identity.role==='teacher'` 才給投影快照（`broadcaster.ts:85-88`）。實測 student/guest 帶 `view:'projector'` 仍拿到各自一般快照（E6） |

### 3. 速率與資源耗盡（含 C 節缺口實測）

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 3.1 | join 節流（C2） | ⚠️ 無 | 實測 1000 次 join 在 0.6 秒完成（~1667/s），全部 200（E7） |
| 3.2 | sessions 表成長（C1） | ⚠️ 無上限 | 1000 次 join 後 `sessions` 表 1004 行、DB 320KB，永不清理（E7；無 TTL 邏輯） |
| 3.3 | 連線數上限（C3） | ⚠️ 無 | 250 條 guest websocket 在 88ms 內全部建立（E8） |
| 3.4 | 指令頻率上限（C3） | ⚠️ 無 | socket 事件無節流；`answer:submit` 連發僅受資料規則（每組每題一次）約束 |
| 3.5 | 廣播成本 | ⚠️ | 250 連線在場時，一次 presence 變化（斷一條 student）觸發的廣播讓 `GET /api/health` 延遲 **2.3 秒**（同步逐 socket 序列化快照，`broadcaster.ts:112-121`；E8） |
| 3.6 | answers 陣列長度（C4） | ✅ zod 缺口、domain 擋住 | `answers: z.array(z.string())` 無上限（`schemas.ts:65-68`），實測 5000 格送出過 zod，但 `BLANK_COUNT_MISMATCH`（答案數必須等於該題空格數，`answerCommands.ts:73-75`）+ 單格 200 code point（`answerValidation.ts:21-24`）+ socket 訊息 1MB 上限 |
| 3.7 | 單請求大小 | ✅ | `express.json` 100KB（實測 150KB password → 413）、匯入 raw 5MB、socket `maxHttpBufferSize` 1MB（實測 2MB name → 連線被斷，E10i） |
| 3.8 | 並發在途總記憶體（C5） | ⚠️ **可繞過** | preparing 階段 20 條並發 5MB 上傳：RSS 121MB → 278MB（+157MB）且 5 秒後不回落（E11）。單請求上限管不住並發總量，可線性放大至 OOM |
| 3.9 | 速率限制 Map 無上限（C6） | ⚠️ 輕微 | `failures` Map 無總量上限（`authRoutes.ts:45`），但 key 為實際連線位址（XFF 無效），entry 極小，實務風險主要體現在 2.5 的繞過 |

### 4. CORS、CSRF、跨來源

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 4.1 | Express CORS 設定 | ✅（無設定反而是守住） | 未設 cors：跨來源 preflight `OPTIONS /api/teacher/login` 回 200 但**無 ACAO header**、`GET /api/health` 帶 Origin 亦無 ACAO（E9a-c）→ 瀏覽器擋跨來源讀取 |
| 4.2 | cookie SameSite／CSRF | ➖ 不適用 | 系統不用 cookie：HTTP 用 `Authorization: Bearer`（`questionRoutes.ts:53-61`）、socket 用 handshake auth（`broadcaster.ts:50-53`），瀏覽器不自動附帶 → 無 CSRF 面 |
| 4.3 | Socket.IO 來源限制 | ⚠️ 無 | websocket transport 不受 same-origin 限制，伺服器也無 `allowRequest`／Origin 檢查；實測 polling handshake 未附 ACAO，但純 websocket 連線（無 Origin）可建立並收廣播（E4-E8 全部以 websocket-only 連線，不帶任何來源資訊） |

### 5. 輸入驗證（zod 缺口盤點）

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 5.1 | `answers` 陣列 | ⚠️ zod 無上限；domain 擋 | 見 3.6 |
| 5.2 | 群組名稱 | ⚠️ zod 無上限；domain 擋 | `name: z.string()`（`schemas.ts:26`）；實測 100k 字過 zod，`GROUP_NAME_TOO_LONG`（30 code point，`groupRegistry.ts:47-49`） |
| 5.3 | 題號 | ✅ | `int().positive()`；實測 9e15 → INVALID_INPUT、-1 → INVALID_INPUT（E10b/c） |
| 5.4 | 密碼長度 | ⚠️ 無上限 | 受 100KB body 上限約束（E13）；sha256 常數時間，無時序利用。實務影響低 |
| 5.5 | 倒數秒數 | ⚠️ zod 無範圍；domain 擋 | 實測 1e15/1e9 → `COUNTDOWN_OUT_OF_RANGE`（10–3600，`activity.ts:66-73`） |
| 5.6 | NaN／型別混淆 | ✅ | zod `z.number().int()` 擋非數字與非整數；`answers` 非陣列 → INVALID_INPUT（E10d） |
| 5.7 | 未知欄位 | ✅（部分） | `answer:submit`／`activity:fair-ranking` 等用 `strictObject`（實測多餘欄位 INVALID_INPUT，E10e）；但 `group:*`、`activity:open/close/reset` 用寬鬆 `z.object`（`schemas.ts:25-46`）— 僅多餘欄位被忽略，無安全影響 |
| 5.8 | Unicode 混淆（組名） | ✅ | 長度以 code point 計（`groupRegistry.ts:32-34`）、答案 trim 含 U+3000（`answerValidation.ts:15-16`），無 surrogate 截斷問題 |
| 5.9 | 匯入檔案（壓縮炸彈） | ✅ | JSZip 先讀中央目錄累計未壓縮大小，>50MiB 拒絕（`workbookReader.ts:102-132`）；上傳 5MB、下載串流 5MB 上限（`googleSheetsFetcher.ts:96-152`） |
| 5.10 | CSV 公式注入 | ✅ | `safeFormulaGuard` 對 `=+-@` 開頭加 `'`（`csvBuilder.ts:21-23`） |

### 6. 依賴與設定

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 6.1 | production 依賴已知 CVE | ✅ | `npm audit --package-lock-only`：express 5.1.0、socket.io 4.8.1、exceljs 4.4.0、jszip 3.10.2、zod 4.1.12、dotenv 17.2.3 無已知漏洞 |
| 6.2 | dev 依賴 | ⚠️ 建議 | 7 個 moderate（typescript-eslint 鏈 → minimatch ReDoS，GHSA-g3hv-75wg-m249），只在開發工具鏈，不進部署 |
| 6.3 | npm scripts 危險指令 | ✅ | 各 package.json 無 pre/post install 鉤子；僅 fsevents（macOS 原生可選依賴）帶 install script |
| 6.4 | `.gitignore` 擋敏感檔 | ✅ | `.env`、`.env.*`（留 example）、`*.credentials.json`、`*service-account*.json`、`*.pem`、`*.key`、`data/`、`dist/` 全涵蓋 |
| 6.5 | repo 歷史憑證 | ✅ | `git log --all` pickaxe 搜 `TEACHER_PASSWORD=`／`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`／`private_key`：所有命中都在 `.env.example`（值全空）、specs 文件說明與 `config.ts` 程式碼；`.env` 本身從未提交；`git ls-files` 只見 `.env.example` |
| 6.6 | 錯誤處理洩漏 | ✅ | `app.set('env','production')`（`app.ts:74`）；command/廣播例外只記事件名（`commandRouter.ts:132-135`、`broadcaster.ts:105-109`）；`index.ts:383-387` 啟動失敗不傾印環境變數 |

### 7. 部署面

| # | 邊界 | 結果 | 證據 |
|---|---|---|---|
| 7.1 | listen 綁定介面 | ⚠️ 全介面 | `httpServer.listen(port)` 未綁 host（`index.ts:76,326`）；實測 `lsof` 顯示 `*:59749 (LISTEN)`，且 log 主動提示「Other devices on the same network」。**無 HOST 環境變數**（`config.ts` 只有 PORT／DATA_DIR／TEACHER_PASSWORD／GOOGLE_*） |
| 7.2 | 明文 HTTP | ⚠️ | 伺服器不支援 TLS；老師密碼、token、學生答案在 LAN 明文傳輸 |
| 7.3 | 未設老師密碼的啟動行為 | ➖ 不拒絕啟動 | 實測（E1）：未設 `TEACHER_PASSWORD` 伺服器照常監聽、health 200；login 回 503 `TEACHER_PASSWORD_NOT_SET`；空字串密碼 400（zod 先擋）。不會無認證放行，但部署者可能沒發現老師功能全關 |
| 7.4 | PORT 驗證 | ✅ | 0–65535 整數檢查（`config.ts:11-20`） |

---

## 二、發現清單（依嚴重度）

### 阻擋（Blocker）

**BL-1 未認證冒名作答／越組讀取鏈（`/api/student/join` + guest 廣播洩漏 groupId）**
- **影響**：資料外洩（學生作答、題目）＋ 權限冒用（冒任何組作答、污染順位與勝負）。命中威脅模型的全部目標資料。
- **最小重現**（全程未認證，僅需網路可達）：
  1. 無 token 建立 websocket 連線，收 `state` → 取得所有 `groups[].id`；
  2. `POST /api/student/join {"groupId":"<目標組>"}` → 200 + student token；
  3. 帶 token 連線 → 收該組 `myAnswers`、題目全文；
  4. activity open 中 `answer:submit` → `{ok:true}`，老師看板顯示「第二組 submitted 冒名答案1 rank 1」（實測 E4-E5 全鏈成功）。
- **定性**：join 無認證是 spec 的設計（AC-001-09 任何階段可加入、學生無帳號），但「guest 快照含全部 groupId」把組別機密性歸零，兩者相乘在 perimeter 已破的威脅模型下等同無學生邊界。**需要兩組做產品決策**（例如：open 階段凍結 join、join 改用老師產生的一次性組代碼、或至少 guest 快照不含 id）。

### 應修（Should fix）

**SF-1 登入速率限制可被多位址繞過＋無密碼強度政策**
- 重現：對 127.0.0.1 連猜 10 次（429）→ 改連 `[::1]` 立即恢復可猜（E3d）；`TEACHER_PASSWORD` 無最小長度（`config.ts:27`）。IPv6 /64 或多出口下 10/分/IP 形同虛設；老師 token 即全系統權限。
- 修法：失敗計數改全域（或全域+IP 雙層）、指數退避、`TEACHER_PASSWORD` 最小 12 字啟動檢查。
- 注意附帶行為：視窗內即使正確密碼也 429（成功不清除，`authRoutes.ts:113-123`）——對攻擊者無益，但會把剛失誤 10 次的老師鎖 60 秒。

**SF-2 明文 HTTP ＋ 監聽所有介面＋無 HOST 設定**
- 重現：`lsof` 顯示 `*:port`（index.ts:76）；部署後老師密碼、token、作答在 LAN 明文可嗅探。
- 修法：支援 `HOST` 綁定（預設仍可全介面，供課堂 LAN 使用）；文件要求生產走 TLS 反代；否則 token 竊取（嗅探）與 SF-3 疊加成永久接管。

**SF-3 token 無過期、無撤銷；reset 不撤銷**
- 重現：同一 teacher token 開多條連線全部有效（E12）；reset 後舊 student token 仍有效（E12'）。token 一旦洩漏（嗅探、XSS、裝置共用）無任何失效手段，唯一救濟是重啟換 DB 或手動清 sessions。
- 修法：sessions 加 TTL（例如 8 小時）；`activity:reset` 順帶撤銷全部 token（會改行為，需兩組同意）。

**SF-4 並發在途記憶體無上限（C5）**
- 重現：preparing 階段 20 條並發 5MB 上傳 → RSS +157MB 不回落（E11）；速率 ~260MB/s，可放大到 OOM。
- 修法：全域並發上傳數或並發在途總位元組上限（訊號量）。

**SF-5 sessions 無限成長＋join 無節流（C1/C2）**
- 重現：1000 次 join/0.6 秒全部成功，sessions 表 1004 行永不清理（E7）；DB 慢性膨脹至磁碟耗盡。
- 修法：join 依 IP 節流；sessions 定期清理（TTL 或上限）；與 C 決策對齊。

### 建議（Nice to have）

- **NI-1（C3）**：連線數與指令頻率無上限；250 連線下單次廣播讓 health 延遲 2.3 秒（同步快照序列化，E8）。修：每 IP 連線上限、廣播改批次或加背壓。
- **NI-2**：Socket.IO 加 Origin 檢查（`allowRequest` 限同源）— websocket 不受 CORS 保護，目前任何網頁可 drive-by 連線（需知道 IP:port）。
- **NI-3**：zod 層補明確上限（answers 長度、name 長度、password 長度）— 目前靠 domain 第二道防線，建議多層防禦並把 invalid 在 zod 層擋下省 CPU。
- **NI-4**：升級 typescript-eslint 鏈消除 7 個 dev moderate。
- **NI-5**：`/api/*` 404 回 Express 預設 HTML（`Cannot GET`）而非 JSON error body — 一致性問題，順帶避免路徑探測差異。

---

## 三、明確點名：外洩風險 vs 看起來可疑但其實守住

### 確實有外洩／越權風險
1. **guest 廣播洩漏全部 groupId + join 無認證**（BL-1）：作答、題目、順位全可冒名取得與污染。
2. **明文 HTTP + 全介面監聽**（SF-2）：密碼、token、答案可被同網段被動嗅探。
3. **token 永不過期且無撤銷**（SF-3）：與 2 疊加 = 嗅探一次、永久接管。
4. **登入暴力可行**（SF-1）：多位址繞過 + 無密碼政策，前提是老師設了弱密碼。

### 看起來可疑但其實守住（勿誤判）
1. `GET /.env` 回 **200** → 是 SPA fallback 送出 `index.html`（與 `/` 內容 diff 相同）；static 的 dotfile 預設不送出（`app.ts:117`）。不是檔案洩漏。
2. `X-Forwarded-For` 偽造 → Express 5 未設 trust proxy，`request.ip` 不受標頭影響（E3b）。
3. zod 多處無上限（answers 5000 格、組名 100k 字、倒數 1e9 秒、60KB 密碼）→ 全被 domain 層第二道防線擋下（E10）；真正的 zod 缺口只剩「多消耗一點 parse CPU」。
4. 未授權上傳大檔 → `authorizeTeacher` 掛在 `express.raw` **之前**，未授權或階段不對根本不讀 body（E11 第一次全部 409 即證；`questionRoutes.ts:142-151` 註明 T051）。
5. 2MB socket 訊息 → Engine.IO `maxHttpBufferSize`（預設 1MB）直接斷線（E10i）。
6. SSRF（import link）→ 只允許 `https://docs.google.com` 與 `*.googleusercontent.com`、無 port、手動 redirect 白名單（`googleSheetsFetcher.ts:64-76,190-194`）；`docs.google.com.evil.com` 這類繞法被 hostname 精確比對拒絕。
7. 跨組答案可見性 → 伺服器端過濾，第一組連線看不到第二組答案（E5[8]）。
8. `view=projector` 參數 → 非 teacher 身分帶了也只拿到自己的一般快照（E6）。
9. CSV 匯出 → 公式注入有 `safeFormulaGuard` 前綴防護（`csvBuilder.ts:21-23`）。
10. 老師密碼比對 → sha256 後 `timingSafeEqual`，無時序與長度洩漏；錯誤碼單一不洩漏存在性。
11. repo 與歷史 → 無任何真實憑證提交（pickaxe 全命中在空值 example 與文件）。

---

## 四、既有缺口（perf-followups C 節）補充判斷：可用性之外是否成為外洩／越權管道

| C 節缺口 | 是否外洩／權限繞過管道 | 判斷依據 |
|---|---|---|
| C1 合法登入無限 session | **間接是** | 不是直接繞過（每個 session 都經合法登入），但 token 無過期+無撤銷（SF-3）使外洩的 session 永久有效；且表無限成長本身是磁碟耗盡面 |
| C2 student join 無節流無認證 | **是** | join 本身就是無認證的**權限取得**端點：一次呼叫即取得可讀該組作答、可作答的 token。與 guest 洩漏 groupId 相乘成 BL-1。節流只解決可用性，不解決冒名 |
| C3 連線數與指令頻率無上限 | 否（主要可用性） | 改狀態指令都有 role 檢查；`answer:submit` 受「每組每題一次有效」（unique index `submissions_one_valid_per_group_question`，`database.ts:74-76`）約束，垃圾資料注入面有限。250 連線廣播延遲 2.3s 是實測的可用性問題（NI-1） |
| C4 answers 陣列無長度上限 | 否 | zod 缺口屬實，但 `BLANK_COUNT_MISMATCH`（答案數＝空格數，由匯入的學習單決定）+ 單格 200 code point + 1MB 訊息上限三重夾住；無外洩路徑，連有效 DoS 面都小（E10a'） |
| C5 單請求限制管不住並發在途總記憶體 | 否（純可用性） | 實測 +157MB/20 請求；記憶體耗盡只造成阻斷，不產生資料揭露或提權 |
| C6 速率限制 Map 無上限 | 否（輕微） | key 是真實 socket 位址（XFF 無效），entry 極小；真正的問題是它的 IP-key 設計可被多位址繞過（SF-1），而非 Map 成長 |

**結論**：C 節六項中只有 **C2 同時是外洩／冒用管道**（且是 BL-1 的一半），C1 是間接放大器；C3-C6 是純可用性。C2 的修法不能只是節流——節流擋不住一次手工冒名——需要身分或時窗上的設計變更，屬於需要兩組同意的行為改變。

---

## 五、實驗環境與清理紀錄

- 實驗伺服器：本機 node（v26.7.0）跑 `server/dist/index.js`，暫存目錄 `/private/var/folders/…/T/opencode/sec-audit-glm/`，`PORT=0`（OS 分配 59749／60668）、`TEACHER_PASSWORD=audit-pass-2026`（第二實例不設）。DB 落在 repo 的 `data/app.db`（`resolveFromRepositoryRoot` 解析，`paths.ts:15-17`；gitignored）。
- 使用的題目檔：`fixtures/guided-notes/01-official-single.xlsx`（repo 既有 fixture）。
- 附錄 A：各實驗（E1-E13）原始輸出見審計過程紀錄；本報告內文已引用關鍵數字。實驗腳本（attack-chain*.mjs、flood.mjs、zod-mem-token.mjs、e10-e12.mjs）隨暫存目錄一併刪除。
- 清理：兩個實驗伺服器已停止；暫存目錄、repo 內實驗 `data/` 目錄、build 產物（node_modules、各 dist）已刪除，repo 回到實驗前狀態（`git status` 乾淨）。
- 本次審計未修改任何產品程式、未 commit、未 push。

## 六、附錄 A：關鍵實驗輸出（節錄）

```
E3 速率限制：10 次失敗 → 429；XFF:1.2.3.4 → 仍 429；[::1] → 401（恢復可猜）→ 正確密碼 200+token
E4 guest 快照：groups:[{id:"b8f6582e-…",name:"第一組"},{id:"d92b2964-…",name:"第二組"}]（無 questions/myAnswers/board）
E5 冒名鏈：join 200 → role:student myGroupId=第二組 → answer:submit {"ok":true}
   老師 board：第二組 submitted ["冒名答案1"] rank 1；第一組 myAnswers 全 not_submitted（隔離守住）
E6 view=projector：student+projector → role:student；guest+projector → role:guest（無法偽造）
E7 join 洪水：1000 次 in 0.6s（ok=1000）→ sessions 1004 rows、app.db 320KB
E8 連線：250 條 in 88ms；health 0ms；斷一條 student 觸發廣播後 health 延遲 2331ms
E10 zod：answers 5000 → BLANK_COUNT_MISMATCH；9e15/-1 題號 → INVALID_INPUT；countdown 1e15/1e9 → COUNTDOWN_OUT_OF_RANGE；
    name 100k → GROUP_NAME_TOO_LONG；2MB socket 訊息 → 連線被斷；strictObject 多餘欄位 → INVALID_INPUT
E11 並發記憶體（preparing）：20×5MB → 全部 400（FILE_INVALID）但 RSS 121→278MB，5s 後未回落
E12 token：同 token 第 2 條連線 role:teacher；reset 後舊 student token 仍 role:student
E13 body 上限：150KB password → 413
E1 無密碼：伺服器照常啟動；login → 503 TEACHER_PASSWORD_NOT_SET；health 200；空密碼 → 400
```
