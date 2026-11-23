# 表單控制項統一規格（--control-height）— 驗收紀錄

- 日期：2026-11-23
- 來源：設計負責人（Philip）在 [PR #29](https://github.com/Danielweng0902/Answering-System_speckit/pull/29) 的留言
- 設計正本：`design/DESIGN.md` v1.2

## 1. 設計負責人的原始意見

> 匯入學習單的「讀取」按鈕比旁邊的連結輸入框高（輸入框上下 `--space-2`、按鈕上下 `--space-3`），
> 同一列底部對齊後按鈕上緣凸出，看起來沒有對齊，按鈕也顯得太大。建議：
>
> 1. 新增 `--control-height`（例如 2.75rem = 44px，符合點擊目標最小尺寸），
>    同一列的輸入框與次要按鈕都用這個高度；按鈕只留左右留白，並寫進 DESIGN.md §5。
> 2. 次要按鈕左右留白從 `--space-6` 收到 `--space-4`。
> 3. 上傳檔案仍是瀏覽器原生的灰色「選擇檔案」按鈕，可以用 `::file-selector-button`
>    套成次要按鈕的樣式（不用改 TSX）。
> 4. 建議此次更動可以把所有按鈕都統一規格，目前視覺效果覺得按鈕有點大。
>    組別管理的「新增組別」列、改名表單也是輸入框＋按鈕，請一併檢查。

## 2. 做了什麼

### 2.1 新增兩個 token（`web/src/styles/tokens.css`）

```css
--control-height: 2.75rem; /* 44px */
--control-padding-inline: var(--space-4); /* 左右留白 */
```

44px 同時滿足 constitution 原則 VII 的「點擊目標至少 44×44px」。

### 2.2 按鈕（7 個規則）

| 檔案                                | 選取器          | 原本的 padding    |
| ----------------------------------- | --------------- | ----------------- |
| `student/AnswerArea.module.css`     | `.button`       | `space-3 space-8` |
| `student/StudentPage.module.css`    | `.button`       | `space-3 space-6` |
| `teacher/PhaseControl.module.css`   | `.button`       | `space-3 space-6` |
| `teacher/QuestionImport.module.css` | `.button`       | `space-3 space-6` |
| `teacher/TeacherLogin.module.css`   | `.button`       | `space-3 space-8` |
| `teacher/GroupManager.module.css`   | `.button`       | `space-3 space-6` |
| `teacher/TeacherPage.module.css`    | `.exportButton` | `space-3 space-6` |

全部改為：

```css
display: inline-flex;
align-items: center;
justify-content: center;
min-height: var(--control-height);
padding: 0 var(--control-padding-inline);
```

> 順帶解決了一個**既有的不一致**：DESIGN.md §5 本來就規定「主要動作與次要動作的 padding 相同」，
> 但實際上「送出」（`space-8`）與「登入」（`space-8`）用的留白比其他按鈕（`space-6`）大，
> 組別清單（`space-4`）又更小。現在全部統一。

### 2.3 輸入框（4 個規則）

`PhaseControl`、`QuestionImport`、`TeacherLogin`、`GroupManager` 的 `.input` 改為
`min-height: var(--control-height)` ＋ `padding: 0 var(--space-3)` → 與同列的按鈕同高。

**未改**：`student/AnswerArea.module.css` 的作答輸入框 —— 它是「底線式」（`border: 0;
border-block-end`）的橫線形制，旁邊沒有按鈕，套固定高度會改變作答區的版面。

### 2.4 上傳檔案的原生按鈕

`.fileInput::file-selector-button` 套成次要按鈕樣式（同樣的 44px 高度、透明底＋1px 墨框、
hover 反轉），不用改 TSX。

## 3. 刻意不改的兩個（請設計負責人確認）

| 對象                                                                  | 理由                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **學生端組別清單的每一列**（`GroupPicker.module.css` 的 `.button`）   | 它是「列表項」（滿寬、只有下框線），不是表單控制項。套 44px 固定高度會破壞「試卷上的組別清單」的樣子。DESIGN.md §5 也明寫組別清單是清單而非按鈕列 |
| **語言切換器**（`LanguageSwitch.module.css` 的 `.option`／`.active`） | 它在頁首右上角，是「工具列按鈕」。DESIGN.md §5 明文：「畫面右上角兩個方角**小**按鈕…欄標大小」——套 44px 會變成大按鈕，反而搶走主要動作的視線      |

兩者都在 `web/tests/controlHeight.test.ts` 裡加了守衛，避免日後被「統一規格」誤改。

## 4. 實測

`scripts/measure-controls.mjs`（新增，開發用）實測老師端每個控制項的實際高度：

| 高度     | 對象                                                      |
| -------- | --------------------------------------------------------- |
| **44px** | 所有表單控制項（輸入框與按鈕**完全同高** ← 原始痛點已解） |
| 26px     | 語言切換器（刻意的小按鈕）                                |
| 17px     | 原生 checkbox（公平順位開關等）                           |

同一列的實例（`匯入學習單`）：

```
匯入學習單      input   type=-       連結輸入      h= 44
匯入學習單      button  type=button  讀取          h= 44
組別管理        input   type=-       組別名稱      h= 44
組別管理        button  type=button  新增組別       h= 44
```

**改動前**（在 `origin/main` 用同一支量測腳本、同一個頁面狀態實測）：

```
匯入學習單      input   type=url     連結輸入      h= 42
匯入學習單      button  type=submit  讀取          h= 50     ← 差 8px，按鈕上緣凸出
組別管理        input   type=text    組別名稱      h= 42
組別管理        button  type=submit  新增組別       h= 50
```

改動前的高度分布：`17px`（checkbox）、`26px`（語言切換）、`42px`（輸入框）、`50px`（按鈕）——
按鈕與輸入框差 8px，正好對應設計負責人指出的「輸入框上下 `--space-2`、按鈕上下 `--space-3`」。

改動後：所有表單控制項都是 **44px**（唯一的 42px 輸入框消失、按鈕由 50px 收到 44px）。

## 5. 測試

新增 `web/tests/controlHeight.test.ts`（6 項）：

- `--control-height` 存在且是 2.75rem
- 每個表單控制項按鈕都用 `--control-height` ＋ 只留左右留白 ＋ 文字垂直置中
- 老師端頁首的 `.exportButton` 也走同一組規格
- 與按鈕同列的輸入框用同一個高度
- 上傳檔案的原生按鈕套成次要按鈕樣式
- 兩個刻意不改的對象維持原樣

另外更新 `web/tests/teacherSectionStyle.test.ts` 裡那條舊守衛
（「次要按鈕的留白與主要動作一致」原本斷言 `padding: var(--space-3) var(--space-6)`）→
改為斷言新的統一規格。

## 6. 截圖

`docs/verification/web-control-height-screenshots/`：

| 檔案                      | 內容                                          |
| ------------------------- | --------------------------------------------- |
| `01-teacher-prepared.png` | 老師端（1440px）—— 看輸入框與按鈕同列時的對齊 |
| `02-student-open.png`     | 學生端（390px，搶答中）                       |
| `03-student-answered.png` | 學生端（390px，已作答）                       |
| `04-projector-reveal.png` | 投影看板（1920×1080，全部揭曉）               |

## 7. 設計正本

`design/DESIGN.md` v1.1 → **v1.2**，§5 新增／修改：

- 按鈕：**高度一律 `--control-height`（44px）**、文字垂直置中、只留左右留白
  `--control-padding-inline`；主要與次要動作的高度、留白相同
- 按鈕例外：學生端組別清單每一列不是表單控制項
- 輸入：一般表單輸入框與同列的按鈕同高；上傳檔案的原生按鈕用 `::file-selector-button` 套樣式
