# SpecKit 組期末專題 Kickoff Plan：Vibe Coding 課堂搶答系統

> 整理：主控 Opus 5.5（規劃、整合、查核）＋ Kimi K3 Max／NCHC workers（研究、摘要、實測）｜2026-11-10
> 依據：`docs/期末專題說明.pdf`、課程 SpecKit／OpenSpec 教材、`_research/` 內的 5 份研究報告（下方「附錄 A」列出）。
> 這份是**提案**：§8 的待決事項要四人（含 OpenSpec 組）一起拍板。

---

## 0. 一頁結論

1. **主軸只用 Spec Kit（升級到 v1.3.3）**。spec／plan／tasks／diagrams 是評分文件，也是唯一真相來源。其他 skill 只在 Spec Kit 的固定步驟裡「出手」，不另外產生規格。
2. **Superpowers 只取 6 個紀律型 skill**：TDD、systematic-debugging、verification-before-completion、requesting／receiving-code-review、finishing-a-development-branch，用在 implement、review、PR。**不要用** `using-superpowers`、`brainstorming`、`writing-plans`，它們會自己寫 `docs/superpowers/specs|plans/`，搶走流程主導權。
3. **mattpocock／skills 只取 grill 系列**：
   - `/grill-with-docs`：Phase 0 四人共同對齊需求，順手產出共用詞彙表 `GLOSSARY.md` 與決策紀錄 ADR。
   - `/grill-me`：每個子功能 specify 之前用。
   
   `to-spec`、`to-tickets`、`implement-spec` 都會另起一套 spec，避免。（`write-a-prd`、`prd-to-issues` 這兩個名字已不存在。）
4. **pstack 不整包安裝**。
   - 它是 Cursor 的 plugin（MIT 授權，58 個 skill）。核心的 `/poteto-mode`＋23 個 playbook 是另一套任務路由，會跟 Spec Kit 搶主導權。
   - 只借它兩條觀念，寫進 tasks 的驗收條件：「用真實執行結果證明能動」（prove-it-works）、「測行為不測實作」。
5. **最大的兩個待決事項要先跟 OpenSpec 組一起定，並問助教**：
   - (B1) 搶答是「整場開放、每題比快」還是「老師逐題開放」？
   - (C2) 匯出是否必須直接寫回雲端上的原 Google Sheet？若是，需要 Google 憑證。
6. **模型分工正好回應課程「注意 AI 用量」的要求**：
   - Opus 負責需要判斷的步驟：specify、clarify、plan、analyze、converge、review。
   - Kimi K3 Max（NCHC，不吃訂閱額度）負責 implement 與例行工作。
   - 這跟助教的建議同一個精神：主要開發用省用量的模型，分析補漏用較仔細的模型。

---

## 1. 工作模型（誰做什麼）

| 角色 | 做什麼 | 不做什麼 |
|---|---|---|
| **人（組員）** | 拍板需求與取捨、跨組溝通、人工驗證、錄 demo、審 PR | 手寫程式（課程規定由 AI 代理產生） |
| **Opus（Claude Code）** | constitution、specify、clarify、plan、analyze、converge、code review、整合驗收 | 大量例行實作 |
| **Kimi K3 Max（OpenCode／NCHC）** | 依 tasks.md 逐 Phase implement、寫測試、例行修改、文件整理與比對 | 自己決定需求或改規格（只能回報「規格有洞」） |
| **隊友的 agent** | 若隊友用 Codex 或 Claude Code，照同一套 Spec Kit 指令即可（助教建議：主要開發用 GPT-6 Luna XHigh，分析補漏用 GPT-6.1 Sol Med） | — |

三個 agent 呼叫 Spec Kit 的寫法不同（W1 已實測）：

| Agent | 寫法 | 檔案位置 |
|---|---|---|
| Claude Code | `/speckit-specify`（連字號） | `.claude/skills/speckit-*/` |
| OpenCode | `/speckit.specify`（點號） | `.opencode/commands/speckit.*.md` |
| Codex（課程教材用的） | `$speckit-specify` | `.agents/skills/speckit-*/` |

---

## 2. 工具棧：用什麼、用在哪、避開什麼

### 2.1 Spec Kit（骨幹）

- **版本**：本機 1.2.1，最新 **1.3.3**（2026-11-09）。四人都升到同一版：
  `uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git@v1.3.3`
- **完整指令**：constitution、specify、clarify、plan、checklist、tasks、analyze、implement、converge。
  - 課程流程就是這組少掉選用的 checklist。
  - `taskstoissues` 在 1.3.0 已移出核心，要用得另外 `specify extension add github`。我們不需要。
