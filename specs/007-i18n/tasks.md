# 007 介面語言切換 — Tasks

- [x] T001 **訊息表**：`web/src/lib/i18n/messages.ts`，`zhTW` 定義 key、`en` 型別上必須同 key（FR-008）
- [x] T002 **語言判定與儲存**：`web/src/lib/i18n/language.ts`（localStorage → `navigator.languages` → 繁中）（FR-002、FR-003）
- [x] T003 **Provider 與 `useI18n`**：`web/src/lib/i18n/LanguageProvider.tsx`（含跨分頁同步）（FR-003）
- [x] T004 **伺服器錯誤訊息英文對照**：`web/src/lib/i18n/errors.ts`（客戶端翻譯，契約不動）（FR-007）
- [x] T005 **切換器元件**：`web/src/features/shared/LanguageSwitch.tsx` ＋ CSS（FR-001、FR-004）
- [x] T006 **接到 App**：`app/App.tsx` 掛 `LanguageProvider`
- [x] T007 **轉換三個畫面與首頁**：學生端、老師端、投影看板、首頁（FR-001）
- [x] T008 **階段名稱共用**：`web/src/lib/i18n/phase.ts`
- [x] T009 **測試**：web 單元測試（判定／插值／key 一致／錯誤對照）＋ e2e（英文預設、切換、重新整理保留）
- [x] T010 **e2e 語系固定**：`e2e/playwright.config.ts` 的 `locale: 'zh-TW'`（介面預設依系統語言，否則中文斷言失效）
- [x] T011 **文件**：本 spec、`design/DESIGN.md`（切換器樣式）、`README.md`（進度）
- [x] T012 **`<html lang>` 跟著語言改**（WCAG 3.1.1，2026-11-19 review）：`LanguageProvider` 用
  `useLayoutEffect` 更新 `document.documentElement.lang`；e2e 驗證切換後與重新載入後的 `<html lang>`
- [x] T013 **匯入警告的英文版**（2026-11-19 Philip 回報：匯入 Google 試算表的警告沒翻譯）：
  伺服器的警告本來就是結構化的（`code` ＋ 題號／儲存格／工作表名），客戶端據此翻譯，
  中文版維持用伺服器原文；**API 契約不動**
