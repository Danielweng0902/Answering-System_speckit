# Implementation Plan: 公平順位與投影看板（fairness-and-extras）

**Branch**: `005-fairness-and-extras` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-fairness-and-extras/spec.md`

**Note**: 技術架構沿用 [001 research](../001-activity-session/research.md)、[002 plan](../002-guided-notes-import/plan.md)、[003 plan](../003-buzz-in/plan.md) 與 [004 plan](../004-export/plan.md)。本計畫只描述 005 新增的公平順位與投影看板。

## Summary

老師在「準備中」可以勾選「公平順位」。啟用後，同一題在第一個答案送達後 3 秒內送達的組別視為同一批，批內依「已判定題目的搶答成功題數」由少到多排序取第 1 順位；老師作廢某題的成功組時，該題與後面已判定的題目會依新的成功題數一起重算（D25）。另外老師可以開啟一個投影看板：搶答中只顯示階段、倒數與各組是否在線，結束後可依題號順序逐題揭曉結果。

技術做法有兩個關鍵決定（見 [research.md](./research.md)）：

1. **判定不保存，只衍生計算**（R1）。判定結果由已保存的送達時間與序號即時推導，純函式、重啟一致、作廢連鎖重算自然成立。實測 50 組 × 30 題的完整判定只要 2.4 ms。
2. **投影看板拿獨立快照**（R6）。Socket.IO 握手帶 `view: 'projector'`，伺服器據此送出的內容完全不含作答資訊；不是「前端拿到再隱藏」。

## Technical Context

**Language/Version**: 沿用 001（TypeScript 5.x、Node.js 24 以上）

**Primary Dependencies**: 沿用 001（Socket.IO、React/Vite、zod）、003（`node:sqlite`）；**不新增依賴**

**Storage**: 沿用 001 的 SQLite（`node:sqlite`）；沿用 003 的 `submissions`／`submission_answers`；`activity` 表**新增兩個欄位**：`fair_ranking_enabled`、`revealed_question_count`（idempotent migration，R5）

**Testing**: 沿用 001（vitest 單元／整合測試、Playwright E2E）；公平順位以純函式單元測試（決定性、SC-001 分布、邊界）＋ 整合測試（作廢連鎖重算、旗標指令、揭曉指令、CSV 第 8 欄、投影快照無作答資訊）

**Target Platform**: 沿用 001（本機伺服器與瀏覽器）

**Project Type**: 沿用 001（npm workspaces：`shared`、`server`、`web`）

**Performance Goals**: 每次看板／結果／匯出的完整判定在 50 組 × 30 題規模下低於 10 ms（實測 2.38 ms，R1 實驗 5）；判定完成的翻轉在第一個答案送達後 3 秒 ± 0.5 秒內反映到看板

**Constraints**：
- 公平順位 MUST NOT 改變未啟用時的行為（FR-002、SC-002）；啟用與否由老師在「準備中」決定，之後不可改（FR-001、FR-010）
- 判定 MUST 只依據已保存的送達資料（FR-009、SC-003）
- 投影看板 MUST NOT 包含任何作答資訊，且 MUST 由伺服器過濾（FR-015、FR-022、原則 VI）
- 學生端在「搶答中」MUST NOT 看到其他組別的狀況或自己的順位（FR-012、C9、原則 VI）
- CSV 第 8 欄與 D13 v0.5 一致（FR-011）
- 介面只用 design tokens（原則 IX）

**Scale/Scope**: 最多 100 組；每份學習單 5–30 題；本子功能 3 個 user story、23 條 FR、20 個驗收情境

## Constitution Check

| 原則 | 適用 | 落實方式 |
|---|---|---|
| I. 規格是唯一真相來源 | ✓ | 行為只以 `specs/005-fairness-and-extras/spec.md` + `docs/shared/FEATURE-CONTRACT.md` v0.5 為準；D14／D16／D25／D13 已兩組同意 |
| II. 測試先行 | ✓ | 每個 user story 先寫失敗測試（純函式 → 指令 → 端點 → 前端 → e2e），再實作 |
| III. 輸入驗證與清楚錯誤 | ✓ | 新指令 `activity:fair-ranking`、`reveal:next`、`reveal:all` 在 server 端驗證身分與階段，失敗回既有錯誤代碼（`FORBIDDEN`／`INVALID_PHASE`／`TEACHER_AUTH_REQUIRED`），不新增模糊錯誤 |
| IV. 機敏資料零落地 | ✓ | 不新增日誌輸出；公平順位與揭曉進度不含答案內容；log 只記事件名稱 |
| V. 依結構定位，不寫死位置 | ✓ | 判定依 `submissions` 的送達資料與題目順序，不引用任何固定座標或固定題號 |
| VI. 伺服器是公平與可見性的唯一裁判 | ✓ | 判定、順位、投影快照、揭曉進度全部由伺服器決定並過濾；前端只呈現（R6 特別說明投影快照不是前端隱藏） |
| VII. 圖表生成 | ✓ | 4 張 005 圖（component／class／seq-fairness／seq-reveal）依實作更新並重新產生 PNG，跑 `scripts/check-diagrams.sh` |
| VIII. 可追溯 | ✓ | 每個 task 標註 FR／AC；驗證紀錄寫在 `docs/verification/005-*.md` |
| IX. 設計規範先於介面實作 | ✓ | 介面只引用 `tokens.css` 變數；投影看板用大字級距但不另訂視覺規範 |

**Complexity Tracking**：無需例外。若實作時發現「衍生計算」不足以滿足 FR-020（D25）或 FR-019（2 秒更新），停下回報並更新 research.md，不自行改成保存式判定。

## 圖表與模組對應（原則 VII）

| 圖中元件／類別 | 實際模組與型別 |
|---|---|
| 公平順位判定器（Fairness Settlement） | `server/src/domain/answerSettlement.ts` 的 `settleAll()`、`orderByFairness()`；`server/src/domain/answerRanks.ts` 的 `RankingRule`、`arrivalRule`、`fairnessRule` |
| 判定結果投影 | `server/src/app/answerSettlementService.ts` 的 `computeSettlement()`（讀 DB → 呼叫純函式 → 回傳每題 winner／順位／判定中／是否改判） |
| 活動設定（公平順位旗標） | `server/src/infra/db/activityRepo.ts` 的 `getActivity()`／`updateActivity()`、`server/src/app/activityCommands.ts` 的 `setFairRanking` |
| 揭曉控制 | `server/src/app/projectorCommands.ts` 的 `revealNext`／`revealAll`；`activity.revealed_question_count` |
| 投影看板 | `server/src/app/snapshot.ts` 的 `createProjectorSnapshot()`；`shared/src/protocol.ts` 的 `ProjectorSnapshot`；`web/src/features/projector/ProjectorPage.tsx` |
| CSV 產生器 | `server/src/app/csvBuilder.ts` 的 `buildCsv()`（第 8 欄）、`server/src/app/exportCommands.ts` |
| 老師看板 | `server/src/app/answerProjections.ts` 的 `buildBoard()`（加 `settling`／`fairnessApplied`）、`web/src/features/teacher/AnswerBoard.tsx` |
| 學生結果 | `server/src/app/answerProjections.ts` 的 `buildResults()`、`buildClosedMyAnswers()`；`web/src/features/student/StudentResults.tsx` |

## Project Structure

### Documentation (this feature)

```
specs/005-fairness-and-extras/
├── spec.md            # 已釐清：clarify session 2026-11-17、FR-020／021／022／023
├── plan.md            # 本文件
├── research.md        # R1～R7 技術決策與實驗證據
├── data-model.md      # 資料表新增欄位、判定結果、揭曉進度
├── contracts/
│   ├── socket-events.md   # 新指令與投影快照
│   └── http-api.md        # 投影頁的取得方式與權限
├── quickstart.md      # 人工驗證步驟
├── tasks.md           # 執行清單
└── checklists/
    └── requirements.md
