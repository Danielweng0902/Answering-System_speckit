# 007 介面語言切換 — 自動驗證

- 日期：2026-11-24
- 分支／版本：`main`（`2645f4a`）
- 範圍：`web/tests/i18n.test.ts`、`e2e/tests/007-i18n.spec.ts`，以及整個專案的回歸測試

## 指令與輸出

### 007 專屬單元測試

```bash
npm test --workspace @classroom/web -- --run tests/i18n.test.ts
```

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  575ms
```

涵蓋的 7 項（對應 spec.md 的 FR-002／FR-003／FR-007／FR-008）：

| 測項                                                 | 對應   |
| ---------------------------------------------------- | ------ |
| 沒選過語言時依瀏覽器語言判定：英文優先、繁中其次     | FR-002 |
| 使用者自己選過就用他選的（不受瀏覽器語言影響）       | FR-003 |
| 訊息表的兩種語言 key 完全相同                        | FR-008 |
| 每一則訊息在兩種語言都不是空的                       | FR-008 |
| 插值會取代 `{name}`，沒有參數就留空                  | FR-001 |
| `translate` 依語言取訊息並代入參數                   | FR-001 |
| 伺服器錯誤訊息有英文對應（共用契約不動，客戶端翻譯） | FR-007 |

### 007 專屬 e2e

```bash
npm run build && npm --prefix e2e test -- 007-i18n
```

```
Running 4 tests using 1 worker

  ✓  1 [chromium] › tests/007-i18n.spec.ts:70:1 › 系統語言是英文時，介面預設顯示英文；切換成中文後重新整理仍保留 (657ms)
  ✓  2 [chromium] › tests/007-i18n.spec.ts:117:1 › 英文版的匯入警告有翻譯（Philip 回報：匯入 Google 試算表的警告沒翻譯） (398ms)
  ✓  3 [chromium] › tests/007-i18n.spec.ts:144:1 › 老師端也能切換英文（表格與按鈕的英文排版） (313ms)
  ✓  4 [chromium] › tests/007-i18n.spec.ts:164:1 › 系統語言是繁體中文時，介面預設顯示繁體中文 (133ms)

  4 passed (3.2s)
```

| e2e 測項                                                       | 對應 AC                         |
| -------------------------------------------------------------- | ------------------------------- |
| 系統語言是英文時，介面預設顯示英文；切換成中文後重新整理仍保留 | AC-007-01、AC-007-02、AC-007-06 |
| 英文版的匯入警告有翻譯                                         | AC-007-07                       |
| 老師端也能切換英文（表格與按鈕的英文排版）                     | AC-007-03、AC-007-04            |
| 系統語言是繁體中文時，介面預設顯示繁體中文                     | AC-007-02                       |

### 整個專案的回歸測試

```bash
npm test --workspace @classroom/web
# Test Files  24 passed (24)
#      Tests  127 passed (127)

npm test --workspace @classroom/server
# Test Files  56 passed (56)
#      Tests  466 passed (466)

npm --prefix e2e test
# 2 skipped
# 21 passed (36.6s)

npm run check     # typecheck + lint + 圖表檢查
# PASS 圖表檢查通過
```

> e2e 有 2 項 skipped：需要真實 Google 試算表憑證的項目（環境未設定服務帳號時會跳過，
> 不是失敗）。

## 型別保證（FR-008）

`web/src/lib/i18n/messages.ts` 的結構讓「漏翻譯」在**編譯期**就爆掉：

```ts
export const zhTW = {/* 所有 key 與繁中內容 */} as const;
export type MessageKey = keyof typeof zhTW;
export type Messages = Record<MessageKey, string>;
export const en: Messages = {/* 少一個 key 或多一個 key 都會編譯錯誤 */};
```

單元測試再從另一個角度守一次（兩種語言的 key 集合完全相同、每一則訊息在兩種語言都非空）。

## `<html lang>` 與無障礙（FR-009／FR-006）

`LanguageProvider` 用 `useLayoutEffect` 更新 `document.documentElement.lang`
（在瀏覽器繪製前完成，不會有一瞬間用錯語言），e2e 會驗證切換後與重新載入後的 `<html lang>`。

## 圖表

`scripts/check-diagrams.sh` 通過（007 的三張圖齊全且 PNG 不過期）。
圖與程式的一致性核對見 [`007-diagram-consistency.md`](./007-diagram-consistency.md) ——
該次核對發現 class 圖有兩條關係與程式不符（錯誤對照表被畫成由語言提供者呼叫）且漏了 `phase.ts`，
已以程式為準修圖並重新產生 PNG。
