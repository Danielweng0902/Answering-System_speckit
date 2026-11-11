# 執行手冊（給監督模型）

> 2026-11-11｜Fable 5.2 撰寫，交給監督模型（Codex／GPT）執行。
> 這份是流程文件，不是規格。系統行為只看 `specs/` 與 `docs/shared/FEATURE-CONTRACT.md`。

## 1. 角色

| 角色 | 誰 | 做什麼 | 不做什麼 |
|---|---|---|---|
| 規劃 | Fable 5.2（已完成） | constitution、001–005 的 spec 與圖、共用架構、001 的 plan 與 tasks、本手冊 | — |
| 監督（主模型） | Claude Opus 5.5（2026-11-12 起；之前為 Codex） | 思考、拆工、派工、審查 diff、執行測試、驗收、整合；跑 Spec Kit 的 clarify、plan、tasks、analyze、converge | 自己大量寫程式；自行改變規格行為 |
| 實作 worker | Kimi K3（`nchc/Kimi-K3`） | 一般實作：依 tasks.md 寫測試與程式（worker 沒有 shell，測試由監督執行） | 決定需求；改 spec、plan、contracts；改範圍外的檔案 |
| 多模態 worker | Kimi K3 Max（`nchc/Kimi-K3-max`） | 需要看圖的工作：wireframe、PlantUML／draw.io PNG、畫面截圖對照（`image_path` 附一張 PNG/JPEG） | 同上 |
| 安全／複查 worker | GLM-5.3-max（`nchc/GLM-5.3-max`） | 安全與邊界：可見範圍、機敏資料、token／密碼處理、輸入驗證、與規格的差異；獨立複查只回報發現 | 修改程式 |
| 人 | 兩位組員 | 需求決定、跨組溝通、設計規範、人工驗證、commit 與 push 的決定 | 手寫程式 |

Worker 的呼叫方式依你的環境而定（OpenCode worker 工具或其他委派工具）。**模型固定**：一般實作用 `nchc/Kimi-K3`，多模態用 `nchc/Kimi-K3-max`，安全與複查用 `nchc/GLM-5.3-max`。不可用時回報原因並停下，不要自行換模型。

本專案於 2026-11-11 依使用者指示改用 K3 常駐實作 worker；2026-11-12 起監督改為 Claude Opus 5.5，並加入 K3 Max 作為多模態 worker。opencode-worker 每份設定只有 `kimi`、`glm` 兩個 profile，所以三個模型用兩份設定選擇：

| 模型 | bridge 設定 | profile |
|---|---|---|
| `nchc/Kimi-K3` | `--config ~/.config/opencode-worker/projects/answering-system-speckit.json` | `kimi`（預設） |
| `nchc/GLM-5.3-max` | 同上 | `glm` |
| `nchc/Kimi-K3-max` | 不加 `--config`（全域 `~/.config/opencode-worker/config.json`） | `kimi`（預設） |

續作（continue、validate）必須用建立 job 時的同一份設定，否則會被模型一致性檢查拒絕。

## 2. 目前狀態

| 項目 | 狀態 |
|---|---|
| Constitution 1.0.0 | 完成（`.specify/memory/constitution.md`；開頭的 Sync Impact Report 註解在第一次 commit 前刪除） |
| Feature Contract v0.2 | 草稿，**尚待 OpenSpec 組確認**（`docs/shared/FEATURE-CONTRACT.md`） |
| 001 activity-session | analyze 已由監督覆核；Phase 1（T001–T008）骨架通過自動檢查；Phase 2 尚未實作，見 `docs/verification/001-phase1-automated.md` |
| 002 guided-notes-import | spec、圖完成 |
| 003 buzz-in | spec、圖完成 |
| 004 export | spec、圖完成 |
| 005 fairness-and-extras | spec、圖完成 |
| 測試用學習單 | `fixtures/guided-notes/`（8 份＋`expected.json`＋驗證腳本） |
| 設計規範 | `design/DESIGN.md` 尚未建立（隊友負責）；介面先用暫定 token |
| Git | 已 `git init`、已設定 `origin`，**尚無任何 commit** |

## 3. 必讀文件（依序）

1. `AGENTS.md`：專案規則、可用與禁用的 skill。
2. `.specify/memory/constitution.md`：9 條原則。
3. `docs/shared/FEATURE-CONTRACT.md`：兩小組共同的行為約定與需求編號。
4. `specs/001-activity-session/research.md`：**整個系統共用的技術決策**，002–005 不重新選型。
5. 要處理的子功能的 `spec.md`，以及 `diagrams/<NNN>-*.puml`。