```

### Source Code（新增與修改的檔案）

```
shared/src/
├── protocol.ts        # SnapshotBase.fairRankingEnabled、ProjectorSnapshot、AnswerBoardQuestion.settling、
│                      #   QuestionResult.fairnessApplied、新指令 payload
└── schemas.ts         # 新指令的輸入驗證

server/src/
├── domain/
│   ├── answerRanks.ts         # RankingRule 抽象、arrivalRule、fairnessRule
│   └── answerSettlement.ts    # 新增：settleAll() 純函式（跨題判定）
├── app/
│   ├── answerSettlementService.ts  # 新增：讀 DB → 判定 → 供投影層使用
│   ├── answerProjections.ts   # buildResults／buildBoard／buildClosedMyAnswers 改用判定結果
│   ├── activityCommands.ts    # setFairRanking（只有 preparing）
│   ├── projectorCommands.ts   # 新增：revealNext／revealAll（只有 closed）
│   ├── snapshot.ts            # 公平順位旗標、createProjectorSnapshot
│   ├── csvBuilder.ts          # 第 8 欄
│   └── exportCommands.ts      # 第 8 欄的值
├── infra/
│   ├── db/database.ts         # activity 新增兩欄 + migration
│   ├── db/activityRepo.ts     # 讀寫新欄位
│   ├── socket/broadcaster.ts  # 投影檢視模式、揭曉廣播
│   └── socket/commandRouter.ts# 新指令註冊
└── index.ts                   # 判定完成的排程提醒、廣播掛載點

web/src/
├── app/routes.tsx             # /projector 路由
├── features/projector/ProjectorPage.tsx（＋ .module.css）  # 新增
├── features/teacher/PhaseControl.tsx / TeacherPage.tsx    # 公平順位開關、揭曉按鈕、開啟投影看板
├── features/teacher/AnswerBoard.tsx                        # 判定中、改判標示
├── features/student/StudentResults.tsx                     # 公平順位標示
└── lib/socket.ts              # 投影頁以 view=projector 連線
```

## Complexity Tracking

| 項目 | 決策 | 理由 |
|---|---|---|
| 判定保存 vs 衍生計算 | 衍生計算 | R1：重啟一致、作廢連鎖重算自然成立、實測 2.38 ms |
| 投影快照 vs 前端隱藏 | 伺服器獨立快照 | R6／原則 VI |
| 順位顯示來源 | 判定結果提供 | R4：資料庫 `rank` 維持送達序號，避免改動 003 的查詢與索引 |
| 批次定義 | 相對第一個答案的 3000ms 單一批次 | R2：符合 FR-003／FR-005 原文，規則單純可測 |
