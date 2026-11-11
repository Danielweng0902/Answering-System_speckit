# Research: 技術決策（整個系統共用）

本檔的決策適用於 001–005。後續子功能的 plan 只記錄各自新增的決策，不重新選型。

## R1 語言與執行環境

- **Decision**: 前後端都用 TypeScript；Node.js 24 以上。
- **Rationale**: 一種語言即可涵蓋前後端與共用型別；與課程 SpecKit 教材的範例（TypeScript、React、Vite、vitest）一致；組員已確認。
- **Alternatives considered**: Python 後端（FastAPI）＋ React：試算表處理較熟悉，但要維護兩種語言與兩套型別。

## R2 即時同步

- **Decision**: Socket.IO。伺服器在每次狀態改變後，向每個連線推送一份「依身分過濾的完整狀態快照」（事件名 `state`）。前端不合併差異，只以最新快照重畫。
- **Rationale**: 需求是雙向即時（學生送出、老師看板、階段同步）與自動重連，Socket.IO 都內建。推送完整快照讓重新整理、斷線重連、後進場都走同一條路，不會有「漏掉一則更新就永遠不同步」的問題。資料量很小（最多 50 組、數十題），完整快照的成本可以忽略。
- **Alternatives considered**: SSE＋HTTP POST：較簡單，但學生送出需要另一條通道，重連與身分要自己處理。只推送差異：省流量但容易不同步，這個規模不需要。

## R3 指令與回覆

- **Decision**: 改變狀態的操作一律是 Socket.IO 帶回覆（ack）的指令，回覆為 `{ ok: true }` 或 `{ ok: false, error: { code, message } }`。HTTP 只用於登入、進場、檔案上傳下載。
- **Rationale**: 指令成功與否由回覆告知，畫面更新由隨後的快照負責，兩者分開後前端邏輯很單純。錯誤代碼固定，測試可以直接比對。
- **Alternatives considered**: 全部用 REST：可行，但同時維護 REST 與 Socket 兩套驗證。

## R4 身分與多分頁

- **Decision**: 登入或進場成功後，伺服器發給一個隨機的身分憑據（token），前端存在 **sessionStorage**（每個瀏覽器分頁各自獨立），連線時放在 Socket.IO 的 handshake。伺服器只保存 token 的雜湊值與對應的身分。
- **Rationale**: Demo 影片必須在同一台電腦同時呈現老師與至少兩組學生。若用 cookie，同一個瀏覽器的所有分頁會共用同一個身分，無法這樣操作。sessionStorage 在同一分頁重新整理後仍在（滿足 FR-020），不同分頁互不影響。
- **Alternatives considered**: Cookie：同瀏覽器只能一個身分，demo 需要開多個瀏覽器或無痕視窗。localStorage：所有分頁共用，同樣不行。
- **備註**: 系統只在本機運行，token 以 HTTPS 以外的方式傳輸可以接受；token 不寫入 log。

## R5 老師密碼

- **Decision**: 從環境變數 `TEACHER_PASSWORD` 讀取；未設定時老師登入一律回覆 `TEACHER_PASSWORD_NOT_SET`。比對使用固定時間比較。登入失敗有簡單的次數限制（每個來源每分鐘 10 次）。
- **Rationale**: 符合原則 IV 與 FR-002、FR-003。只有一位老師、一組密碼，不需要帳號系統。
- **Alternatives considered**: 啟動時在終端機印出一次性密碼：不用設定，但每次重啟都變，demo 與測試不方便。

## R6 資料保存

- **Decision**: SQLite 單一檔案，使用 Node 內建的 `node:sqlite`（同步 API）。每個指令在一個交易內完成。
- **Rationale**: 重新啟動後狀態不遺失（FR-021）；同步 API 加上 Node 單執行緒，指令自然依序處理，不需要額外的鎖，這也是之後搶答順位不重複的基礎（003）。內建模組不需編譯原生套件，Mac 與 Windows 的組員都能直接安裝。
- **Alternatives considered**: better-sqlite3：成熟，但需要原生編譯或預編譯檔，新版 Node 上常有安裝問題。JSON 檔：簡單，但部分寫入與並行較難保證。
- **風險**: 若執行環境的 Node 版本沒有穩定的 `node:sqlite`，改用 better-sqlite3；資料存取都在 `server/src/infra/db/` 內，替換不影響其他層。

## R7 時間與倒數

- **Decision**: 伺服器保存倒數結束的絕對時間 `countdownEndsAt`。快照同時帶 `serverNow`。前端以收到快照時的時間差校正後顯示剩餘時間。時間到由伺服器的計時器觸發結束；伺服器啟動時若發現 `countdownEndsAt` 已過且階段仍是搶答中，立即結束。
- **Rationale**: 所有人依同一個結束時間計算，不受各裝置時鐘影響（FR-024）；重啟後仍正確（FR-021）；手動結束與時間到都走同一個 `close`，該操作對已結束的活動不做任何事，所以同時發生也只結束一次（FR-026）。
- **Alternatives considered**: 伺服器每秒廣播剩餘秒數：簡單但浪費，且斷線時畫面會停住。

## R8 測試

- **Decision**: vitest 做單元測試（domain、snapshot 過濾）與整合測試（啟動真實伺服器、用 socket.io-client 連線）；Playwright 做 E2E，以多個 browser context 扮演老師與多組學生。測試用記憶體中的 SQLite（`:memory:`）或暫存檔。
- **Rationale**: 領域規則是純函式，單元測試快且完整；同步與可見範圍必須用真實連線驗證；E2E 直接對應 demo 流程與驗收情境。
- **Alternatives considered**: 只做 E2E：慢，且邊界情況難以涵蓋。

## R9 樣式與設計規範

- **Decision**: CSS Modules 加上 `web/src/styles/tokens.css` 的 CSS 變數；不使用現成元件庫的預設外觀。元件只能引用 token，不寫死色碼、字體與間距。`design/DESIGN.md` 定案前，`tokens.css` 放中性的暫定值，並在檔案開頭註明「暫定」。
- **Rationale**: 原則 IX 要求介面依設計規範實作。把所有視覺決定集中在一個 token 檔，設計定案後只需替換該檔與少量版面，不必重寫元件。不用元件庫可避免帶入常見的預設樣式。
- **Alternatives considered**: Tailwind：開發快，但預設色票與間距容易讓畫面看起來像範本；若之後要用，需先把 theme 完全換成 design tokens。

## R10 專案結構與指令

- **Decision**: npm workspaces（`shared`、`server`、`web`）。`npm run dev` 同時啟動伺服器與前端開發伺服器；`npm run build` 後由伺服器直接提供前端檔案，`npm start` 單一指令啟動。`npm test`、`npm run test:e2e`、`npm run check`（型別檢查、lint、`scripts/check-diagrams.sh`）。
- **Rationale**: 助教與組員只需要 `npm install`、設定 `.env`、`npm start` 三步就能執行。
- **Alternatives considered**: 前後端分開兩個 repo 或兩個啟動指令：對本機 demo 沒有好處。

## R11 輸入驗證

- **Decision**: 所有指令與 HTTP 請求以 `shared/src/schemas.ts` 的 zod schema 驗證；組名在伺服器端去除前後空白後檢查長度（以字元數計，中文一字算一）與重複。
- **Rationale**: 原則 III。schema 放在 `shared`，前端可用同一份做即時提示，但最終以伺服器為準。