## 4. Spec Kit 指令

在 Codex 中的寫法是 `$speckit-<名稱>`（skill 在 `.agents/skills/`）。Claude Code 是 `/speckit-<名稱>`，OpenCode 是 `/speckit.<名稱>`。

**切換子功能**：Spec Kit 以 `.specify/feature.json` 決定目前的子功能，切換 git branch 不會改變它。開始處理某個子功能前先寫入：

```bash
printf '{"feature_directory":"specs/002-guided-notes-import"}\n' > .specify/feature.json
```

每次跑指令前確認這個檔指向正確的子功能。

## 5. 執行順序

```text
001 ──▶ 003 ──▶ 005
  └──▶ 002 ──▶ 004（也需要 003 的結果）
```

建議：001 →（002 與 003 的 plan 可以先後進行，實作時 002 先）→ 003 → 004 → 005。一次只讓一個子功能進入實作，除非兩個子功能修改的檔案完全不重疊。

## 6. 每個子功能的流程與關卡

| 步驟 | 指令 | 誰 | 過關條件 |
|---|---|---|---|
| 1 釐清 | `$speckit-clarify` | 監督＋人 | 沒有未解決的問題。答案會改變行為時，先更新 Feature Contract 並請人確認，不自行決定 |
| 2 計畫 | `$speckit-plan` | 監督 | 沿用共用架構；Constitution Check 全過；plan.md 有「圖表與模組對應」表；contracts 有錯誤代碼與對應的 FR／AC |
| 3 任務 | `$speckit-tasks` | 監督 | 每個 user story 先測試後實作；每個 task 有檔案路徑與 FR／AC；最後一個 Phase 含圖與程式一致性檢查、自動驗證紀錄、人工驗證 |
| 4 分析 | `$speckit-analyze` | 監督 | 沒有 CRITICAL 或 HIGH 的問題；有就回頭修文件再跑 |
| 5 實作 | 派工，一次一個 Phase | Kimi K3 | 見 §7 的驗收 |
| 6 複查 | 派工 | GLM-5.3-max | 見 §8；發現的問題由監督判斷後再派 Kimi 修 |
| 7 補漏 | `$speckit-converge` | 監督 | 顯示已收斂；否則依新增的 task 回到步驟 5 |
| 8 收尾 | — | 監督＋人 | 全部測試、`npm run check`、人工驗證紀錄齊全 |

001 已完成步驟 1–3（clarify 由組員直接確認了組名 30 字元、最多 50 組）。**2026-11-11 更新：analyze 已覆核，Phase 1 已通過；接續 Phase 2（T009–T028）。**

## 7. 派工給 Kimi K3

一次只派一個 Phase。派工內容用下面的格式，缺一段都不行。

```text
你是實作 worker。自己完成工作，不要再委派給其他代理。
在貼出驗收指令的實際輸出之前，不要結束。

目標：實作 specs/<NNN-name>/tasks.md 的 Phase <N>（T0xx–T0yy）。
原因：<這個 Phase 交付什麼、對應哪些驗收情境>

必讀：AGENTS.md、.specify/memory/constitution.md、
      specs/<NNN-name>/spec.md、plan.md、data-model.md、contracts/、tasks.md、
      specs/001-activity-session/research.md

做法：
1. 先寫這個 Phase 的測試，執行並確認失敗，把失敗輸出記下來。
2. 實作到測試通過。
3. 在 tasks.md 把完成的 task 勾成 [x]。

可以修改：<列出檔案或目錄>
不可以修改：spec.md、plan.md、contracts/、constitution、其他子功能的檔案、已勾選完成的測試
不要使用的 skill：using-superpowers、brainstorming、writing-plans、executing-plans、subagent-driven-development
不要執行：git commit、git push、安裝全域套件

停止並回報的情況：規格或 contracts 有矛盾或缺漏；需要修改範圍外的檔案；
同一個錯誤修兩次仍失敗；需要任何密碼或金鑰。

驗收（貼出實際輸出）：
- npm test
- npm run check
- <這個 Phase 的 Checkpoint>

回報格式：
結果：<一句話>
修改的檔案：<清單>
測試先失敗的證據：<指令與輸出摘要>
驗收輸出：<實際輸出>
沒做或有疑慮的地方：<清單，沒有就寫「無」與理由>
```

