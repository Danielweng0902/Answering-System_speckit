<!--
Sync Impact Report（審閱用，commit 前移除）
- 版本：範本（未定義）→ 1.0.0（初版）
- 新增原則：I–IX（範本預設 5 條，依專案需要擴充為 9 條）
- 新增章節：專案限制、開發流程與品質關卡、治理
- 移除章節：無
- 待辦：design/DESIGN.md 尚未定案（原則 IX 已規定定案前的做法）
-->

# 課堂搶答系統（SpecKit 組）Constitution

NCU SE6005 軟體工程期末專題。所有文件以繁體中文撰寫，技術名詞可保留英文。

## Core Principles

### I. 規格是唯一真相來源

- 系統行為 MUST 以 `specs/` 下各子功能的 `spec.md`、`plan.md`、`tasks.md` 為準。
- MUST NOT 另外建立其他規格、設計或計畫文件來描述系統行為。
- 兩小組共同約定的 `docs/shared/FEATURE-CONTRACT.md` 優先於單一子功能規格。
- 發現規格之間、或規格與 Feature Contract 牴觸時，MUST 停下並提出變更請求；MUST NOT 自行決定或改變行為。

理由：課程檢驗規格文件，並要求程式、文件、Demo 影片一致，也要求兩小組功能一致。

### II. 測試先行（不可妥協）

- 每個功能 MUST 先寫會失敗的測試，確認它失敗，再實作到通過。
- 每個功能 MUST 至少有一個正常案例與一個邊界案例的測試。
- 宣告完成前 MUST 實際執行測試，並回報測試指令與輸出結果；沒有執行證據不得宣告完成。

理由：程式由 AI 代理產生，測試是確認行為符合規格的主要依據。

### III. 輸入驗證與清楚錯誤

- 所有輸入 MUST 經過驗證，包含使用者輸入與匯入的外部文件。
- 驗證失敗時 MUST NOT 改變任何已存在的資料。
- 驗證失敗時 MUST 顯示使用者看得懂的錯誤訊息，說明哪裡有問題。

### IV. 機敏資料零落地

- 密碼、金鑰、憑證 MUST 只存在環境變數或本機不受版本控制的檔案。
- 機敏資料 MUST NOT 出現在程式碼、文件、log、AI 對話紀錄或 git 歷史中。
- repo 只提供不含真實值的範例設定檔（`.env.example`）。

理由：課程明文禁止在文件、程式碼或 repo 中洩漏機敏資料。

### V. 依結構定位，不寫死位置

- 讀寫外部文件時 MUST 依文件結構動態定位資料，例如表頭、標記、合併範圍。
- MUST NOT 以固定儲存格座標對應資料（例如「第一題答案寫到 C19」）。
- 匯入與匯出功能 MUST 以 `fixtures/guided-notes/` 中版面不同的測試檔驗證。

理由：助教會使用另一份 Guided Notes 測試。

### VI. 伺服器是公平與可見性的唯一裁判

- 先後順序、活動階段、資料可見範圍 MUST 由伺服器判定並強制執行。
- MUST NOT 信任前端傳來的時間或順序。
- MUST NOT 以前端隱藏代替權限控管；使用者不該看到的資料不得傳送到其前端。

理由：搶答的公平性與「結束前看不到其他組狀況」必須無法從前端繞過。

### VII. 圖表生成 (Diagram Generation)

名稱：PlantUML 設計優先 (Design-First with PlantUML)

規則：

規格制定階段 (Specification Phase)：
在 speckit.specify 階段，必須使用 PlantUML 語法生成組件圖 (Component diagram)、類別圖 (Class diagram) 和時序圖 (Sequence diagram)。這些圖表檔案 (.puml) 必須儲存在 ./diagrams/ 目錄中。

產物生成 (Artifact Generation)：
檔案建立後，必須使用 PlantUML CLI (java -jar plantuml.jar "./diagrams/*.puml") 將所有 .puml 檔案轉換為 PNG 圖片，且輸出的圖片必須儲存在相同的目錄中。

規劃階段 (Planning Phase)：
speckit.plan 階段必須將這些圖表作為主要藍圖，用以生成應用程式的架構與組件。

實作階段 (Implementation Phase)：
在 speckit.implement 階段完成程式碼生成後，必須執行驗證步驟，以確保最終的程式碼與圖表完全一致。

本專案的補充規定：

- 圖檔命名 MUST 為 `diagrams/<NNN>-<子功能>-component.puml`、`-class.puml`、`-seq-<情境>.puml`。
- `scripts/render-diagrams.sh` 包裝上述 PlantUML CLI 指令並固定 PlantUML 版本；產生 PNG MUST 使用此腳本。
- `scripts/check-diagrams.sh` MUST 通過：每個子功能三種圖齊全，每個 `.puml` 都有不過期的 PNG。
- draw.io 圖只能放在 `diagrams/drawio/` 作為補充，MUST NOT 取代 PlantUML 圖，內容不得與之矛盾。

### VIII. 可追溯

- 每項需求 MUST 有 ID：核心 C1–C11、額外 E1–E4（定義於 `docs/shared/FEATURE-CONTRACT.md`）。
- spec 的驗收情境、tasks、測試、demo 腳本 MUST 標註對應的需求 ID。
- 每項核心需求 MUST 至少對應一個驗收情境與一個測試。

### IX. 設計規範先於介面實作

- 使用者介面 MUST 依 `design/DESIGN.md` 與其 design tokens 實作。
- MUST NOT 使用未在設計規範中定義的色彩、字體或樣式。
- 每個含畫面的變更 MUST 附截圖，供設計負責人驗收。
- `design/DESIGN.md` 尚未定案前，介面只做結構與功能，MUST NOT 做視覺定稿。

理由：避免 AI 代理套用預設樣式，讓介面有一致且由人決定的視覺。

## 專案限制

- 本專案以 AI 代理開發，成員不手寫程式碼；成員負責決策、檢查文件與人工驗證。
- 系統只需在本機運行與操作，不需架設可供其他設備連線的伺服器。
- 系統除 AI 自動驗證外，MUST 進行人工驗證，並將結果記錄在 `docs/verification/`。
- 與 AI 代理的對話紀錄 MUST 保存，供繳交使用；保存前 MUST 檢查不含機敏資料。

## 開發流程與品質關卡

- 每個子功能依序進行：specify → clarify → plan → tasks → analyze → implement → converge。
- 每個子功能使用獨立的 branch 與 pull request；MUST NOT 直接 push 到 `main`。
- 進入 implement 前，analyze MUST 沒有未解決的重大問題。
- implement MUST 依 tasks 的 Phase 進行；前一個 Phase 的測試通過後才能進入下一個。
- 合併前 MUST 通過：全部測試、`scripts/check-diagrams.sh`、另一位組員的審查。

## Governance

- 本 constitution 優先於其他開發慣例；plan 與 code review MUST 檢查是否符合各項原則。
- 修改 constitution MUST 經兩位組員同意，並記錄版本與理由。
- 會影響兩小組功能一致性的修改，MUST 經另一小組（OpenSpec 組）同意後才生效。
- 版本採語意化版本：移除或重新定義原則為 MAJOR；新增原則或章節為 MINOR；文字釐清為 PATCH。
- AI 代理的執行期規則見 `AGENTS.md`。

**Version**: 1.0.0 | **Ratified**: 2026-11-10 | **Last Amended**: 2026-11-10