- **多 integration**：我們會同時用 Claude Code 與 OpenCode，隊友可能用 Codex。
  - 建議做法：init 時預設 `claude`，再 `specify integration install opencode`（必要時再裝 codex），三套指令檔都 commit，全組共用。
  - ⚠️ 要先在 Day 1 實測。官方對混合團隊的另一套建議是「基底設為 `none`，各自切換、commit 前切回」，對學生容易出錯，不推薦。
- **`.specify/feature.json`**：記錄「目前在做哪個子功能」，是每份 checkout 自己的狀態，已被 gitignore，所以不會造成合併衝突。
  - **切換子功能**＝改這個檔，或設定 `SPECIFY_FEATURE_DIRECTORY`。
  - 切換 git branch **不會**自動切換子功能。教材 p21 的提醒是對的。
- **git branch**：Spec Kit 核心不建立分支，`specify extension add git` 才會。
  - 建議不裝 git extension（它的 hook 只註冊給預設 agent，多 agent 時容易壞）。
  - 改用手動 `git switch -c NNN-name`，每個子功能一個 branch、一個 PR。
- **編號撞號是兩人並行的最大地雷**：新子功能的編號＝目前 `specs/` 最大號＋1，兩人在不同 branch 同時 specify 會撞號。
  - 對策：事先分配號碼（§5），specify 時在 prompt 寫明「請用 `--number N` 建立」。

### 2.2 Diagram First（評分項，必做）

- 把課程附錄的原則**全文**放進 constitution（§6 已附）。
- **檔名攤平、加子功能前綴**，讓課程指定的指令 `java -jar plantuml.jar "./diagrams/*.puml"` 一次涵蓋全部：
  - `diagrams/000-system-component.puml`：全系統架構
  - `diagrams/001-activity-session-class.puml`、`diagrams/003-buzz-in-seq-submit.puml`……
- **specify 階段的圖只畫概念層**（元件、領域物件、互動），不指定框架。教材 p13 要求 specify 不談工具；到 plan 階段再把圖細化成技術藍圖。
- **光寫在 constitution 不會讓 agent 自動畫圖**（W1 結論）。所以三層保險：
  1. 每次 `/speckit-specify` 的 prompt 範本都明寫畫圖＋render（§7）。
  2. `scripts/render-diagrams.sh`：固定 PlantUML 版本，避免各自的 Graphviz 差異。
  3. `scripts/check-diagrams.sh` 加進 CI：每個子功能都要有三種圖、每個 `.puml` 都要有對應的 PNG。
  
  有餘力再把它做成 Spec Kit extension，在 specify 結束後自動觸發。
- **PlantUML 實測**（W3；本機 Java 21、沒裝 Graphviz）：
  - 官方 stable 版是 **v1.2026.9**。
  - class／component 圖在 `@startuml` 下一行加 `!pragma layout smetana`，就不需要 Graphviz。寫在檔案裡，所以照課程原指令 `java -jar plantuml.jar "./diagrams/*.puml"` 也能跑。另一個寫法是指令加 `-Playout=smetana`。
  - 三張含中文標籤的測試圖都正確產出，存在 `_research/plantuml-test/`，我看過 class 圖。下載 1.6 秒，render 2.9 秒。
  - **jar 不 commit**：`scripts/render-diagrams.sh` 依固定版本下載到 gitignored 的 `tools/`，並核對 SHA-256。腳本草稿在 W3 報告 C.4。
  - Windows 隊友用 Git Bash 或 WSL 跑（PowerShell 版未測）。
- **draw.io（2026-11-10 加入，可手動編輯的補充圖）**：
  - 課程指定 PlantUML，所以 `.puml`＋PNG 仍是評分用的正本，draw.io 不能取代它。
  - 已把 draw.io 官方的 `drawio` skill（`jgraph/drawio-mcp`）裝進專案 `.claude/skills/drawio/`，Claude Code 和 OpenCode 都能用。它直接產生 `.drawio` 檔，不需要 MCP server。
  - 匯出 PNG／SVG 需要 draw.io Desktop（`brew install --cask drawio`，尚未安裝）。不裝也能用：skill 可以產生網址，在瀏覽器的 draw.io 開啟編輯。
  - draw.io 圖放 `diagrams/drawio/`。建議只畫 PlantUML 三種圖以外、你想親手調整的圖（系統總覽、活動狀態機、畫面流程），避免同一張圖維護兩份。
  - 官方 MCP（`@drawio/mcp` 1.11.0）已加進專案：Claude Code 用 `.mcp.json`，OpenCode 用 `opencode.json`。它把圖直接開在瀏覽器的 draw.io 編輯器，不需要 draw.io Desktop。Claude Code 第一次進專案時要按一次核准。
