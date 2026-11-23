# Implementation Plan: 介面語言切換（i18n）

**Branch**: `feat/i18n-language-switch` | **Date**: 2026-11-20（實作）｜**補寫**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-i18n/spec.md`

> **本檔是 2026-11-24 回溯補寫的**（constitution 原則 I 要求系統行為 MUST 以 `spec.md`、
> `plan.md`、`tasks.md` 為準，但 007 實作當時只產出 spec 與 tasks）。
> 內容依 **2026-11-20 已合併的實際程式碼** 回溯，描述的是「實際做了什麼」，
> 不是「事前打算做什麼」；圖與程式的一致性核對見
> [`docs/verification/007-diagram-consistency.md`](../../docs/verification/007-diagram-consistency.md)。
> 過程中不需要改動程式。

## Summary

提供繁體中文／English 兩種介面語言，涵蓋學生端、老師端、投影看板與首頁。

技術做法：**語言只影響顯示，不改變任何行為契約**。訊息表以型別保證兩種語言的 key 集合相同
（漏翻譯＝編譯錯誤），由一個 React Context 提供 `t(key, params)` 給所有元件；
使用者選擇存進 `localStorage`（鍵名 `classroom.language`），並透過 `storage` 事件讓同一瀏覽器的
其他分頁跟著切換。**伺服器完全不改**（契約 D1～D25 都不涉及介面語言）——
伺服器錯誤訊息維持繁體中文，英文版在客戶端依錯誤代碼對照（`web/src/lib/i18n/errors.ts`）。

預設語言依瀏覽器語言清單判定：`en*` → English、`zh*` → 繁體中文、其他 → 繁體中文（本系統繁中優先）。

## Technical Context

**Language/Version**: TypeScript 5.x；React 19

**Primary Dependencies**: React Context（不新增任何相依）

**Storage**: `localStorage`（鍵 `classroom.language`）

**Testing**: vitest（`web/tests/i18n.test.ts`）、Playwright（`e2e/tests/007-i18n.spec.ts`）

**Target Platform**: 本機執行，以瀏覽器操作；學生端常在手機上使用

**Project Type**: web application（npm workspaces：`web`）

**Performance Goals**: 切換語言後立即重繪（不重新載入頁面）；`<html lang>` 在瀏覽器繪製前更新，不會有一瞬間用錯語言

**Constraints**: 原則 V（依結構定位）不適用（本子功能不讀寫外部文件）；
原則 IV（機敏資料零落地）不適用；**原則 VI（伺服器是唯一裁判）不受影響** ——
語言切換不得改變作答流程、順位判定、寫回邏輯或快照格式（FR-005）

**Scale/Scope**: 4 個畫面（學生端、老師端、投影看板、首頁）、1 個訊息表、2 種語言、10 條 FR

## Constitution Check

| 原則                    | 檢查                                                                                                | 結果   |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| I 規格是唯一真相來源    | 實作只做 spec.md 的 FR-001～FR-010；**未新增任何行為**，也未改共用契約                              | 通過   |
| II 測試先行             | T009 先列測試（語言判定、插值、key 一致、錯誤對照）再列實作；T010 補 e2e 語系固定                   | 通過   |
| III 輸入驗證與清楚錯誤  | 伺服器錯誤在客戶端依 `ErrorCode` 對照；沒有對應英文時維持伺服器原文（`errors.ts` 的 `?? message`）  | 通過   |
| IV 機敏資料零落地       | 不適用（本子功能不碰任何憑證）                                                                      | 不適用 |
| V 依結構定位            | 不適用（本子功能不讀寫外部文件）                                                                    | 不適用 |
| VI 伺服器是唯一裁判     | **語言切換完全在客戶端**；伺服器不判斷語言、不改契約、不改快照格式                                  | 通過   |
| VII 圖表生成            | 3 張圖已存在；模組對應見下方；一致性核對見 `docs/verification/007-diagram-consistency.md`           | 通過   |
| VIII 可追溯             | tasks 每項都標 FR 編號；AC-007-01～07 在 spec.md                                                    | 通過   |
| IX 設計規範先於介面實作 | 切換器樣式依 `design/DESIGN.md` §5（方角、墨色框、無陰影）；只用 `web/src/styles/tokens.css` 的變數 | 通過   |

## 圖表與模組對應（原則 VII）

specify 階段的圖是概念層；下表把每個概念元件對應到實際模組。
2026-11-24 的一致性核對發現 **class 圖有兩條關係與程式不符**（錯誤對照表原本被畫成由
語言提供者呼叫、且缺 `phase.ts`），已以程式為準修圖，詳見一致性核對文件。

| 圖中的元件（`diagrams/007-i18n-component.puml`） | 模組                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 瀏覽器語言清單（`navigator.languages`）          | `web/src/lib/i18n/language.ts` 的 `readBrowserLanguages()`                              |
| 語言提供者（LanguageProvider）                   | `web/src/lib/i18n/LanguageProvider.tsx`                                                 |
| 訊息表（zh-TW / en）                             | `web/src/lib/i18n/messages.ts`（`zhTW`／`en`／`MESSAGES`）                              |
| 語言切換器（右上角）                             | `web/src/features/shared/LanguageSwitch.tsx`（`LanguageSwitch.module.css`）             |
| API 錯誤處理                                     | `web/src/lib/api.ts`、`web/src/lib/socket.ts`                                           |
| 伺服器錯誤代碼對照表                             | `web/src/lib/i18n/errors.ts`                                                            |
| 學生端／老師端／投影看板畫面                     | `web/src/features/student/`、`web/src/features/teacher/`、`web/src/features/projector/` |

| 類別圖中的物件（`diagrams/007-i18n-class.puml`） | 程式中的型別                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 語言                                             | `Language`（`web/src/lib/i18n/language.ts`）                                                                                                                        |
| 訊息表                                           | `zhTW`／`MessageKey`／`Messages`／`en`（`web/src/lib/i18n/messages.ts`）                                                                                            |
| 語言模組                                         | `detectLanguage`／`readStoredLanguage`／`storeLanguage`／`formatMessage`／`translate`／`getCurrentLanguage`／`setCurrentLanguage`（`web/src/lib/i18n/language.ts`） |
| 語言提供者                                       | `LanguageProvider`、`I18nContextValue`（`web/src/lib/i18n/LanguageProvider.tsx`）                                                                                   |
| 語言切換器                                       | `LanguageSwitch`（`web/src/features/shared/LanguageSwitch.tsx`）                                                                                                    |
| 錯誤對照表                                       | `ERROR_MESSAGES_EN`、`localizeErrorMessage`（`web/src/lib/i18n/errors.ts`）                                                                                         |
| 階段名稱                                         | `phaseLabel`（`web/src/lib/i18n/phase.ts`）                                                                                                                         |

## Project Structure

### Documentation (this feature)

```
specs/007-i18n/spec.md                                  ← 功能需求與驗收條件
specs/007-i18n/plan.md                                  ← 本檔
specs/007-i18n/tasks.md                                 ← 實作清單（T001～T013）
docs/verification/007-automated.md                      ← 測試與檢查的指令和輸出
docs/verification/007-diagram-consistency.md            ← 圖與程式的核對結果
docs/verification/007-manual.md                         ← 人工驗證（由組員填）
docs/verification/007-screenshots/                      ← 繁中與英文版畫面
diagrams/007-i18n-component.puml / .png                 ← 組件圖
diagrams/007-i18n-class.puml / .png                     ← 類別圖
diagrams/007-i18n-seq.puml / .png                       ← 時序圖
```

### Source Code (repository root)

```
web/src/lib/i18n/messages.ts        ← 訊息表（zhTW 定義 key，en 必須同 key）
web/src/lib/i18n/language.ts        ← 語言判定、儲存、插值
web/src/lib/i18n/LanguageProvider.tsx ← React Context 與跨分頁同步
web/src/lib/i18n/errors.ts          ← 伺服器錯誤代碼 → 英文
web/src/lib/i18n/phase.ts           ← 階段名稱（共用，不直接寫死語言）
web/src/features/shared/LanguageSwitch.tsx / .module.css  ← 切換器
web/src/lib/api.ts                  ← HTTP 錯誤翻譯
web/src/lib/socket.ts               ← Socket.IO 錯誤翻譯
web/src/app/routes.tsx              ← 首頁掛切換器
web/src/features/{student,teacher,projector}/*.tsx       ← 三個畫面掛切換器
```

沒有新增任何相依、沒有動 `server/`、沒有動 `shared/`。

## Complexity Tracking

沒有違反 constitution 的項目，不需填寫。

值得記錄的一個設計決定：**伺服器維持回繁體中文**（不做伺服器端多語言回應）。
理由是錯誤訊息在客戶端翻譯就能達成 FR-007，而伺服器端多語言會動到共用契約（D1～D25 都不涉及
介面語言，動契約就變成跨組議題）。代價是：若某個錯誤碼忘了加英文對照，英文版會顯示中文原文 ——
這是刻意選擇的「寧可顯示原文，也不要猜錯訊息」。
