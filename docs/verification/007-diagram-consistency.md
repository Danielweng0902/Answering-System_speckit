# 007 圖表與程式一致性核對

核對範圍：007 的三張 PlantUML 圖（`diagrams/007-i18n-*.puml`）與目前 `web/src` 的實際程式碼
（`web/src/lib/i18n/`、`web/src/features/shared/LanguageSwitch.tsx`、三個畫面與 `web/src/app/routes.tsx`）。
核對只描述圖與程式；發現不符處**以程式為準修圖**，程式未改動。

## 逐項核對

| 圖中項目                                      | 程式位置                                                                                                                                                          | 結果     | 差異說明                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 元件：瀏覽器語言清單（`navigator.languages`） | `web/src/lib/i18n/language.ts` 的 `readBrowserLanguages()`                                                                                                        | 已修正圖 | 圖上只寫 `navigator.languages`；實際上判定前會先讀 `localStorage`（使用者選過就用選的），順序在時序圖有畫                                                                                     |
| 元件：語言提供者（LanguageProvider）          | `web/src/lib/i18n/LanguageProvider.tsx`                                                                                                                           | 一致     | `language` state、`setLanguage` callback、`t(key, params)`（由 `useMemo` 產生）                                                                                                               |
| 元件：訊息表（zh-TW / en）                    | `web/src/lib/i18n/messages.ts`                                                                                                                                    | 一致     | `zhTW`（`as const`）→ `MessageKey` → `Messages = Record<MessageKey, string>` → `en: Messages`；型別保證機制與圖上的註解相符                                                                   |
| 元件：語言切換器（右上角）                    | `web/src/features/shared/LanguageSwitch.tsx`                                                                                                                      | 一致     | 四個位置：首頁 `app/routes.tsx:22`、學生端 `StudentPage.tsx:60,79`、老師端 `TeacherPage.tsx:128`（登入頁）與 `:202`（登入後 header）、投影 `ProjectorPage.tsx:71`。圖上寫「右上角」與實際一致 |
| 元件：API 錯誤處理                            | `web/src/lib/api.ts:84`、`web/src/lib/socket.ts:132`                                                                                                              | 一致     | 兩處都在顯示錯誤前呼叫 `localizeErrorMessage(ack.error.code, ack.error.message)`                                                                                                              |
| 元件：伺服器錯誤代碼對照表                    | `web/src/lib/i18n/errors.ts`                                                                                                                                      | 一致     | `ERROR_MESSAGES_EN: Partial<Record<ErrorCode, string>>` ＋ `localizeErrorMessage(code, message)`                                                                                              |
| 元件：伺服器維持回繁體中文                    | 契約 D1～D25 不涉及介面語言                                                                                                                                       | 一致     | 伺服器未做任何語言判斷；錯誤訊息由客戶端翻譯                                                                                                                                                  |
| 類別：語言                                    | `web/src/lib/i18n/language.ts` 的 `export type Language = 'zh-TW' \| 'en'`                                                                                        | 一致     | 圖上是 enum，實際是字串聯集型別（同樣只有兩個值）                                                                                                                                             |
| 類別：訊息表                                  | `web/src/lib/i18n/messages.ts`                                                                                                                                    | 一致     | 見上                                                                                                                                                                                          |
| 類別：語言模組                                | `web/src/lib/i18n/language.ts`：`detectLanguage`／`readStoredLanguage`／`storeLanguage`／`formatMessage`／`translate`／`getCurrentLanguage`／`setCurrentLanguage` | 已修正圖 | 圖上原本漏了 `translate()`（插值與查表的主要對外函式）與 `LANGUAGE_STORAGE_KEY = 'classroom.language'`（實際的儲存鍵名）                                                                      |
| 類別：語言提供者                              | `web/src/lib/i18n/LanguageProvider.tsx`                                                                                                                           | 一致     | —                                                                                                                                                                                             |
| 類別：語言切換器                              | `web/src/features/shared/LanguageSwitch.tsx`                                                                                                                      | 一致     | —                                                                                                                                                                                             |
| 類別：錯誤對照表                              | `web/src/lib/i18n/errors.ts`                                                                                                                                      | 已修正圖 | 圖上原本畫成「語言提供者 ..> 錯誤對照表」與「錯誤對照表 --> 語言：目前語言」，**兩條關係都不符合實際**（見下節）                                                                              |
| 類別：階段名稱                                | `web/src/lib/i18n/phase.ts` 的 `phaseLabel(phase, t)`                                                                                                             | 已修正圖 | **圖上原本完全沒有這個模組**（tasks T008「階段名稱共用」），它是 007 的一部分                                                                                                                 |

## 修改了哪些圖、為什麼

- **class**：
  1. 移除「語言提供者 ..> 錯誤對照表」。實際上 `LanguageProvider` **完全不碰** `errors.ts` ——
     伺服器錯誤不經過元件樹，`errors.ts` 是由 `api.ts`／`socket.ts` 直接呼叫的。
  2. 把「錯誤對照表 --> 語言：目前語言」改為「錯誤對照表 --> 語言模組」。
     `errors.ts` 自己做的是 `getCurrentLanguage()`（讀 `language.ts` 的模組層狀態），不是從 Provider 拿。
     圖上補了 note 說明這條路徑為什麼繞開 Provider。
  3. 補上「階段名稱」類別（`phase.ts`），它與 Provider 同樣依賴語言模組。
- **component／seq**：與程式一致，未修改。`component` 圖的「Api --> Errors : 英文版依錯誤代碼對應」
  正好畫出正確的路徑（API 層呼叫錯誤對照表），與 class 圖原本的畫法互相矛盾 —— 這次是把 class 圖修正到
  與 component 圖一致。

## 未解決的差異

無。三張圖目前都與程式一致，且本次核對未發現需要更動程式行為的差異。

---

PNG 已由 `scripts/render-diagrams.sh` 產生（PlantUML v1.2026.9），`scripts/check-diagrams.sh` 通過。
