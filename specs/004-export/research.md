# 004 匯出（export）技術研究

> 2026-11-14｜規劃階段研究。依 [playbook §9](../003-buzz-in/../../docs/EXECUTION-PLAYBOOK.md) 指定，先做 xlsx 格式保真實驗再定技術路線。

## R1：xlsx 讀寫路線（jszip 手術式 vs exceljs 讀寫）

**Decision**: 採**路線 C（混合）**——用 `jszip` 直接替換 xlsx 內 `xl/worksheets/sheetN.xml` 中目標 cell 的 XML 節點，其餘位元組完全不動；用 `exceljs` 僅作為**寫後驗證**工具（讀回產出檔確認值、樣式、公式狀態）。

**Rationale**（實測證據）：

實驗方法：對 `fixtures/guided-notes/` 的 5 份有效學習單各做「讀入 → 不改 → 寫出」往返，再用 `jszip` 逐 entry 比對 XML，並用 `exceljs` 做物件層逐 cell 比對（9 項：文字／合併／欄寬／列高／框線／字型／對齊／表名順序／workbook 層）。

| 項目 | 01 | 02 | 03 | 04 | 05 |
|---|---|---|---|---|---|
| 1 文字 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 合併範圍 | ✓21 | ✓13 | ✓33 | ✓35 | ✓0+17 |
| 3 欄寬 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 列高 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 框線 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 字型 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7 對齊 | ✗ | ✗ | ✓ | ✓ | ✓ |
| 8 表名／順序 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 workbook 層 | ✗ | ✗ | △ | △ | △ |

- **項 7 差異**（僅 01／02）：`shrinkToFit:false` 被丟棄，但 false 是預設值，語意等價、無實質影響。
- **項 9 差異**（01／02）：丟掉 `xl/drawings/drawing1.xml`、`xl/persons/person.xml`、`xl/worksheets/_rels/sheet1.xml.rels`。實測三者皆為空殼（drawing 0 個 anchor、無 media、personList 空），無可見內容。
- **項 9 差異**（03／04／05）：原檔用 `t="inlineStr"`（03 甚至沒有 `sharedStrings.xml`），exceljs 全轉為 `t="s"`；`styles.xml` 重新序列化（font 0 由 Carlito 變 Calibri，但逐 cell 比對無任何 cell 受影響）；`docProps/core.xml` 重寫。

**Alternatives considered**：

- **路線 A（exceljs 讀入→寫出）**：最簡單，但會丟空 drawing part、把 inlineStr 轉成 sharedStrings、重寫 styles／docProps／sharedStrings。本批 fixture 剛好無可見損失，但無法保證助教或同學的檔案。
- **路線 B（純 jszip）**：可行且最保真，但缺少「寫完確認真的正確」的機制。
- **路線 C（混合）**：jszip 負責位元組層精準修改，exceljs 負責讀回驗證。兩者都已在專案相依中（`exceljs@4.4.0`、`jszip@3.10.2`），**不需新增任何相依套件**。

**主控複驗**（主控自寫 `verify_by_parent.js` 重跑，非採信子代理回報）：

```
測試 1（01 官方單題，寫入 "=1+1 純文字" 到 G5）
  變更的 entry: ["~xl/worksheets/sheet1.xml","+xl/","+xl/worksheets/"]
  讀回: {"value":"=1+1 純文字","isFormula":false,
         "font":{"size":11,"name":"Arial"},"border":"thin","align":"middle"}
測試 2（02 官方題組，寫入 "（1）CPU" 到 G5）
  變更的 entry: ["~xl/worksheets/sheet1.xml","+xl/","+xl/worksheets/"]
  讀回: {"value":"（1）CPU","isFormula":false,"font":{"size":11,...},"border":"thin",...}
測試 3（05 雙工作表，sheet「學習單」→ xl/worksheets/sheet2.xml）
  讀回: {"value":"第二工作表答案","isFormula":false,...}
```

**結論**：除目標 sheet 外，其餘 zip entry **byte-identical**（`+xl/`、`+xl/worksheets/` 只是 zip 目錄項，無內容差異）；目標 cell 的樣式索引 `s=` 保留，因此框線、字型、對齊、欄寬、列高、合併範圍全部原封不動。

## R2：目標 cell 的定位資訊（不需重新解析檔案）

**Decision**: 直接使用 002 匯入時已存進資料庫的 `guided_notes.sheet_name` 與 `blanks.cell`；**不重新解析原檔**。

**Rationale**:
- `server/src/infra/db/questionRepo.ts` 的 `getStoredGuidedNotes(database)` 回傳含 `file: Uint8Array`（原檔 BLOB）、`sheetName`、`sourceKind`、`fileName`。
- `blanks` 表已存 `cell`（A1 座標，如 `G5`）與 `prefix`，由 002 的 `guidedNotesParser.ts` 依**結構**（表頭 → 作答欄 → 合併範圍左上角）取得，套用 `toA1(origin.top, origin.left)`。符合原則 V：寫入位置來自解析結果，不是寫死座標。
- 實測 5 份 fixture 的 **36 個空格 cell 全部已存在於對應 sheet XML**（8 個空殼 `<c r="G5" s="15"/>`、28 個有內容），**0 個需要插入新 row 或新 cell**（主控複驗 `verify_blanks_exist.js`）。