**監督的驗收**（不能只信回報）：

1. 自己重跑 `npm test` 與 `npm run check`。
2. 看完整的 diff：有沒有改到範圍外的檔案、有沒有刪掉或放寬既有測試、有沒有寫死的座標或密碼。
3. 對照 contracts：錯誤代碼、快照欄位、可見範圍是否一致。
4. 不合格就把具體問題交回同一個 worker 修；同一問題兩輪仍失敗，改由監督自己分析原因後再派。

**已知狀況**：Kimi K3 有時會在工作中途就結束並回覆一句進度說明。收到沒有驗收輸出的回報時，先檢查實際檔案狀態，再用「目前狀態＋剩餘工作」重新派工。

## 8. 派工給 GLM-5.3-max（複查）

每個子功能實作完成後派一次，重要的 Phase（003 的順位與可見範圍、004 的寫入）可以多派一次。

```text
你是複查 worker。只讀不改，不要修改任何檔案，不要再委派。

範圍：<子功能> 的實作（<檔案或目錄>）。
對照：specs/<NNN-name>/spec.md、contracts/、.specify/memory/constitution.md

請找出並回報（每一項都要有檔案與行號，以及能重現的步驟或測試）：
1. 與 spec 的 FR 或驗收情境不一致的行為。
2. 可見範圍：學生或訪客是否可能收到不該看到的資料（原則 VI）。
3. 輸入驗證缺漏；驗證失敗後資料是否被改變（原則 III）。
4. 機敏資料是否出現在程式、log、回應中（原則 IV）。
5. 寫死的儲存格位置或其他寫死的對應（原則 V）。
6. 並行與順序：同時送出、重複送出、結束瞬間送出。
7. 沒有測試涵蓋的 FR。

不要回報風格與命名問題。沒有發現就寫「沒有發現」。
```

監督逐項判斷：能重現的才採納，交給 Kimi 修並補測試。

## 9. 002–005 的架構指引

這些是寫 plan 時要遵守的方向，細節在各自的 `$speckit-plan` 決定。全部沿用 001 的結構：`server/src/domain`（純邏輯）、`app`（用例）、`infra`、`web/src/features`、`shared/src/protocol.ts`，以及「指令＋依身分過濾的完整快照」的同步方式。

### 002 guided-notes-import

- 試算表用 `exceljs` 讀取。解析器放 `server/src/domain/guidedNotes/parser.ts`，輸入活頁簿、輸出「題目與空格」或錯誤，不做 I/O。
- 定位方式：掃描所有工作表，找同一列中同時出現「題號」「題目」「作答」的表頭列，記下三個欄位；往下逐列讀題號。題號格的垂直合併範圍決定題組；作答格若在合併範圍內取左上角。**不得出現任何固定的列號或欄位字母。**
- 第一個測試就用 `fixtures/guided-notes/expected.json` 逐檔比對（8 份全部）。現有的 `fixtures/guided-notes/_build/verify_fixtures.py` 是獨立的 Python 參考實作，可用來對照，不要在產品程式中呼叫它。
- 原檔的位元組存進 SQLite（BLOB），供 004 匯出；每個空格保存工作表名稱與儲存格位置。
- Google Sheets 連結：從連結取出試算表 ID，改用 `https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx` 下載；只允許 `docs.google.com` 網域，設定大小上限與逾時。連結取得的測試以假的 HTTP 回應進行，不依賴網路。
- 檔案上傳用 HTTP（multipart），上限 5 MB；「讀取→摘要→確認」是兩步：摘要暫存在伺服器，確認時才取代題目。
- 完成後，把「開啟搶答需要至少一題」接到 001 的 `open` 條件（spec 002 FR-020）。

### 003 buzz-in

- `submissions` 表：`seq INTEGER PRIMARY KEY AUTOINCREMENT`（送達序號）、`group_id`、`question_id`、`received_at`，`UNIQUE(group_id, question_id)`。`blank_answers` 表存每個空格的答案。受理在單一交易內完成；`node:sqlite` 是同步的，所以送達序號天然不重複。
- 順位以介面抽象：`RankingRule.rank(submissionsOfQuestion) → ranks`，003 實作「先到先得」，005 加入公平規則。
- **可見範圍在伺服器產生快照時過濾**，不是在前端隱藏：搶答中，學生快照只含自己組的作答，不含順位、不含任何其他組的資料或數量；已結束才加入結果與自己組的順位。為這一點寫專門的測試：擷取學生連線收到的每一則訊息並斷言。
- 老師快照含完整看板。
- 尚未送出的草稿存在前端的 sessionStorage。
- 用 001 的 `onReset` 掛載點清空作答。
- E2E 要有「兩組幾乎同時送出同一題」與「同組兩人同時送出」。