- **implement 之後的「程式↔圖一致」驗證**：tasks.md 的最後一個 Phase 固定放「圖↔程式一致性檢查」task，再搭配 `/speckit-converge`。

### 2.3 Superpowers（v7.0.2）：只取紀律型

| 用 | 時機 |
|---|---|
| `test-driven-development` | implement：先寫會失敗的測試，親眼看它失敗才實作 |
| `verification-before-completion` | implement／converge：沒跑過驗證指令不准說完成 |
| `systematic-debugging` | 測試失敗或 bug：先找根因再修 |
| `requesting-code-review` | 每個 Phase 做完、開 PR 前 |
| `receiving-code-review` | 收到隊友或 Opus 的 review 時：先驗證再改 |
| `finishing-a-development-branch` | 子功能收尾：重跑測試、整理 PR |

**避開**：
- `using-superpowers`：每次對話一開始就強制接管。
- `brainstorming`：自己寫 design 文件並 commit。
- `writing-plans`：自己寫 plan，跟 plan.md、tasks.md 重疊。
- `executing-plans`、`subagent-driven-development`：吃它們自己的 plan 格式。

**安裝方式**：
- 不要整包裝 plugin，因為 plugin 會帶 SessionStart hook 自動載入 `using-superpowers`。
- 只把上面 6 個 skill 從 v7.0.2 放進**專案內的** `.claude/skills/`（MIT 授權，保留 LICENSE）。
- ⚠️ 本機全域 `~/.agents/skills` 也有一整套 superpowers（2026-11-10 已更新到 v7.0.2），包含 brainstorming、writing-plans、using-superpowers，而 OpenCode 會掃到它。專案 `AGENTS.md` 已明文禁用這幾個。
  - Kimi 跑 implement 時，在任務說明裡明確排除這幾個 skill。
  - 或在專案 `opencode.json` 擋掉這幾個 skill（Day 1 實測）。

> 參考做法：lihan3238/speckit-superpowers-bridge 的原則就是「Spec Kit 管 WHAT，Superpowers 管 HOW」。它只驗證到 Spec Kit 1.0.12，所以**照它的規則做，不安裝它**。

### 2.4 mattpocock／skills：只取 grill 系列

| Skill | 行為 | 用在 |
|---|---|---|
| `/grill-with-docs` | 一次一題地追問，並即時寫出 `GLOSSARY.md`（共用詞彙表）與 `docs/adr/NNNN-*.md`（決策紀錄） | **Phase 0 四人對齊**。這兩份產物剛好就是兩組共用的「Feature Contract」地基 |
| `/grill-me` | 只追問、不寫檔 | 每個子功能 specify 之前。結論由我們自己寫進 spec |
| `handoff` | 把對話壓成交接文件 | 換 session、交接給隊友時 |

- 兩個 grill 都只能由人手動觸發，不會自己跳出來搶流程。
- **避開**：`to-spec`、`to-tickets`、`implement-spec`、`implement`、`wayfinder`、`triage`，都會另起一套 spec 或 ticket。
- 安裝：`npx skills@latest add mattpocock/skills`，只勾 `grill-me`、`grilling`、`grill-with-docs`、`domain-modeling`、`handoff`。
- 作者在 README 直接說 Spec Kit「owning the process」是他反對的路線。所以我們的用法是：讓 grill 只負責「問清楚」，產出一律回寫到 Spec Kit 的文件。

### 2.5 pstack（`cursor/plugins/pstack` v0.15.36，MIT）

| 部分 | 判斷 | 我們怎麼用 |
|---|---|---|
| `/poteto-mode`＋23 個 playbook（feature、multi-phase-plan、orchestrate…） | 跟 Spec Kit 的 plan／tasks 重疊，風險最高 | 不用 |
| `architect`、`prototype`、`arena` | 跟 plan 重疊 | 不用；要比較方案時，結果寫進 plan 階段的 research.md |
| `tdd`、`prove-it-works`、`test-behavior-not-implementation` | 互補 | Superpowers 的 TDD 與 verification 已涵蓋；把後兩條觀念寫進 tasks 的驗收條件 |
| `interrogate` | 對抗式 review，只保留可重現的發現 | 選用：大 PR 前跑一次 |
| `statechart`（TLA+／Mermaid） | 對搶答狀態機很誘人，但要裝 TLA+ 工具鏈 | 不建議；改用 Playwright 測同時送出 |
| `opening-a-pr`、`babysit`、`shipping`、`autopilot-*` | 會自動 push、merge | 不用 |

