# W6b Finish Guided Notes fixtures

- session id：`ses_e3bbf233cffe0U1CUxUj3XXyCv`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：7

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the implementation sub-agent for this task.

You are an implementation worker. Do the work yourself; do not spawn or delegate to other agents. A previous worker stopped after step 1 of this job; finish it. Do NOT end your turn until the acceptance command passes.

## State right now
In `/Users/Pig0902/Answering-System_speckit/fixtures/guided-notes/` there are only `expected.json` and `_build/verify_fixtures.py` (an independent structural parser that compares each fixture to `expected.json`). Running `python3 -I fixtures/guided-notes/_build/verify_fixtures.py` from `/Users/Pig0902/Answering-System_speckit` currently prints 8 FAIL lines "fixture file not found". Read both files first; keep them unless they are wrong, and fix them if they disagree with the spec below.

## Goal & Why
A course project (classroom buzz-in answering system) must import "Guided Notes" spreadsheets and write the winning answers back into the answer blanks. The TA will test with a DIFFERENT sheet than the samples, so cell positions must never be hard-coded. These fixtures exercise a parser that locates things by structure.

## Inputs (read-only, the TA's official samples — highest-priority reference)
- `/Users/Pig0902/Answering-System_speckit/docs/軟工期末專案_單題_範例.xlsx`
- `/Users/Pig0902/Answering-System_speckit/docs/軟工期末專案_題組_範例.xlsx`
Structure (verify with openpyxl): one sheet `學習單`; title in B2 (merged B2:H2); header row 4 with B4 `題號`, C4:F4 `題目`, G4:H4 `作答`; numeric question numbers in column B; a single question's answer blank is the merged G:H cell on its row (empty); a question GROUP has its 題號 cell merged vertically over its sub-question rows (e.g. B5:B6) and each sub-row has its own answer cell in G pre-filled with a prefix `（1）`, `（2）`; blank spacer rows between questions.

## Deliverables (write ONLY under `/Users/Pig0902/Answering-System_speckit/fixtures/guided-notes/`)
1. `01-official-single.xlsx`, `02-official-group.xlsx`: byte-for-byte copies of the two TA samples (`cp`).
2. `03-shifted-layout.xlsx`: same visual style (fonts, borders, merge pattern, column widths where practical) but different layout: extra instruction row/column so the header row is NOT row 4 and 題號 is NOT column B; different title; 8 questions with original short-answer computer-science questions in Traditional Chinese; different number of spacer rows.
3. `04-mixed-groups.xlsx`: at least 7 question numbers of which 3 are groups, one group with THREE sub-questions (`（1）`,`（2）`,`（3）`), groups and singles interleaved, answer column merged over a different width than the samples.
4. `05-two-sheets.xlsx`: the Guided Notes sheet is the SECOND sheet (first sheet `說明` with a few lines of text).
5. `90-invalid-no-header.xlsx` (no 題號/題目/作答 header row), `91-invalid-duplicate-number.xlsx` (question number 3 twice), `92-invalid-empty.xlsx` (header row, zero questions).
6. `expected.json`: per fixture `{"file", "valid", "sheet", "header_row", "questions":[{"number":1,"blanks":[{"cell":"G5","prefix":""}]}], "question_count", "blank_count"}`; invalid files: `"valid": false, "error": "<short reason>"`. For a merged answer cell, `cell` is the top-left cell of the merge.
7. `README.md` (zh-TW): one table describing each fixture and the parser behaviour it tests; say 01/02 are the TA's official samples.
8. `_build/make_fixtures.py`: openpyxl script that generates 03–05 and 90–92 (deterministic, re-runnable). `_build/verify_fixtures.py`: must not hard-code coordinates.

## Acceptance (run these yourself and paste the REAL output in your final message)
- `cd /Users/Pig0902/Answering-System_speckit && cmp docs/軟工期末專案_單題_範例.xlsx fixtures/guided-notes/01-official-single.xlsx && cmp docs/軟工期末專案_題組_範例.xlsx fixtures/guided-notes/02-official-group.xlsx && echo IDENTICAL`
- `python3 -I fixtures/guided-notes/_build/verify_fixtures.py` prints PASS for all 8 files and exits 0.
- expected.json: 01 has 6 questions / 6 blanks; 02 has 4 questions / 6 blanks.
- No answers filled in; all short-answer. System `python3` with openpyxl 3.0.10 only; no new packages.

## Limits
No application code, nothing outside `fixtures/guided-notes/`, do not modify `docs/`, no git commands, no network.

## Final message format
結果 TLDR: <one sentence>
做了什麼: <file list>
證據: <both commands and their real output>
風險與未完成: <bullets or 無 + reason>

## 助理

我會先讀取現有 `expected.json` 與驗證腳本，再依照官方範例的實際結構建立並驗證所有 fixtures。

## 助理

接著會用 `openpyxl` 實際檢查兩份官方活頁簿的工作表、合併範圍、題號與作答欄，確認現有預期資料是否符合規格。

## 助理

官方兩份結構與 `expected.json` 前兩項一致；再接著建立可重跑的產生器、複製官方範例並產生其餘 6 份測試檔。

## 助理

六份自建檔已產生；現在執行結構驗證，若有座標或題組數量不符會立即修正。

## 助理

結構驗證已全數通過。最後會再重跑一次產生器確認可重跑，並執行指定的官方檔案比對與最終驗收指令。

## 助理

結果 TLDR: 已完成 8 份 Guided Notes fixtures、產生器與說明文件，兩項驗收指令全部通過。

做了什麼:
- 建立 `01-official-single.xlsx`
- 建立 `02-official-group.xlsx`
- 建立 `03-shifted-layout.xlsx`
- 建立 `04-mixed-groups.xlsx`
- 建立 `05-two-sheets.xlsx`
- 建立 `90-invalid-no-header.xlsx`
- 建立 `91-invalid-duplicate-number.xlsx`
- 建立 `92-invalid-empty.xlsx`
- 建立 `README.md`
- 建立 `_build/make_fixtures.py`
- 保留並驗證既有 `expected.json`、`fixtures/guided-notes/_build/verify_fixtures.py`

證據:

```bash
cd /Users/Pig0902/Answering-System_speckit && cmp docs/軟工期末專案_單題_範例.xlsx fixtures/guided-notes/01-official-single.xlsx && cmp docs/軟工期末專案_題組_範例.xlsx fixtures/guided-notes/02-official-group.xlsx && echo IDENTICAL
```

```text
IDENTICAL
```

```bash
cd /Users/Pig0902/Answering-System_speckit && python3 -I fixtures/guided-notes/_build/verify_fixtures.py
```

```text
PASS 01-official-single.xlsx: 6 questions, 6 blanks
PASS 02-official-group.xlsx: 4 questions, 6 blanks
PASS 03-shifted-layout.xlsx: 8 questions, 8 blanks
PASS 04-mixed-groups.xlsx: 7 questions, 11 blanks
PASS 05-two-sheets.xlsx: 5 questions, 5 blanks
PASS 90-invalid-no-header.xlsx: expected rejection: missing header row
PASS 91-invalid-duplicate-number.xlsx: expected rejection: duplicate question number: 3
PASS 92-invalid-empty.xlsx: expected rejection: no questions
SUMMARY: 8 passed, 0 failed
```

風險與未完成:
- 無；8 份正式驗證全部通過，產生器也已實際重跑確認可再次產生檔案。
