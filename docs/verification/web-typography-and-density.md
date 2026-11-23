# 字級與密度調整 — 人工與視覺驗證

- 日期：2026-11-23
- 分支：`feat/014-typography-and-density-tokens`（PR #29，base 已改為 `main`）
- 對應變更：`web/src/styles/tokens.css` 為主檔，加上 5 個引用點的 CSS

## 1. 三處調整與實測依據

### ① 投影看板：答案原本是全畫面最小的字（005 SC-005，後排約 8 公尺）

實測（computed style，1920×1080 投影）：

| 元素       |   調整前 | 調整後（實測） | 判讀                                         |
| ---------- | -------: | -------------: | -------------------------------------------- |
| Q 號       |     44px |       **44px** | 本來就夠大                                   |
| 贏家組別名 |     28px |       **32px** | 偏小 → 拉大                                  |
| **答案**   | **22px** |       **28px** | ❌ 全畫面最小、**卻是學生最需要讀的** → 拉大 |

**關鍵**：答案原本用 `--font-size-question`，而那個 token 同時是學生端的題目文字與輸入框。
因此新增兩個**投影專用** token（`--font-size-projector-answer: 1.75rem` / `--font-size-projector-winner: 2rem`），
不影響其他畫面。

### ② 學生端作答區：輸入框要獨佔一級

調整目標是「視線順序＝讀（題目）→ 寫（輸入框，焦點）」。

| 元素       | 調整前 |                   調整後（實測，390px） |
| ---------- | -----: | --------------------------------------: |
| 題目標題   |   28px |                                    28px |
| **輸入框** |   18px | **24px**（`--font-size-input: 1.5rem`） |
| 題目文字   |   18px |                                    18px |
| 字數計數   |   12px |                                    12px |

### ③ 老師端密度：區塊間距收緊

區塊之間的留白是大級距的主要來源，收緊一級：

| 項目           |                     調整前 |                    調整後（實測） |
| -------------- | -------------------------: | --------------------------------: |
| 區塊之間的間距 | 48px（`--space-10: 3rem`） | **32px**（`--space-block: 2rem`） |

## 2. ⚠️ 量測時發現並修掉的缺口：窄螢幕的 media query 蓋掉了輸入框字級

**這是本題最重要的發現**，而且在補截圖的過程中才浮現。

`web/src/features/student/AnswerArea.module.css` 有一個既有的窄螢幕 media query
（`@media (max-width: 30rem)`，學生端就是手機，**全部命中**），
裡面本來就有兩條規則：

```css
@media (max-width: 30rem) {
  .questionTitle {
    font-size: var(--font-size-headline);
  }
  .prompt {
    font-size: var(--font-size-large);
  } /* 18px */
  .input {
    font-size: var(--font-size-large);
  } /* 18px ← 問題在這裡 */
}
```

PR #29 把主規則的 `.input` 從 `--font-size-question` 改成 `--font-size-input`（1.5rem），
**但 media query 裡那條把輸入框壓回 `--font-size-large`（18px）的規則沒有一起改**。
結果：

| 視窗寬度                           | 題目文字 |   輸入框 | 層級是否正確                |
| ---------------------------------- | -------: | -------: | --------------------------- |
| ≥480px（桌面瀏覽器）               |     22px | **24px** | ✅ 輸入框較大               |
| **≤480px（學生端真正使用的情境）** |     18px | **18px** | ❌ **完全同級，問題沒解決** |

**也就是說這次調整的核心改善之一，在學生端的主要使用情境下完全沒有生效。**

修法：media query 裡的 `.input` 改成 `--font-size-input`。
窄螢幕只收窄「題目字級」（題目標題與題目文字），輸入框不收 ——
輸入框寬度是 `100%`，字級變大不會造成水平溢出（實測 390px 下 `scrollWidth` 仍等於 `390`）。

### 2.1 為什麼「只看截圖」會漏掉這個

主規則改了、media query 沒改 —— 兩處都對讀 CSS 的人很合理，
但只有實際渲染後量 computed style 才看得出來。這也是本題把
「程式化量測」加進 `scripts/token-shots.mjs` 的原因。

## 3. 自動化驗證

```bash
npm test --workspace @classroom/web
# Test Files  25 passed (25)
#      Tests  133 passed (133)

npm test --workspace @classroom/server
# Test Files  56 passed (56)
#      Tests  465 passed (465)

npm run check      # typecheck + lint + 圖表檢查 通過
```

新增 `web/tests/typographyTokens.test.ts`（6 項）—— 純樣式 invariant 讓 CI 不會紅，
所以沿用專案既有做法（`teacherSectionStyle.test.ts`、`phaseColor.test.ts`）讀 CSS 原始檔來守：

