# 專案規則（所有 AI 代理都要遵守）

NCU SE6005 軟體工程期末專題：課堂搶答系統（SpecKit 組）。文件用繁體中文，技術名詞可保留英文。

## 1. Spec Kit 是唯一的規格來源

- 系統行為只以 `specs/<NNN-name>/` 下的 `spec.md`、`plan.md`、`tasks.md` 與 `.specify/memory/constitution.md` 為準。
- 流程：constitution → specify → clarify → plan → tasks → analyze → implement → converge。
- 不得另外建立規格、設計或計畫文件（例如 `docs/superpowers/`、`.scratch/`、issue tracker 上的 spec）。
- 發現規格有洞或互相矛盾時：停下來回報，不要自己決定行為。

## 1.1 分工與入口

- 監督模型（Claude Opus 5.5）、一般實作 worker（Kimi K3）、多模態 worker（Kimi K3 Max）、安全／複查 worker（GLM-5.3-max）的分工、派工格式與每個子功能的關卡，見 `docs/EXECUTION-PLAYBOOK.md`。開始工作前先讀它。
- 整個系統共用的技術決策在 `specs/001-activity-session/research.md`，其他子功能不重新選型。
- 兩小組共同的行為約定在 `docs/shared/FEATURE-CONTRACT.md`。
- Spec Kit 指令寫法：Codex 用 `$speckit-<名稱>`，Claude Code 用 `/speckit-<名稱>`，OpenCode 用 `/speckit.<名稱>`。目前的子功能由 `.specify/feature.json` 決定。
- commit、push、開 PR 之前先問使用者；worker 不執行 git 寫入指令。

## 2. 可以用與不可以用的 skill

可以用（已放在 `.claude/skills/`）：

- 實作紀律：`test-driven-development`、`systematic-debugging`、`verification-before-completion`、`requesting-code-review`、`receiving-code-review`、`finishing-a-development-branch`
- 需求追問（只由人手動觸發）：`grill-me`、`grill-with-docs`；交接：`handoff`
- 審查與寫作（只由人手動觸發，來自 pstack）：`interrogate`（對抗式審查，只回報發現、不改程式）、`how`、`why`、`technical-writing`、`unslop`。`arena`、`in-your-own-words` 只是 `interrogate` 的依賴，不單獨使用。
- 畫圖：`drawio`（補充圖，見第 3 節）
- 介面設計：`frontend-design`。有 `design/DESIGN.md` 之後，介面一律依它與 design tokens 實作，不自行決定視覺。

不可以用（即使你的環境裡看得到）：

- `using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`subagent-driven-development`
- 任何會自己產生 spec、plan、ticket 的 skill（例如 `to-spec`、`to-tickets`、`implement-spec`）
- pstack 的 `poteto-mode` 與其 playbook（本專案沒有安裝，也不要另外安裝）

## 3. 硬性規定（來自課程）

- 讀寫 Guided Notes 必須依結構定位（表頭、合併範圍），禁止寫死儲存格座標。測試檔在 `fixtures/guided-notes/`。
- 密碼、金鑰、憑證不得出現在程式碼、文件、log 或 git 歷史；只放 `.env`（已 gitignore）。
- 每個子功能都要有組件圖、類別圖、時序圖：PlantUML 原始檔 `diagrams/*.puml` 加上 PlantUML CLI 產生的 PNG。這是評分依據，也是圖的唯一正本。
- draw.io 圖（`drawio` skill）只放 `diagrams/drawio/`，用於可手動編輯的補充圖；內容不得與 `.puml` 矛盾，`.puml` 改了要同步更新。
- draw.io 匯出 PNG／SVG 用 draw.io Desktop 的指令列（`/Applications/draw.io.app/Contents/MacOS/draw.io -x -f png -e -o <輸出> <輸入>`）。在已經有沙箱的代理 session 裡若出現 `Failed to initialize sandbox`，加上 `--no-sandbox`。
- 宣告完成前必須實際執行測試，並回報指令與輸出。

## 4. 協作

- 一個子功能一個 branch、一個 PR；不直接 push 到 `main`。
- 會改變系統行為的修改，要先經另一小組（OpenSpec 組）同意。