- 如果真的想試：Claude Code 可用 `/plugin marketplace add cursor/plugins`＋`/plugin install pstack@cursor-plugins` 安裝，指令會變成 `/pstack:<name>`。Codex 能不能用沒測過。
- 對兩人專題來說，它多 agent 的 PR 機制是負擔，不是必需。

### 2.6 AI-DLC（課程背景，不另外安裝）

- 課程的 AI-DLC 是 AWS 的方法論，每個活動都走同一個循環：「AI 提案 → 人澄清、核准 → AI 執行 → 人驗證」，關鍵決策留給人。
- 我們的流程本來就是這個結構，寫心得時可以直接用它的詞彙對照：
  - Phase 0 四人 grill ≈ **Mob Elaboration**
  - implement＋review ≈ **Mob Construction**
- `awslabs/aidlc-workflows`（v2.11.3，5 個 phase、33 個 stage）是另一整套流程框架，**不裝**，避免三套流程疊在一起。
- AWS 官方資料裡找不到「Diagram First Development」，它是**課程自訂**的規定。照課程附錄做即可。

---

## 3. 階段流程

### Phase 0：跨組需求對齊（四人一起，11/10–11/11）

1. **輸入**：`_research/00-requirements-analysis.md` §3 的待決清單，共 22 題，分 A 身分、B 流程、C 匯入匯出、D 額外功能、E 技術。
2. **開一場 `/grill-with-docs`**：由你用 Claude Code 主持、分享螢幕、四人一起回答。每個決策都標狀態：
   - `Confirmed`：已確認
   - `Default`：先採預設
   - `Rejected`：不採用
   - `Open`：未決。**Open 不可由任一組的 AI 自行補成 Confirmed**（W4 的 Gate A）。
3. **產出**，放在兩組共用的位置。建議另開一個小 repo（例：`answering-system-contract`），兩組成員都是 collaborator：
   - `GLOSSARY.md`：活動、題目、題組、空格、組別、搶答、搶答成功、順位……
   - `docs/adr/`：B1、C2、A1 等關鍵決策
   - `FEATURE-CONTRACT.md`：
     - 需求 ID（C1–C11、E1–E4）＋選做範圍（兩組必須做同一組額外功能）
     - 狀態機
     - 共同驗收情境 `AC-xxx`（正常、邊界、權限、同時送出、錯誤輸入、Guided Notes 換檔）
     - CSV 欄位
     - demo 腳本骨架
4. **同時在討論區問助教**：草稿在 `00-requirements-analysis.md` §7，尚未送出。

### Phase 1：Repo 起手（11/12，可交給 Kimi worker 做、Opus 驗收）

- **GitHub repo**：main 設保護，必須經 PR 且 1 人 approve；兩位組員都是 collaborator。
- **`specify init`**：

  ```bash
  specify init --here --integration claude --script sh --ignore-agent-tools
  specify integration install opencode   # Day 1 實測
  ```

- **`/speckit-constitution`**：直接貼 §6 草稿。
- **檔案與設定**：
  - `.gitignore`：`.env`、`*.credentials.json`、`tools/`、`_research/`、`docs/*.pdf`（課程教材不公開）
  - `.env.example`
  - `scripts/render-diagrams.sh`、`scripts/check-diagrams.sh`
- **skills**：§2.3 的 6 個紀律型 skill＋§2.4 的 grill 系列，放進專案 `.claude/skills/`。
- **CI**（GitHub Actions）：
  - 測試
  - diagrams render＋檢查
  - secret scan（gitleaks）：配合「不得洩漏金鑰」規定，也是自動驗證的證據
- **AI 對話紀錄**：`docs/ai-logs/` 的命名規則＋匯出 SOP（§4.3）。
- **共同測試用 Guided Notes**：`fixtures/guided-notes/` 放 4 份：
  - 官方單題
  - 官方題組
  - 位移版：表頭不在第 4 列、多一欄、題數不同
  - 壞檔：缺表頭、題號跳號
  
  這些也給 OpenSpec 組共用。

### Phase 2：每個子功能跑一輪（11/13–11/24）

