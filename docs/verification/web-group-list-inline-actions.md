# 組別管理每列改為「名稱＋按鈕同一列」— 人工與視覺驗證

- 日期：2026-11-23
- 分支：`feat/015-group-list-inline-actions`（PR #30，堆疊在 PR #29 `feat/014-typography-and-density-tokens` 之上，PR #29 堆疊在 PR #28 之上）
- 對應變更：`web/src/features/teacher/GroupManager.module.css`（唯一改動的產品檔案）

## 1. 變更內容

組別管理的每一列原本是「名稱列 + 按鈕列」上下疊兩行。改成同一列：

| 項目                   | 改動前（grid） | 改動後（flex）       |
| ---------------------- | -------------- | -------------------- |
| 每列高度               | 103 px         | **67 px**（實測）    |
| 組別管理區塊（50 組）  | 5,446 px       | **3,543 px**（−35%） |
| 組別管理區塊（100 組） | 10,493 px      | **6,893 px**（−34%） |
| 整頁高度（50 組）      | 8,061 px       | **6,158 px**（−24%） |
| 整頁高度（100 組）     | 13,301 px      | **9,701 px**（−27%） |

量測條件：**1440px 視窗、搶答中、已匯入官方題目**（`fixtures/guided-notes/01-official-single.xlsx`），
新舊版面用**完全相同的資料**各跑一次。
（量測方式見 §3。注意「準備中」狀態的數字會少 36px —— 搶答中多一行「已鎖定」說明。）

CSS 層面的四件套：

- `.group`：`display: flex` + `justify-content: space-between`（取代 `display: grid`）
- `.actions`：`flex: 0 0 auto`（按鈕列不可被壓縮）
- `.renameForm`：`flex: 1 1 100%`（改名表單獨佔一列）
- `.groupHeader`：`overflow-wrap: anywhere`（長組名可斷行，見 §5）

只改 CSS，不動 TSX：DOM 順序、`aria-label`、`ul > li` 語意、鍵盤順序全部不變。

## 2. 自動化驗證

```bash
npm test --workspace @classroom/web
# Test Files  24 passed (24)
#      Tests  132 passed (132)

npm test --workspace @classroom/web -- --run tests/teacherSectionStyle.test.ts
# Test Files  1 passed (1)
#      Tests  8 passed (8)
```

新增的版面守衛（`web/tests/teacherSectionStyle.test.ts`）用讀 CSS 原始檔的方式守住這次的不變量——
因為純樣式 invariant 讓 CI 不會紅（這是本專案既有的做法，見同檔 `teacherSectionStyle.test.ts` 與
`phaseColor.test.ts` 的開頭註解）。涵蓋：

- `.group` 是 `display: flex` + `space-between` + `flex-wrap: wrap`，且**不是** `display: grid`
- `.actions` 是 `flex: 0 0 auto` + `margin-inline-start: auto`
- `.renameForm` 是 `flex: 1 1 100%`
- `.groupHeader` 有 `min-width: 0` + `overflow-wrap: anywhere`
- `.button` 仍保留 `design/DESIGN.md` §5 規定的 `padding: var(--space-3) var(--space-6);`（不能為了密度拿掉）

**守衛的有效性已驗證**（不是寫出來不會失敗的假測試）：

| 突變                                             | 結果                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 把 `.group` 改回 `display: grid`                 | `每組的名稱與按鈕在同一列` **失敗**（`Tests 1 failed \| 6 passed`）                 |
| 拿掉 `.groupHeader` 的 `overflow-wrap: anywhere` | `長組名可以斷行，不會把整頁撐寬成水平溢出` **失敗**（`Tests 1 failed \| 7 passed`） |

## 3. 程式化版面量測（不靠目視）

工具：`scripts/group-shots.mjs`（本次新增，開發用，不影響產品程式）。

```bash
npm run build
TEACHER_PASSWORD=... npm start
SHOT_PASSWORD=... node scripts/group-shots.mjs docs/verification/web-group-list-inline-actions-screenshots
```

輸出：