**注意**：sheet 檔名不是 `sheetN.xml` 的順序假設。05 雙工作表的「學習單」實際對應 `xl/worksheets/sheet2.xml`，必須經 `xl/workbook.xml` 的 `<sheet name=... r:id=...>` → `xl/_rels/workbook.xml.rels` 的 `Id` → `Target` 解析。

## R3：sheet 名稱到檔案的解析必須不依賴 XML 屬性順序

**Decision**: 以「先取出完整的 `<sheet .../>`／`<Relationship .../>` 標籤，再從標籤內個別取屬性」的方式解析，不使用單一跨屬性的正規表示式。

**Rationale**（主控複驗時親自踩到）：子代理的實驗腳本用 `<Relationship[^>]*Id="..."[^>]*Target="...">` 匹配，在 05 檔案上**抓不到 rId2**（該檔的 `Target` 屬性排在 `Id` 之前），直接拋錯。改成分段解析後三個測試全數通過。

## R4：寫入時必須移除目標 cell 原有的 `t` 屬性

**Decision**: 替換 cell 內容時，先移除原 `<c>` 標籤上的 `t="..."` 屬性，再補上 `t="inlineStr"`。

**Rationale**（主控複驗時親自踩到）：02 題組的前綴 cell 原本是 `<c r="G5" s="15" t="s"><v>5</v></c>`，若直接補屬性會變成 `t="s" ... t="inlineStr"`，產生**重複屬性**，XML 不合法，`exceljs` 讀回時直接拋 `duplicate attribute: t`，檔案打不開。這個陷阱在空殼 cell（`<c r="G5" s="15"/>`）不會發生，只在原本有內容的 cell 發生，因此**必須兩種型態都測**。

## R5：前綴是 cell 文字的一部分，不是獨立欄位

**Decision**: 匯出時寫入的內容是「前綴 + 答案」組成的**單一儲存格文字**。

**Rationale**:
- 002 的 `guidedNotesParser.ts` 以 `BLANK_PREFIX_PATTERN.exec(text)?.[0]` 從 cell 文字切出前綴，證實前綴本來就在 cell 裡。
- 實測原檔 XML：02 的 `G5` 是 `<c r="G5" s="15" t="s"><v>5</v></c>`（sharedString 內容為「（1）」）；04 的 `G7` 是 `<is><t>（1）</t></is>`。兩者都是「文字含前綴」。
- 主控複驗：寫入 `（1）CPU` 後讀回為字串 `"（1）CPU"`。

## R6：答案必須是純文字，不得被當成公式

**Decision**: 一律以 `t="inlineStr"` 寫入；不寫 `<f>` 元素，不修改 `sharedStrings.xml`。

**Rationale**:
- xlsx 中公式必須有 `<f>` 子元素；`t="inlineStr"` 的 `<is><t>` 永遠是字串。實測產出檔 G5 無 `<f>`。
- 用 inlineStr 可**完全不動 `sharedStrings.xml`**，避開 shared string 索引管理（要 append `<si>` 並更新 `count`／`uniqueCount`，破壞面更大）。
- 附帶實測（exceljs 側）：直接指派 `value='=1+1'` 寫出為 `<c r="G5" s="15" t="s"><v>5</v></c>`，讀回是字串、`<f>` 不存在，**不會被公式化**；用 `richText` 包裝同樣安全。因此若日後改走 exceljs 路線，也不會產生公式。
- 需做 XML escape（`&`、`<`、`>`）與前後空白加 `xml:space="preserve"`。

## R7：匯出的 HTTP 介面

**Decision**: 以 HTTP 下載（`GET`），不是 Socket.IO 指令。

**Rationale**:
- 匯出產出的是二進位檔案（xlsx／csv），不是快照。001 的 `contracts/http-api.md` 已有 HTTP 端點的既有模式（`/api/student/join`、`/api/teacher/login`）。
- 匯出不改變任何活動狀態，因此不應產生 `state` 廣播、也不需要 revision 遞增。
- 老師身分沿用既有的 `Authorization: Bearer <token>` 機制（001 已實作）。

## R8：CSV 寫法

**Decision**: 用 Node 內建 `Buffer`／字串自行組 CSV，不引入新相依。

**Rationale**:
- 需求明確（FR-010～FR-015）：欄位固定 7 欄、UTF-8 加 BOM、含逗號／引號／換行要正確引用、以 `=`／`+`／`-`／`@` 開頭要加前導單引號避免被當公式。
- 這些規則用字串組裝即可完整控制；引入 CSV 函式庫反而要再調它的轉義行為。
- BOM：Excel 開啟 UTF-8 CSV 需要 BOM 才不會亂碼（AC-004-12）。

## R9：作廢作答不列入匯出

**Decision**: 匯出只取「有效作答」（`voided_at IS NULL`）；被作廢的作答不寫入 Guided Notes 填空格，也不出現在 CSV。

**Rationale**:
- 003 的 D24（2026-11-13 兩組同意）：被作廢的作答保留紀錄，但**不計入搶答成功、進度與結果**。
- 2026-11-14 clarify 確認：CSV 與老師看板、結果畫面完全一致。
- 影響 `answerRepo` 的查詢：需要「某題的搶答成功組別」與「所有有效作答明細」兩種檢視，兩者都要排除作廢列。