### 004 export

- 以 `exceljs` 載入保存的原檔位元組，在每個空格的位置寫入「前綴＋答案」，另存後下載。寫入時把儲存格設為文字，避免 `=` 開頭被當成公式。
- **風險**：`exceljs` 讀寫一輪後，格式（合併、欄寬、框線）可能有細微變化。plan 階段先做一個小實驗：把 5 份有效 fixture 讀入再寫出，比較合併範圍、欄寬、非填空格的內容。若不能保持，改為直接修改 xlsx 內的工作表 XML（以 `jszip` 只改目標儲存格）。把實驗結果寫進 research.md。
- CSV：UTF-8 加 BOM；欄位含逗號、引號、換行時加引號；以 `=`、`+`、`-`、`@` 開頭的內容前面加單引號。
- 匯出走 HTTP 下載，檢查老師身分與「已結束」。
- 測試：5 份有效 fixture 各跑一次「匯入→作答→結束→匯出→重新讀取」，確認答案在 `expected.json` 的位置，其他儲存格不變。

### 005 fairness-and-extras

- `FairRankingRule` 實作 `RankingRule`。判定只依保存的 `received_at` 與 `seq`，是純函式；「目前成功題數」只計已判定的題目；題目依第一個答案的送達時間依序判定。同一組資料重算必須得到相同結果，重啟後由保存的資料重建。
- 3 秒的排程用與 001 倒數相同的可注入時鐘；活動結束時立即判定所有判定中的題目。
- 活動設定（是否啟用公平順位）加在 `activity` 表，只有準備中可改，重設時回到預設。
- 投影看板是另一種快照（由老師身分開啟的 `/projector` 頁面）：搶答中不含任何作答資料與數量。為此寫與 003 相同形式的「不外洩」測試。
- 004 的 CSV 與結果畫面要加上公平順位的標示；這是對 003、004 的小幅修改，在 005 的 tasks 中明列。

## 10. 設計規範（原則 IX）

- 介面只引用 `web/src/styles/tokens.css` 的變數。`design/DESIGN.md` 定案前使用暫定 token。
- `design/DESIGN.md` 出現後：開一個獨立的工作，把 token 與版面換成設計規範；可使用 `frontend-design` skill 與 `design/references/`、`design/wireframes/` 的內容。
- 每個含畫面的變更附三張截圖（老師端、學生端、手機寬度），交給設計負責人驗收。

## 11. Git、commit 與 PR

- **目前使用者的指示：等有初步成果再 commit 與 push。** 第一次 commit 與 push 之前，先問使用者。Repo 是公開的。
- 第一次 commit 之前：刪除 constitution 開頭的 Sync Impact Report 註解；確認 `git status` 中沒有 `.env`、`_research/`、`docs/*.pdf`、`design/references/screenshots/`、`tools/`、`data/`。
- 之後：一個子功能一個 branch（`001-activity-session` 等）與一個 PR，不直接 push 到 `main`；合併前要另一位組員審查。
- Worker 不執行任何 git 寫入指令。

## 12. 需要停下來問人的情況

- 規格、contracts、Feature Contract 之間有矛盾，或有規格沒涵蓋的行為。
- 任何會改變使用者看得到的行為的修改（需要 OpenSpec 組同意）。
- 助教對「匯出方式」或「搶答方式」的回覆與目前的預設不同。
- 需要任何密碼、金鑰、帳號。
- 要做 commit、push、開 PR、安裝全域工具。
- 同一個問題修了兩輪仍然失敗。

## 13. 每個子功能完成時要留下的證據

- `docs/verification/<NNN>-automated.md`：測試與檢查的指令和輸出。
- `docs/verification/<NNN>-diagram-consistency.md`：圖與程式的核對結果。
- `docs/verification/<NNN>-manual.md`：人工驗證（由組員填）。
- `docs/ai-logs/`：這個子功能的 AI 對話紀錄（匯出後檢查不含機敏資料）。繳交作業需要。