| # | 步驟 | 指令（Claude Code 寫法） | 誰跑 | 搭配 | 過關條件 |
|---|---|---|---|---|---|
| 0 | 追問 | `/grill-me`（選用） | Opus＋人 | grill-me | 子功能邊界、例外情境都說得出答案 |
| 1 | 規格 | `/speckit-specify`＋§7 範本 | Opus | — | spec.md 有 user stories、`AC-xxx`、需求 ID；`diagrams/NNN-*` 三種圖＋PNG |
| 2 | 釐清 | `/speckit-clarify`（重複跑） | Opus＋人 | — | AI 不再提問；**若答案會改變行為，先開跨組 CR** |
| 3 | 檢核清單 | `/speckit-checklist`（選用） | Opus | — | 需求品質清單全過 |
| 4 | 計畫 | `/speckit-plan`＋技術棧 | Opus | — | plan 明確引用 diagrams；圖已細化成技術層；Constitution Check 通過 |
| 5 | 任務 | `/speckit-tasks` | Opus 或 Kimi | — | 每個 Phase 可獨立驗證；最後一個 Phase 含「圖↔程式一致性檢查」與人工驗證項 |
| 6 | 分析 | `/speckit-analyze`（重複跑） | Opus | — | 沒有 CRITICAL／HIGH 問題 |
| 7 | 實作 | OpenCode `/speckit.implement`，**一次一個 Phase** | **Kimi K3 Max** | TDD、verification-before-completion、systematic-debugging | 該 Phase 測試全綠，並附指令輸出 |
| 8 | 審查 | — | Opus | requesting-code-review | 沒有阻擋性問題 |
| 9 | 補漏 | `/speckit-converge`（重複跑） | Opus | — | 出現 `✅ Converged`（converge 只會往 tasks.md 追加任務，不改程式） |
| 10 | 合併 | `gh pr create` | 人＋Opus | finishing-a-development-branch、receiving-code-review | 隊友 approve、CI 綠燈 |

### Phase 3：整合與驗證（11/21–11/24）

- **E2E**：Playwright 開多個瀏覽器 context，模擬老師＋3 組，包含「兩組同時送出」。
- **人工驗證**：用一份**沒看過的** Guided Notes 跑完整流程，記到 `docs/verification/manual-test-log.md`（日期、步驟、結果、截圖）。這是規定裡「人工驗證」的證據。
- **跨組聯合驗收**：兩組用同一份 `AC-xxx` 互相操作對方的系統，差異只能走 CR 修正。
- **11/24 功能凍結。**

### Phase 4：交付（11/25–11/28）

- **demo 腳本**：老師匯入→開啟→兩組送出（老師看板即時更新、學生互看不到）→結束→結果→匯出回 Guided Notes→CSV。
  - 控制在 4 分 30 秒內，錄影、上傳 YouTube。
  - 拍之前用 `/speckit-converge` 和 check-diagrams 再確認一次「程式＝文件＝影片」。
- **表單內容**：系統簡述、repo 與影片連結、AI 對話紀錄、實作方法與心得（模型分工、skill 搭配、踩到的坑）、分工表。
- **11/28 交件**，留 1 天緩衝。期限 11/30（一）00:00，也就是 11/29 晚上。

---

## 4. 分工與協作

### 4.1 SpecKit 組兩人（2026-11-10 依實際分工更新）

| | 你 | 隊友 |
|---|---|---|
| 主要角色 | 大量實作：帶 Fable＋Kimi 跑 Spec Kit 全流程 | Guided Notes、設計、人工驗證 |
| 子功能 | **001** activity-session、**003** buzz-in、**005** fairness-and-extras；002／004 的實作也由你這邊的 agent 跑 | **002** guided-notes-import、**004** export 的規格與驗收：格式規則、測試用學習單、匯入匯出結果是否正確 |
| 設計 | 依 `design/` 的規範實作，不自己決定視覺 | 視覺方向、`design/DESIGN.md`、design tokens、線框圖（draw.io）；審每個畫面 |
| 驗證 | 自動測試（單元、E2E） | 人工驗證：bug、操作流程、使用者體驗；結果記在 `docs/verification/` 並開 GitHub issue |
| 共同 | constitution、需求對齊、demo | 同左 |

- **隊友的貢獻要留在 GitHub 上**（評量表 15%、協作加分）：設計規範、線框圖、測試用學習單、驗證紀錄都走 branch＋PR；bug 與體驗問題開 issue，你修完後由他驗收關閉。
- **設計先於實作**：`design/DESIGN.md` 和 tokens 要在第一個有畫面的子功能進 plan 之前定案，否則 AI 會先用預設樣式做完。
- **問題回流**：隊友開的 issue 由你用 Spec Kit 處理。行為改變的走 specify → … → converge；單純 bug 可用 Spec Kit 內建的 bug extension（`specify extension add bug`，尚未安裝）。
- 號碼仍事先分配（001–005），避免撞號。