```
groups created: 12/12
每列高度（px）: 67（12 列）
同一列驗證: {"headerTop":1049,"headerBottom":1073,"actionsTop":1036,"actionsBottom":1086,"centerDelta":0,"rowHeight":67}
改名中的列高（px）: 117
改名表單獨佔一列驗證: {"headerBottom":449,"formTop":461,"formLeft":160,"headerLeft":160}
手機寬度溢出檢查: {"viewportWidth":390,"docScrollWidth":390}
```

- **同一列**：名稱欄與按鈕欄的垂直中心差距 `centerDelta = 0` px（列高 67 px），確認兩者在同一列。
- **改名表單獨佔一列**：`formTop (461) > headerBottom (449)`，確認表單落在名稱下方、沒有被擠在右側。
- **每列高度一致**：12／50／100 組實測每列都是 67 px，沒有因組數或組名長度而產生不一致的列高。
- **窄視窗不溢出**：`docScrollWidth == viewportWidth == 390`。

### 3.1 各區塊高度（密度成果的數字來源）

```bash
SHOT_GROUPS=50 SHOT_SECTIONS=1 SHOT_PASSWORD=... \
  node scripts/group-shots.mjs /tmp/shots
```

`SHOT_SECTIONS=1` 會匯入官方題目、開搶答，再量每個區塊的高度
（量測條件與 CSS 註解一致：1440px、搶答中、已匯入官方題目）：

```
=== 各區塊高度（搶答中）===
{
  "docHeight": 6158,
  "sections": [
    { "title": "搶答控制",  "height": 6062 },
    { "title": "搶答控制",  "height": 330  },
    { "title": "匯入學習單", "height": 215  },
    { "title": "題目清單",   "height": 807  },
    { "title": "組別管理",   "height": 3543 },
    { "title": "投影看板",   "height": 142  },
    { "title": "作答看板",   "height": 767  },
    { "title": "(無標題)",   "height": 296  }
  ]
}
```

同一支工具在**改動前**的 grid 版面上量到「組別管理 5,446 px／整頁 8,061 px」，
100 組時是「10,493 px／13,301 px」—— 新舊兩次都用完全相同的資料與量測條件。

> 註：PR 說明初稿寫的「50 組：5,343 px」比實測少一列（103 px），
> 那是量測當下少算了一組組別；100 組的 10,493 px 兩邊一致。
> 本文件與 CSS 註解都改用上表這組可重現的數字。

## 4. 截圖（Constitution 原則 IX／EXECUTION-PLAYBOOK §10）

存於 `docs/verification/web-group-list-inline-actions-screenshots/`：

| 檔案                                         | 內容                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `01-teacher-group-list-desktop.png`          | 老師端組別管理（桌面 1440px，一般狀態，12 組）                       |
| `02-teacher-group-rename.png`                | 老師端組別管理（改名中：表單獨佔一列）                               |
| `03-teacher-group-list-mobile.png`           | 老師端組別管理（手機寬度 390px）                                     |
| `04-teacher-group-list-mobile-long-name.png` | 最長組名（30 個不可斷開的英文字母）那一列的細節（390px）             |
| `05-student-mobile.png`                      | 學生端（手機寬度 390px；本次改動未觸及學生端，此張證明沒有視覺連動） |

## 5. 響應式行為（實測，非推理）

用同一組資料（短名「第一組」／30 字 CJK／30 個不可斷開的英文字母），
在四種視窗寬度量每一列的 bounding box：

| 視窗寬度 | 短組名         | 30 字組名                   | 水平溢出               |
| -------- | -------------- | --------------------------- | ---------------------- |
| 1440px   | 同一列（67px） | 同一列（67px）              | 無（scrollWidth 1440） |
| 1024px   | 同一列（67px） | 同一列（67px）              | 無（scrollWidth 1024） |
| 768px    | 同一列（67px） | 同一列（67px）              | 無（scrollWidth 768）  |
| 390px    | 同一列（67px） | 按鈕列整列換行靠右（159px） | 無（scrollWidth 390）  |

窄視窗降級是刻意的防護：`.group` 保留 `flex-wrap: wrap`、`.groupHeader` 保留 `min-width: 0`，
所以空間不足時按鈕列會**整列**換到下一行並靠右，而不是把按鈕壓扁或讓版面橫向溢出。