- 投影專用 token 存在，且數值正確（`--font-size-projector-answer: 1.75rem`、`--font-size-projector-winner: 2rem`）
- `--font-size-input: 1.5rem` 存在，且大於 `--font-size-question: 1.375rem`
- 投影頁的 `.revealAnswers` / `.revealWinner` 真的引用了投影專用 token
- 學生端 `.input` 用 `--font-size-input`、`.prompt` 用 `--font-size-question`
- **窄螢幕 media query 裡的 `.input` 維持 `--font-size-input`**（§2 的缺口）
- 窄螢幕仍會收窄題目字級（避免水平溢出）

**守衛的有效性已驗證**（不是寫出來不會失敗的假測試）：
把 media query 裡的 `.input` 改回 `--font-size-large` → `窄螢幕（手機）media query 裡，輸入框維持 --font-size-input` **失敗**
（`Tests 1 failed | 5 passed`），再還原。

## 4. 程式化量測（不靠目視）

工具：`scripts/token-shots.mjs`（PR #29 新增，這次加上量測）、`scripts/student-font-shots.mjs`、
`scripts/teacher-top-shot.mjs`（本次新增，皆為開發用，不影響產品程式）。

```bash
npm run build && TEACHER_PASSWORD=... npm start
SHOT_GROUPS=50 SHOT_PASSWORD=... node scripts/token-shots.mjs /tmp/shots
SHOT_PASSWORD=... node scripts/student-font-shots.mjs /tmp/font after
SHOT_PASSWORD=... node scripts/teacher-top-shot.mjs /tmp/teacher
```

輸出：

```
間距量測 [class*="_section_"]: [362,247,839]        ← 區塊頂端差（含區塊高度）
字級量測（投影看板）:
  Q 號: 44px / 48.4px / w400
  贏家組別: 32px / 48px / w600
  答案: 28px / 42px / w400
字級量測（學生端 390px）:
  題目: 18px / 27px / w400
  題目標題: 28px / 30.8px / w700
  輸入框: 24px / 36px / w400
  字數計數: 12px / 18px / w400
  docScrollWidth: 390, viewportWidth: 390            ← 沒有水平溢出
區塊位置與間距: { "gaps": [32, 32, 32], ... }        ← 區塊之間 32px
```

`scripts/teacher-top-shot.mjs` 量的是**區塊底端到下一個區塊頂端**的空白
（32px × 3 處），而不是頂端差 —— 頂端差會把區塊自己的高度算進來，看不出間距變化。

## 5. 截圖（Constitution 原則 IX／EXECUTION-PLAYBOOK §10）

存於 `docs/verification/web-typography-and-density-screenshots/`：

| 檔案                                    | 內容                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `01-teacher-prepared.png`               | 老師端上半段（1440px，含搶答控制／匯入／題目清單／組別管理；**看區塊之間的 32px 留白**） |
| `02-projector-reveal.png`               | 投影看板（1920×1080，全部揭曉；**8 公尺判讀用的答案與贏家組別**）                        |
| `03-student-results.png`                | 學生端結果（390px）                                                                      |
| `04-student-answer-area.png`            | 學生端作答區（390px，**修後**：輸入框 24px，明顯比題目文字大）                           |
| `05-student-answer-area-before-fix.png` | 學生端作答區（390px，**修前**：輸入框 18px，與題目文字同級）                             |

第 4、5 張是同一個畫面的修前／修後對照 —— 這正是 §2 那個缺口的視覺證據。

## 6. 無障礙與 DESIGN.md 符合度

- 只改字級與間距，沒有改 DOM 結構、沒有改 tab 順序、沒有改 ARIA。
- 輸入框字級變大不影響觸控目標大小（輸入框高度由 padding 決定，字級只影響文字）。
- 窄螢幕下輸入框仍維持 `width: 100%`，實測 390px 沒有水平溢出（`scrollWidth == 390`）。
- 沒有新增任何顏色、字體家族、圓角、陰影；只調整既有 token 的數值與新增兩個投影專用 token。
- 設計正本仍是 `design/DESIGN.md` 與 `web/src/styles/tokens.css`，本 PR 只改 tokens.css 與引用點。

## 7. 未解決（留待後續）

- 投影看板的「8 公尺判讀」是實測字級（44／32／28px）＋截圖，**實際投影到牆上由 Philip 現場判讀**。
- 老師端在 100 組（D20 上限）時的密度收益，需要 100 組的實機畫面（程式化量測已有，見 PR 說明）。
