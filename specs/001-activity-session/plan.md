# Implementation Plan: 活動與組別進場（activity-session）

**Branch**: `001-activity-session` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-activity-session/spec.md`

**Note**: 本計畫同時定義整個系統共用的技術架構（002–005 的 plan 沿用，不重新選型）。

## Summary

提供老師與學生兩種身分、組別管理、三階段的活動狀態機（準備中 → 搶答中 → 已結束）、選用的倒數計時，以及所有畫面的即時同步。

技術做法：單一 Node.js 伺服器是唯一的真相來源。所有改變狀態的操作都是「指令」，由伺服器驗證後寫入 SQLite，再向每個連線推送一份**依身分過濾的完整狀態快照**。前端只依快照畫畫面，不自行推導階段或時間。重新整理與斷線重連時重新取得快照即可回到正確狀態。

## Technical Context

**Language/Version**: TypeScript 5.x；Node.js 24 以上（使用內建 `node:sqlite`）

**Primary Dependencies**: 伺服器 Express 5、Socket.IO 4、zod；前端 React 19、Vite、socket.io-client、React Router

**Storage**: SQLite（單一檔案 `data/app.db`，透過 Node 內建 `node:sqlite`，不需編譯原生套件）

**Testing**: vitest（單元與整合）、Playwright（E2E，多個 browser context 模擬老師與多組學生）

**Target Platform**: 本機執行（macOS／Windows／Linux），以瀏覽器操作；不對外架設

**Project Type**: web application（npm workspaces：`shared`、`server`、`web`）

**Performance Goals**: 階段改變後 2 秒內所有連線更新（SC-001）；倒數顯示誤差 ≤ 1 秒（SC-004）

**Constraints**: 伺服器判定階段、時間與可見範圍（原則 VI）；機敏資料只在環境變數（原則 IV）；同一台電腦的多個瀏覽器分頁必須能分別扮演老師與不同組別（demo 需求）

**Scale/Scope**: 一個活動、最多 50 組、同時連線約 100 個；本子功能 6 個 user story、28 條 FR

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
|---|---|---|
| I 規格是唯一真相來源 | 計畫只實作 spec.md 與 Feature Contract v0.2 的行為；沒有新增行為 | 通過 |
| II 測試先行 | tasks 中每個 user story 先列測試 task，再列實作 task；領域邏輯為純函式，可單元測試 | 通過 |
| III 輸入驗證與清楚錯誤 | 所有指令以 zod schema 驗證；失敗回傳錯誤代碼與中文訊息，且不寫入資料（見 contracts） | 通過 |
| IV 機敏資料零落地 | 老師密碼只讀 `TEACHER_PASSWORD` 環境變數；`.env` 已 gitignore；log 不記錄密碼與 token | 通過 |
| V 依結構定位 | 本子功能不讀寫外部文件 | 不適用 |
| VI 伺服器是唯一裁判 | 階段、組別、倒數結束時間都在伺服器判定；快照依身分過濾後才送出；學生指令在伺服器檢查身分 | 通過 |
| VII 圖表生成 | specify 階段的 4 張圖已存在；本計畫的模組對應見下方「圖表與模組對應」；tasks 最後一個 Phase 含圖與程式一致性檢查 | 通過 |
| VIII 可追溯 | contracts 與 tasks 都標註 FR 與 AC 編號 | 通過 |
| IX 設計規範先於介面實作 | 畫面只用 `web/src/styles/tokens.css` 的變數；`design/DESIGN.md` 定案前使用中性的暫定 token，定案後只需替換 token 檔 | 通過（有條件，見 research R9） |

Phase 1 設計完成後重新檢查：結果相同，沒有違反項目。

## 圖表與模組對應（原則 VII）

specify 階段的圖是概念層；本計畫把每個概念元件對應到實際模組。實作後的一致性檢查以此表為準。

| 圖中的元件（`diagrams/001-*-component.puml`） | 模組 |
|---|---|
| 身分驗證 (Access Control) | `server/src/app/access.ts`、`server/src/infra/http/authRoutes.ts` |
| 組別管理 (Group Registry) | `server/src/domain/groupRegistry.ts`、`server/src/app/groupCommands.ts` |
| 活動階段管理 (Activity Phase Manager) | `server/src/domain/activity.ts`、`server/src/app/activityCommands.ts` |
| 倒數計時 (Countdown) | `server/src/app/countdown.ts` |
| 狀態同步 (State Broadcaster) | `server/src/app/snapshot.ts`、`server/src/infra/socket/broadcaster.ts` |
| 活動資料儲存 (Activity Store) | `server/src/infra/db/*.ts` |
| 老師端畫面 | `web/src/features/teacher/` |
| 學生端畫面 | `web/src/features/student/` |

| 類別圖中的物件（`diagrams/001-*-class.puml`） | 程式中的型別 |
|---|---|
| 活動、階段 | `Activity`、`Phase`（`server/src/domain/activity.ts`、`shared/src/protocol.ts`） |
| 組別、組別名冊 | `Group`、`GroupRegistry`（`server/src/domain/groupRegistry.ts`） |
| 參與者、身分種類 | `Session`、`Role`（`server/src/app/access.ts`） |
| 活動狀態快照 | `Snapshot`（`shared/src/protocol.ts`） |

## Project Structure

### Documentation (this feature)

```text
specs/001-activity-session/
├── plan.md              # 本檔
├── research.md          # 技術決策（整個系統共用）
├── data-model.md        # 資料模型與狀態轉換
├── quickstart.md        # 啟動與驗證步驟
├── contracts/
│   ├── http-api.md      # HTTP 介面
│   └── socket-events.md # 即時事件與指令、錯誤代碼、快照格式
└── tasks.md             # /speckit-tasks 產生
```

### Source Code (repository root)

```text
package.json                 # npm workspaces：shared、server、web；共用指令
tsconfig.base.json
.env.example                 # TEACHER_PASSWORD、PORT、DATA_DIR

shared/
└── src/
    ├── protocol.ts          # 階段、身分、快照、指令與錯誤代碼的型別
    └── schemas.ts           # zod schema（伺服器驗證、前端共用型別）

server/
├── src/
│   ├── domain/              # 純邏輯，不做 I/O
│   │   ├── activity.ts      # 狀態機：open / close / reset
│   │   └── groupRegistry.ts # 組別規則：新增 / 改名 / 刪除
│   ├── app/                 # 用例：驗證身分 → 呼叫 domain → 保存 → 廣播
│   │   ├── access.ts
│   │   ├── activityCommands.ts
│   │   ├── groupCommands.ts
│   │   ├── countdown.ts
│   │   └── snapshot.ts      # 依身分產生快照
│   ├── infra/
│   │   ├── db/              # node:sqlite：schema、repositories
│   │   ├── http/            # Express：登入、進場、健康檢查、靜態檔
│   │   └── socket/          # Socket.IO：連線驗證、指令路由、廣播
│   ├── config.ts            # 讀取環境變數
│   └── index.ts
└── tests/
    ├── unit/                # domain、snapshot
    └── integration/         # 啟動伺服器，以 socket.io-client 測指令與廣播

web/
├── src/
│   ├── app/                 # 路由：/（選擇身分）、/teacher、/student
│   ├── features/
│   │   ├── teacher/         # 登入、組別管理、階段控制
│   │   └── student/         # 選組、等待、作答區入口、結果區入口
│   ├── lib/
│   │   ├── session.ts       # 每個分頁各自的身分憑據（sessionStorage）
│   │   ├── socket.ts        # 連線、重連、指令
│   │   └── useSnapshot.ts   # 訂閱快照
│   └── styles/
│       └── tokens.css       # design tokens（來源：design/DESIGN.md）
└── tests/                   # 元件測試（vitest + Testing Library）

e2e/
├── playwright.config.ts
└── tests/001-activity-session.spec.ts

data/                        # SQLite 檔（gitignore）
```

**Structure Decision**: 採 web application 結構，以 npm workspaces 分成 `shared`、`server`、`web`。`shared` 放協定型別，讓前後端對快照與指令的理解一致。`server` 內部分三層：`domain`（純邏輯，最容易測試，也是類別圖的對應處）、`app`（用例）、`infra`（資料庫、HTTP、Socket）。後續子功能在同一結構下各加自己的 domain、app、features 檔案。

## Complexity Tracking

沒有違反 constitution 的項目，不需填寫。
