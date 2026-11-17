# Web 端審查：Modern Web Guidance（GoogleChrome）

日期：2026-11-17｜分支：`chore/web-guidance-audit`（疊在 `005-fairness-and-extras` 之上）

## 審查方法

基準文件：[GoogleChrome/modern-web-guidance-src](https://github.com/GoogleChrome/modern-web-guidance-src)（Chrome／Edge／Firefox／MDN 共同維護的現代 Web 指引原始碼）。用該 repo 提供的 CLI 取得指引並掃描本專案：

```bash
npx modern-web-guidance@latest legacy-scan web/src
# → 0 findings from 38 qualified guides（legacy 模式指引涵蓋約 20% 指引）

npx modern-web-guidance@latest retrieve ime-safe-enter-submit,autofill-sign-in-form,accessible-error-announcement,switch
```

`legacy-scan` 只涵蓋 38 個「舊寫法」模式，所以另外依本專案的技術棧（React SPA、Socket.IO、表單、投影頁）取用相關指引逐項比對。**這份指引是 web platform 現代化與可用性基準，不是資安掃描**；資安仍以專案憲法與 GLM 覆核為準。

## 已經符合的部分（不需修改）

| 檢查項目 | 指引 | 現況 |
|---|---|---|
| 中文輸入法按 Enter 不會誤送出 | `ime-safe-enter-submit` | 全專案**沒有任何自訂 Enter／keydown 送出**（`rg 'onKeyDown|isComposing|requestSubmit' web/src` 無結果）；原生表單隱含送出會被 IME 攔下，中文輸入安全 |
| 登入表單結構 | `autofill-sign-in-form` | 已是 `<form>` ＋ `<label for>` ＋ `type="password"` ＋ `name="password"` ＋ `autoComplete="current-password"` |
| 錯誤訊息與欄位的關聯 | `accessible-error-announcement` | `aria-describedby` **只在錯誤出現時**才指向錯誤元素（隱藏時不引用，與指引一致）；`aria-invalid` 同步 |
| 語言與行動裝置 | `html` | `<html lang="zh-Hant">`、viewport meta 齊全 |
| 尊重 OS 文字縮放 | `respect-os-text-scale` | 字級與間距全部用 rem token，未寫死 px 字級 |
| 欄位標籤 | `accessibility` | 所有 `<input>` 都有 `<label htmlFor>` ＋ 對應 `id`；連結欄位用 `type="url"` |
| 舊式寫法 | `legacy-scan` | 0 findings |

## 本次修正

| # | 問題 | 指引 | 修正 | 影響 |
|---|---|---|---|---|
| A1 | 答案欄位沒設字數上限，老師要靠伺服器回錯才知道超過 200 字 | `forms`（用原生屬性做驗證） | 答案 `<input>` 加 `maxLength={200}`（與 003 FR-023 一致）與 `spellCheck={false}` | 輸入端先擋；伺服器仍照原樣驗第二次 |
| A2 | 送出失敗後焦點留在按鈕，鍵盤／螢幕閱讀器使用者要自己找哪一格沒填 | `accessible-error-announcement`（送出失敗後聚焦第一個無效欄位） | 驗證失敗時把焦點移到第一個沒填的欄位 | 只影響鍵盤操作順序，不改文案 |
| A3 | 開／關設定用 checkbox，螢幕閱讀器讀成「已勾選／未勾選」 | `switch` | 倒數與公平順位開關改用 `role="switch"` | 原生 `switch` 屬性目前只有 Safari 支援，所以用 `role="switch"` 得到同樣語意，**不引入 polyfill**；可存取角色變了，測試與 e2e 的 role 查詢已同步更新 |
| A4 | 密碼欄位可空白送出，行動鍵盤的送出鍵也沒有語意 | `autofill-sign-in-form` | 加 `required` 與 `enterKeyHint="done"` | 空白送出改由瀏覽器擋下（原本是伺服器回「密碼錯誤」） |
| A5 | 原生核取方塊用瀏覽器預設色，與設計 token 不一致 | `brand-consistent-forms`（`accent-color`） | `base.css` 用既有 token `var(--color-focus)` 設定 `accent-color` | 只改原色，不新增顏色變數（不違背「介面只用 design tokens」） |

## 刻意不採納（附理由）

| # | 建議 | 不採納的理由 |
|---|---|---|
| B1 | 答案欄位加 `required` | 原生驗證會取代我們較詳細的訊息（「尚未填寫的空格：第 1 格（答案）」），對題組反而更難懂（003 FR-008 的錯誤訊息屬規格行為） |
| B2 | 改用單一 polite live region ＋ `:user-invalid` 同步 | 我們的錯誤只在「送出」後出現，不會在輸入途中跳出，屬於指引建議的另一種情境；套用反而會增加複雜度 |
| B3 | 密碼欄加「顯示密碼」切換 | 純 UI 新增，牽涉設計；建議交設計負責人決定，本次不做 |
| B4 | 引入 `input-switch-polyfill` | Chrome／Edge／Firefox 尚未支援原生 `switch` 屬性，為一個語意新增相依不划算；`role="switch"` 已達到相同效果 |

## 待組員決定（使用者可見行為，不自行修改）

1. **003 人工驗證的建議 1**：作答錯誤訊息「每個空格都要填寫答案；尚未填寫的空格：第 1 格（答案）」是否改成「答案不可為空白」。這是使用者可見文案，需兩組同意（`docs/verification/003-manual.md`）。
2. **學生作答是否支援 Enter 送出**：目前只能用按鈕。若要加，必須同時照 `ime-safe-enter-submit` 處理（`isComposing` ＋ `keyCode === 229`），否則中文輸入法按 Enter 會誤送出。

## 風險與限制

- `role="switch"` 會改變**可存取角色**：螢幕閱讀器改讀「開／關」。這是刻意的語意改善，但屬可見於輔助科技的變化，已在 PR 說明中標出。
- `maxLength` 只擋「超過 200 字」，空白仍由我們自己的驗證處理（見 B1）。
- 本指引不含後端安全、權限或資料保護的檢查；那些由 001–006 各自的憲法檢查、GLM 安全覆核與人工審查負責。

## 驗證

- `npm test`：server 48 files／367 tests、web **18 files／93 tests** 全過（新增 3 個案例：答案上限與拼字檢查、焦點移位、密碼欄位原生屬性）。
- `npm run test:e2e`：15 passed、2 skipped（005 e2e 的開關查詢已改為 `role="switch"`）。
- `npm run check`：typecheck、ESLint、圖檔檢查全過。
