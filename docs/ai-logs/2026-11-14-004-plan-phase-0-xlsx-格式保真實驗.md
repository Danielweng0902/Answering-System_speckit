# 004 plan Phase 0：xlsx 格式保真實驗

- session id：`ses_e2695c44effe0o8NSCXonnDlg5`
- 日期：2026-11-14
- 模型：nchc/GLM-5.3-max
- 輪次：10

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the research sub-agent for this task.

工作目錄 <repo>。你是 GLM-5.3-max，做 004（匯出）plan 階段的**技術可行性實驗**。這是只讀研究任務，但允許你在暫存目錄建立實驗腳本。

限制：
- 不得修改 repo 內任何檔案（不得改 server/、web/、shared/、specs/、docs/、fixtures/、package.json）。
- 不得 git commit/push/checkout/reset/clean。
- 不得安裝任何新套件（只能用已安裝的：exceljs 4.4.0、jszip 3.10.2、node:sqlite、node 內建）。
- 實驗腳本與輸出只能放在 /private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/004-export-research/ 下。
- 不得委派。

研究目標（這決定 004 走 exceljs 讀寫還是直接改 xlsx 內部 XML）：
對 fixtures/guided-notes/ 中的 5 份有效學習單（先讀 fixtures/guided-notes/expected.json 找出哪 5 份 valid:true），各做一次「讀入 → 不改任何東西 → 寫出」的往返，然後逐項比對原檔與產出檔：

必比項目：
1. 所有儲存格的文字內容（逐工作表、逐儲存格）
2. 合併範圍（merge ranges 的完整座標集合）
3. 欄寬（每欄 width）
4. 列高（每列 height）
5. 儲存格框線（border 的四邊 style/色）
6. 字型（font: name、size、bold、italic、color）
7. 對齊（alignment: horizontal、vertical、wrapText）
8. 工作表名稱與順序
9. 是否遺失原本 workbook 層級的東西（例如 definedNames、圖片、其他工作表內容）

比對方式建議：用 jszip 解壓兩份 xlsx，直接比對 XML（可做正規化後的文字比較），比單看 exceljs 物件更嚴謹。也可同時用 exceljs 讀回兩份做物件比對。

請回答：
- 5 份檔案各自哪些項目**完全保留**、哪些**有差異**（列出具體差異，例：某欄寬 12.5 → 12）。
- 有差異的項目，是否可用「只改目標儲存格 XML、其餘原封不動」的方式避免（即用 jszip 只替換 sheet XML 中的目標 cell，保留其他部分 byte-identical）？請評估可行性與風險（xlsx 的 sheet XML 結構、sharedStrings、inlineStr、cell 型別 t="s"/t="inlineStr"/t="str"、樣式索引 s= 的關聯）。
- 建議 004 採哪條路線：
  (A) exceljs 讀入→寫出（最簡單，但可能丟格式）
  (B) jszip 直接改 sheet XML（保留最完整，但需處理 cell 型別與樣式）
  (C) 混合：exceljs 只用來「找出要寫的 cell 位置與寫入值」，實際位元組修改用 jszip
  並給出理由。若 (C) 可行，說明 exceljs 讀取時如何可靠取得該 cell 的 XML 座標（row/col/工作表名），以及寫入時如何處理「原本是空 cell」與「原本有前綴文字」兩種情況（prefix 在 Excel 裡是 cell 文字的一部分還是獨立欄？請從 002 的 parser 邏輯與 fixture 實際內容確認：01-official-single 的 G5 與 02-official-group 的 G5 原始內容是什麼）。
- 寫入值必須是純文字（不能被當公式）：在 exceljs 與直接改 XML 兩種方式下分別怎麼做？直接改 XML 時 t="s" 的 sharedStrings 索引怎麼處理、怎麼保證不被當公式？請給出具體做法。