#### UI 不要有「AI 味」的做法

「AI 味」多半來自沒有人做決定，AI 就套預設值：Tailwind 預設色、紫藍漸層、Inter 字體、圓角卡片加陰影、置中的大標題、emoji 當圖示、每頁長得一樣。所以重點是**把視覺決定權交給人，並寫成 AI 必須遵守的檔案**。

1. **先定一個跟情境有關的概念**（隊友決定）。這個系統取代的是「上台寫黑板」和搶答，可以從這裡找方向，例如黑板與粉筆、搶答節目的計分板、紙本學習單的格線。老師的投影畫面和學生的手機畫面可以是同一個概念的兩種尺度。
2. **寫成 `design/DESIGN.md`＋design tokens**：色票（含語意：搶答中、已送出、搶答成功）、字體（標題與內文各一，支援繁中）、間距、圓角、邊框、動態。程式裡只能用 token，不准寫死色碼。
3. **列一份禁用清單**寫進 `DESIGN.md`：例如不用漸層背景、不用 emoji 當圖示、不用預設的卡片陰影、不直接用元件庫的預設外觀。
4. **給 AI 看圖**：隊友用 draw.io 畫線框圖（專案已裝 `drawio` skill 和 MCP），或截幾張喜歡的參考畫面放 `design/references/`。實作時把圖交給 agent，比文字描述有效得多。
5. **寫進 constitution**：加一條「介面依 `design/DESIGN.md` 與 tokens 實作，不得使用未定義的樣式」，這樣 `/speckit-analyze` 和 code review 才有依據擋下來。
6. **用 `frontend-design` skill**（已裝進專案）：它專門引導 AI 做出有明確方向、不像範本的視覺。在 plan 階段和做畫面的 task 時使用。
7. **畫面驗收由隊友做**：每個有畫面的 PR 附截圖（老師、學生、手機寬度），隊友對照 `DESIGN.md` 審。

### 4.2 與 OpenSpec 組（功能一致是規定）

**檢查點**：

| 日期 | 檢查點 | 內容 |
|---|---|---|
| 11/11 | Gate A | Feature Contract v1 凍結 |
| 11/16 | Gate B | 互看 spec／proposal，只比「可觀察行為」 |
| 11/20 | Gate C | 互相操作半成品 |
| 11/24 | Gate E | 聯合驗收 |
| 11/26 | 對 demo 腳本 | — |

**任何會改變行為的修改都走 CR**：
- 在共用 repo 開 PR，寫原因、影響的 Feature ID、行為前後差異、受影響的 `AC-xxx`、demo 影響。
- 兩組各至少 1 人 approve 才生效。
- 這同時就是「實作期間有任何改動要與另一小組討論」的書面證據。

**兩組技術可以不同**（OpenSpec 教材用 Python，SpecKit 教材用 TS）。但不能拿「技術不同」解釋行為不同。

**對照方式**（W4 的分析）：
- OpenSpec 的 `proposal` 沒有單一對應文件，最接近 spec.md 的高層內容。
- `design` 對 plan＋diagrams；`spec` 對 spec；`tasks` 對 tasks。
- `verify` 不等於 analyze：最接近的是 implement 的測試證據加上 converge。
- `sync`、`archive` 在 Spec Kit 沒有對應。

**交付時附一張追溯表**：Feature ID → `AC-xxx` → OpenSpec 文件 → SpecKit 文件 → 雙方測試證據 → demo 時間點。

### 4.3 AI 對話紀錄（要繳交，從第一天就留）

- **Claude Code**：每段 session 結束用 `/export` 存到 `docs/ai-logs/YYYYMMDD-<人>-<子功能>-claude.md`。
- **OpenCode**：`opencode export <sessionID>`。
- **Codex**：`~/.codex/sessions/`。
- commit 前跑 gitleaks，並人工掃一次。紀錄裡可能有路徑、email、金鑰。

---

## 5. 建議的 repo 結構