### 5.1 順帶修掉的既有水平溢出

量測時發現：**改動前**（grid 版面）在 390px 視窗下，只要有一個 30 字組名，
整個老師端頁面就會被撐寬到 `scrollWidth 455px`（溢出 65px，43 個元素受影響）。
這是既有的問題（新舊版面都會發生，**不是**本次改動引入的），但因為
`.groupHeader` 本來就是這次要動的元素，順手補上 `overflow-wrap: anywhere` 修掉：

|                                            | 390px 視窗 + 30 字組名         |
| ------------------------------------------ | ------------------------------ |
| 改動前（grid）                             | `scrollWidth 455`（溢出 65px） |
| 改動前（flex，未加 overflow-wrap）         | `scrollWidth 455`（溢出 65px） |
| 改動後（flex + `overflow-wrap: anywhere`） | `scrollWidth 390`（無溢出）    |

`overflow-wrap: anywhere` 只影響「不可斷開的長字串」；CJK 本來就能逐字斷行，
桌面寬度下的呈現完全沒有變化（§5 表格的 1440／1024／768 三列，組名長度對列高沒有影響）。

## 6. 無障礙與 DESIGN.md §5

- DOM 順序、`aria-label`（`改名 {name}`／`刪除 {name}`）、`ul[aria-label="組別清單"]` 的清單語意皆未變動。
- `li` 由 `display: grid` 改成 `display: flex` 不影響 listitem 語意。
- Tab 順序＝DOM 順序，不受 CSS 影響；`:focus-visible` 外框由 `web/src/styles/base.css` 全域提供，不因 flex 版面被裁切。
- DESIGN.md §5 的三條規則皆未受影響：按鈕留白不變（`var(--space-3) var(--space-6)`＋1px 墨框）、區塊之間只留一條下框線、標題與按鈕樣式一致。沒有新增任何顏色、字體、圓角、陰影。

## 7. 未解決（既有問題，非本次引入，留待後續）

- **改名時焦點落回 `<body>`**：點「改名」後，含被聚焦按鈕的 `.actions` unmount、表單 mount，
  輸入框沒有自動聚焦，鍵盤使用者按 Tab 會從頁首重新開始。
  屬於既有的無障礙缺口，與本次 CSS 改動無關，不塞進這個 CSS-only PR；另開 issue 處理。
  （審查者 GLM 與 Kimi 各自獨立指出同一點。）

## 8. 審查紀錄

- **GLM-5.3-max** 審查 PR #30：CSS 技術判斷正確、無 DESIGN.md §5 違規、無響應式破版；
  提出 5 項發現（註解過度承諾、既有 focus 缺口、缺測試守衛、註解數字與 PR 描述矛盾、驗證腳本含密碼預設值且無截圖）。
- **Kimi-K3-max** 審查 PR #30：同樣確認 CSS 正確、無 DESIGN.md §5 違規；
  提出 4 項發現（含畫面的變更未附截圖、缺回歸測試守衛、既有 focus 缺口、極窄寬度降級）。
- 本文件對應的處理：
  - 發現「缺測試守衛」→ 已補 §2（8 項，含突變測試驗證守衛有效）。
  - 發現「註解數字與描述矛盾」→ 已由 commit `ce0759b` 修正，並在本次改用 §1 實測值重寫註解。
  - 發現「驗證腳本含密碼預設值」→ `scripts/token-shots.mjs` 的硬編碼預設密碼已改為「必須由環境變數傳入」；
    新增的 `scripts/group-shots.mjs` 同樣沒有預設值。
  - 發現「註解宣稱不會換行」→ 註解已改成準確描述。
  - 發現「含畫面的變更未附截圖」→ 已補 §4 的五張截圖與本文件（Constitution 原則 IX）。
  - 發現「改名 focus 落回 body」→ 留待後續 issue（見 §7）。
  - 發現「極窄寬度降級」→ 已寫進 CSS 註解與本文件 §5，並在 §5.1 說明窄寬降級與既有溢出的實測結果。