另外請確認並回報：
- fixtures/guided-notes/expected.json 裡 5 份 valid 的檔名、以及每份的題數／空格數。
- 002 的 parser 如何決定 cell 座標（server/src/domain/guidedNotesParser.ts 與 sheetGrid.ts），匯出時要重用哪些資訊。
- 原檔 BLOB 保存在哪（server/src/infra/db/questionRepo.ts 的 guided_notes.file），匯出時如何取回（不要寫程式，只報告既有函式名稱與位置）。

輸出格式：以「## 004 匯出技術研究」開頭，1500 字內，必含「逐項保真度表格（5 份 × 9 項）」與「建議路線與理由」，並附你實際執行的指令與關鍵輸出摘錄。所有結論都要有實驗輸出支持，不要憑印象。

## 助理

套件已確認：exceljs 4.4.0、jszip 3.10.2 位於儲存庫的 `node_modules` 中。現在開始設計實驗。

## 助理

XML 層比較顯示 01/02 丟失 `xl/drawings/drawing1.xml`、`xl/persons/person.xml`；03 原檔沒有 `xl/sharedStrings.xml`（使用 inlineStr，exceljs 轉為 sharedStrings）。接著做 exceljs 物件層的逐項語意比對。

## 助理

物件層比對完成。接著檢查 01/02 遺失的 drawing/person 部分、G5 原始 XML 內容，以及預設字型差異。

## 助理

關鍵原始資料已確認：01 的 G5 是空格子 `<c r="G5" s="15"/>`；02 的 G5 是 `t="s"` shared string「（1）」（前綴是 cell 文字的一部分）；03 全部用 `t="inlineStr"`。再看 drawing1.xml 是否為空殼，然後做路線 C 的手術式編輯實驗。

## 助理

drawing1.xml 是 0 個 anchor 的空殼（LibreOffice 產生的空 drawing part），person.xml 也是空的 personList——exceljs 丟掉它們語意上無損。現在做路線 C 手術式編輯實驗。

## 助理

發現 C1 的 regex 有 bug（self-closing cell 被過度匹配），C2/C3 正確。修正後重跑 C1，並實測 exceljs 對 `=` 開頭字串的公式化行為。

## 助理

C1 修正後驗證通過。最後做一個穩健性檢查：5 份檔案所有 blank cell 是否都實際存在於 sheet XML（route C 的前提）。

## 助理

注意到 04 的 inlineStr cell 我的檢測只看 `<v>`，需確認是否其實有 `<is>` 內容（前綴）。快速驗證：

## 助理

所有實驗完成。整理研究報告。

## 004 匯出技術研究

### 實驗方法
腳本與產出均在 `/private/var/folders/k5/vlsbp10n1fxcsjwj3hfl1jy40000gp/T/opencode/004-export-research/`：`roundtrip.js`（exceljs 讀→不改→寫）、`compare_xml.js`（jszip 逐 entry 比 XML）、`compare_obj.js`（exceljs 物件層逐 cell 比對 9 項）、`inspect_raw.js`／`check_blanks.js`（原始 XML 檢查）、`route_c_fix.js`（手術式編輯實測）。repo 未動。

### 有效檔案（expected.json）
01（6題/6格）、02（4題/6格）、03（8題/8格）、04（7題/11格）、05（5題/5格，雙工作表「說明｜學習單」），共 36 個空格。

### 逐項保真度表格（exceljs 4.4.0 往返，✓=完全保留）

| 項目 | 01 | 02 | 03 | 04 | 05 |
|---|---|---|---|---|---|
| 1 文字 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 合併範圍 | ✓21 | ✓13 | ✓33 | ✓35 | ✓0+17 |
| 3 欄寬 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 列高 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 框線 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 字型 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7 對齊 | ✗ | ✗ | ✓ | ✓ | ✓ |
| 8 表名/順序 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 workbook層 | ✗ | ✗ | △ | △ | △ |