```
answering-system-speckit/
├── .specify/                 # Spec Kit：memory/constitution.md、templates、scripts
├── .claude/skills/           # speckit-*（Spec Kit 產生）＋ 6 個 superpowers 紀律 skill ＋ grill 系列
├── .opencode/commands/       # speckit.*（OpenCode 用）
├── specs/
│   ├── 001-activity-session/   # spec.md plan.md tasks.md research.md data-model.md contracts/ checklists/
│   ├── 002-guided-notes-import/
│   ├── 003-buzz-in/
│   ├── 004-export/
│   └── 005-fairness-and-extras/
├── diagrams/                 # 000-system-component.puml/png、001-…-class.puml/png、003-…-seq-submit.puml/png …
├── docs/
│   ├── shared/               # FEATURE-CONTRACT.md、GLOSSARY.md、adr/（從共用 repo 同步的凍結版本）
│   ├── verification/         # 人工驗證紀錄、聯合驗收結果
│   └── ai-logs/              # 匯出且清理過的 AI 對話
├── scripts/                  # render-diagrams.sh、check-diagrams.sh
├── fixtures/guided-notes/    # 4 份測試用 Guided Notes
├── src/  tests/              # 依 plan 決定
├── tools/                    # plantuml.jar（gitignored，由 script 下載）
└── .env.example
```

**技術棧建議**（plan 階段才正式決定）：
- 前端：TypeScript＋React＋Vite＋Tailwind，同課程範例
- 後端：Node＋Socket.IO，伺服器是唯一真相來源
- 資料：SQLite
- 試算表：exceljs 讀寫 xlsx；C2 若決定寫回雲端，再加 googleapis
- 測試：vitest 單元測試、Playwright E2E

---

## 6. Constitution 草稿（貼在 `/speckit-constitution` 後面）

教材 p12 提醒：constitution 寫大原則，不寫需求與工具。原則 VII 是課程指定，例外保留 PlantUML。

```
這是 NCU SE6005 軟體工程期末專題（課堂搶答系統）的 SpecKit 組專案，屬於學生專題；所有文件以繁體中文撰寫，技術名詞可保留英文。請依下列原則建立 constitution，並為每條原則寫出可檢查的規則：

原則 I：規格是唯一真相來源——系統行為以 specs/ 下各子功能的 spec.md、plan.md、tasks.md 為準，不得另建其他規格或計畫文件。兩小組共同約定的 docs/shared/FEATURE-CONTRACT.md 優先於單一子功能規格；發現牴觸時必須停下並提出變更請求，不得自行改變行為。
原則 II：測試先行——每個功能先寫會失敗的測試再實作，至少包含一個正常案例與一個邊界案例；宣告完成前必須實際執行測試，回報測試指令與結果。
原則 III：輸入驗證與清楚錯誤——所有輸入（包含匯入的外部文件）都要驗證；驗證失敗時不得改變任何資料，並顯示使用者看得懂的錯誤訊息。
原則 IV：機敏資料零落地——密碼、金鑰與憑證只能放在環境變數或本機不受版本控制的檔案，不得出現在程式碼、文件、log、AI 對話紀錄或 git 歷史中。
原則 V：依結構定位，不寫死位置——讀寫外部文件時必須依文件結構（例如表頭、標記、合併範圍）動態定位資料，禁止以固定儲存格座標對應資料。
原則 VI：伺服器是公平與可見性的唯一裁判——先後順序、活動階段與資料可見範圍一律由伺服器判定並強制執行，不信任前端時間，也不以前端隱藏代替權限控管。
原則 VII：圖表生成 (Diagram Generation)
名稱：PlantUML 設計優先 (Design-First with PlantUML)
規則：
規格制定階段 (Specification Phase)：在 speckit.specify 階段，必須使用 PlantUML 語法生成組件圖 (Component diagram)、類別圖 (Class diagram) 和時序圖 (Sequence diagram)。這些圖表檔案 (.puml) 必須儲存在 ./diagrams/ 目錄中。
產物生成 (Artifact Generation)：檔案建立後，必須使用 PlantUML CLI (java -jar plantuml.jar "./diagrams/*.puml") 將所有 .puml 檔案轉換為 PNG 圖片，且輸出的圖片必須儲存在相同的目錄中。
規劃階段 (Planning Phase)：speckit.plan 階段必須將這些圖表作為主要藍圖，用以生成應用程式的架構與組件。
實作階段 (Implementation Phase)：在 speckit.implement 階段完成程式碼生成後，必須執行驗證步驟，以確保最終的程式碼與圖表完全一致。
原則 VIII：可追溯——每項需求有 ID（核心 C1–C11、額外 E1–E4），spec 的驗收情境、tasks、測試與 demo 腳本都必須標註對應的需求 ID。
治理：修改 constitution 需兩位組員同意並記錄版本與理由；會影響兩小組功能一致性的修改，需另一小組同意後才生效。
```