具體差異：
- **項7（僅01/02）**：C5、C7 等 6 格 `shrinkToFit:false` 被丟棄——false 是預設值，語意等價，無實質影響。
- **項9（01/02）**：丟掉 `xl/drawings/drawing1.xml`、`xl/persons/person.xml`、`xl/worksheets/_rels/sheet1.xml.rels`。實測三者皆空殼（drawing 0 個 anchor、無 media、personList 空），無可見內容；definedNames 原本就是空的，保留。
- **項9（03/04/05）**：`△`=結構性改寫但內容等價——03/04/05 原檔用 `t="inlineStr"`（03 無 sharedStrings.xml），exceljs 全轉為 `t="s"`；styles.xml 重新序列化（font 0: Carlito→Calibri，但逐 cell 比對無任何 cell 受影響）；docProps/core.xml 重寫（加 lastModifiedBy）。
- XML 層無任何 entry 是 byte-identical 的 sheet/styles/workbook，但 `xl/theme/theme1.xml` 與（01/02 的）`xl/sharedStrings.xml` 內容相同。

### 路線 C 實測（jszip 只改目標 cell）
- **空 cell**（01 G5 `<c r="G5" s="15"/>`）：替換為 `<c r="G5" s="15" t="inlineStr"><is><t>=1+1 純文字</t></is></c>`。驗證：單一區段替換、相鄰 F5/H5/B6/B7 未變、**其餘 10 個 zip entry 全部 byte-identical**（jszip 對未改 entry 重用原始壓縮資料）、讀回為字串 `"=1+1 純文字"` 非公式、`s="15"` 保留（border thin、font 11、alignment 同）。
- **前綴 cell**：prefix 是 **cell 文字的一部分**（02 G5=`t="s"` sharedString「（1）」；04 G7=`<is><t>（1）</t></is>`），非獨立欄。寫入即 `（1）+答案` 合併成一個 inlineStr。02 G5 實測讀回 `"（1）CPU"` ✓。
- **穩健性**：5 檔 36 個空格 cell 全部已存在於 sheet XML（01/02 空格為無 t= 的空 cell，03/05 為 `t="n"` 空殼，04 混合），無需插入新 row。風險與對策：(a) cell 匹配 regex 須先試 self-closing 再試 paired（實驗中踩過並修正）；(b) 需 XML escape（`& < >`）與前後空白加 `xml:space="preserve"`；(c) 用 inlineStr 可完全不動 sharedStrings.xml，避開索引管理；(d) sheetName→sheetN.xml 須經 workbook.xml+rels 解析（兩種屬性順序都遇過，`check_blanks.js` 已示範）。

### 公式安全
- **直接改 XML**：`t="inlineStr"`（或 `t="s"`）的值永遠是字串；公式必須有 `<f>` 子元素。實測產出檔 G5 無 `<f>` ✓。不建議改 sharedStrings 索引（t="s" 需 append `<si>` 並改 count，增加破壞面）。
- **exceljs**：實測 4.4.0 指派 `value='=1+1'` 後寫出仍為 `t="s"` 字串、讀回純字串（不自動公式化）；保險做法可用 `{richText:[{text}]}`，亦實測安全。

### 建議路線：**(C) 混合**
理由：(1) 匯出檔是給老師的正式成果，C 可證明「只動了答案 cell、其餘 byte-identical」，比 A 的「語意大致等價」強；(2) A 實測會丟空 drawing part、轉換 inlineStr→sharedStrings、重寫 styles/docProps——本批 fixture 剛好無可見損失，但無法保證未來檔案；(3) C 的難點已全部實測克服，程式量小。定位資訊**不需要 exceljs**：DB 已存 `guided_notes.sheet_name` 與 `blanks.cell`（002 parser 經 `findHeader`→`answerColumn`→`findMerge` 取合併原點 `toA1`，prefix 由 `BLANK_PREFIX_PATTERN` 從 cell 文字切出）；exceljs 只作寫後讀回驗證。原檔取回用 `getStoredGuidedNotes(database)`（`server/src/infra/db/questionRepo.ts`，回傳含 `file: Uint8Array`，讀 `guided_notes` id=1）。若時程壓力大，A 是可接受的退路（實測 9 項中僅 2 項有無害差異）。