---

## 7. `/speckit-specify` prompt 範本（每個子功能套用）

```
/speckit-specify
子功能：<名稱>（請以 feature 編號 <N> 建立，例如 --number <N>）
對應需求 ID：<例：C2, E1>；共同驗收情境：<AC-002-01…>（見 docs/shared/FEATURE-CONTRACT.md）
使用者與情境：<誰、在什麼階段、要完成什麼>
已確認的行為規則：<只貼 Feature Contract 中 Confirmed 的規則>
Edge cases：<換一份 Guided Notes、題數不符、同時送出、斷線重連…>
不在範圍：<明確列出>
依 constitution 原則 VII：請為本子功能產生組件圖、類別圖、時序圖（PlantUML，只描述概念元件與領域物件，不指定框架），存到 ./diagrams/，檔名以 <NNN>- 開頭，然後執行 scripts/render-diagrams.sh 產生 PNG，並在 spec.md 末尾列出圖檔清單。
```

---

## 8. 待決事項（拍板後才能開 specify）

| # | 事項 | 誰決定 | Opus 建議 |
|---|---|---|---|
| D1 | B1 搶答單位：整場開放 vs 逐題開放 | 四人＋問助教 | 整場開放：最貼近原本課堂情境，狀態機最簡單，demo 最好拍 |
| D2 | C2 匯出：寫回雲端原檔（需憑證）vs 產出同格式 xlsx | 四人＋問助教 | 先問助教；若必須寫回，用 service account，並保留免憑證的 xlsx 路徑 |
| D3 | A1 學生身分：以組登入 vs 個人登入再選組 | 四人 | 以組登入：活動代碼＋組別（＋PIN） |
| D4 | 額外功能範圍（兩組必須相同） | 四人 | 做 E1 題組、E2 CSV、E3 一個簡單的公平規則；E4 挑 1–2 個 demo 好看的 |
| D5 | 兩組契約放哪 | 四人 | 小型共用 repo，變更走 PR，各組至少 1 人 approve |
| D6 | 隊友用哪個 agent | SpecKit 組 | 決定要裝哪些 integration |
| D7 | 要不要報名上台報告（加 5–20%） | SpecKit 組 | 只有準時交件才能報名，名額 4 組 |

---

## 9. 接下來 48 小時

1. **（四人）** 約 Phase 0 grill 會議。用 `00-requirements-analysis.md` §3 當題目，目標是 11/11 凍結 Feature Contract v1。
2. **（你）** 在 eeclass 討論區問助教 4 題（`00` §7）。
3. **（SpecKit 組）** 決定 D6，並各自升級 specify 到 1.3.3。
4. **（我＋Kimi，等你點頭）** 跑 Phase 1 起手：init、integration、skills、render／check scripts、CI、.gitignore、fixtures、constitution。
   - 我會先在暫存資料夾實測「多 integration」與「OpenCode 擋 pipeline skill」兩件事。
   - GitHub repo 要你建，或授權我用 `gh` 建。

---

## 附錄 A：研究報告索引（`_research/`，含課程教材，不要推到公開 repo）

| 檔案 | 內容 | 查核狀態 |
|---|---|---|
| `00-requirements-analysis.md` | 需求 ID、Guided Notes 實測結構、22 題待決清單、風險、拆分、時程、問助教草稿 | Opus 撰寫 |
| `W1-speckit.md` | Spec Kit 1.2.1 實測（三種 integration、feature.json、git extension）＋1.3.x 差異 | 已抽查：temp 專案的 `.gitignore`／feature.json／extensions.yml、release 1.3.3 |
| `W2-skills.md` | Superpowers 15 個 skill 分類、mattpocock 全清單、社群橋接、相容性矩陣 | 已抽查：grill-me／grill-with-docs／domain-modeling 原文、兩個 release、bridge repo |
| `W3-pstack-aidlc-plantuml.md` | pstack 58 個 skill／23 個 playbook 分類、AWS AI-DLC 方法論與 aidlc-workflows v2.11.3、PlantUML v1.2026.9 實測、render 腳本草稿 | 已抽查：pstack plugin.json（0.15.36、MIT）、PlantUML release、`plantuml-test/class.png` 中文顯示正常 |
| `W4-course-tutorials.md` | OpenSpec 33 頁＋流程圖＋SpecKit 22 頁逐頁摘要、兩組對照、協調協定 | 與 Opus 自行抽取的投影片文字一致 |
| `templates/` | 兩份官方 Guided Notes 範本（xlsx） | Opus 解析過結構 |
