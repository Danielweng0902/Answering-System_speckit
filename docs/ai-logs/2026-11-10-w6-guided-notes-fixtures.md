# W6 Guided Notes fixtures

- session id：`ses_e3bc6b86affeY5PTyNocPTTwHs`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：2

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the implementation sub-agent for this task.

You are an implementation worker. Do the work yourself; do not spawn or delegate to other agents.

## Goal & Why
A course project (classroom buzz-in answering system) must import "Guided Notes" spreadsheets and write the winning answers back into the answer blanks. The TA will test with a DIFFERENT sheet than the samples, so cell positions must never be hard-coded. We need a set of test fixture spreadsheets that exercise a parser which locates things by structure. Create them now, before any application code exists.

## Inputs (read-only, the TA's official samples — highest-priority reference)
- `<repo>/docs/軟工期末專案_單題_範例.xlsx` (single questions)
- `<repo>/docs/軟工期末專案_題組_範例.xlsx` (question groups + single questions)
Known structure of both (verify it yourself with openpyxl): one sheet `學習單`; title in B2 (merged B2:H2); header row 4 with B4 `題號`, C4:F4 `題目`, G4:H4 `作答`; question numbers are numeric in column B; a single question's answer blank is the merged G:H cell on its row (empty); a question GROUP has its 題號 cell merged vertically over its sub-question rows (e.g. B5:B6) and each sub-row has its own answer cell in G pre-filled with a prefix `（1）`, `（2）`; blank spacer rows between questions.

## Deliverables (write ONLY under `<repo>/fixtures/guided-notes/`)
1. `01-official-single.xlsx` and `02-official-group.xlsx`: byte-for-byte copies of the two TA samples (use `cp`).
2. `03-shifted-layout.xlsx`: same visual style as the samples (copy fonts, borders, merges pattern, column widths where practical) but a different layout: an extra instruction row/column so the header row is NOT row 4 and 題號 is NOT column B; a different title; 8 questions with different, original short-answer question text (general computer-science knowledge in Traditional Chinese); a different number of spacer rows.
3. `04-mixed-groups.xlsx`: different question count from the official group sample: at least 7 question numbers of which 3 are groups, one group having THREE sub-questions (prefixes `（1）`,`（2）`,`（3）`), groups and singles interleaved, and the answer column merged over a different width than the samples.
4. `05-two-sheets.xlsx`: the Guided Notes sheet is the SECOND sheet (first sheet is an unrelated `說明` sheet with a few lines of text).
5. Invalid files for error handling: `90-invalid-no-header.xlsx` (no 題號/題目/作答 header row), `91-invalid-duplicate-number.xlsx` (question number 3 appears twice), `92-invalid-empty.xlsx` (header row but zero questions).
6. `expected.json`: for every fixture, the expected parse result: `{"file": ..., "valid": true/false, "sheet": ..., "header_row": n, "questions": [{"number": 1, "blanks": [{"cell": "G5", "prefix": ""}]}, {"number": 2, "blanks": [{"cell":"G8","prefix":"（1）"}, ...]}], "question_count": n, "blank_count": n}`; for invalid files give `"valid": false` and `"error": "<short reason>"`. For a merged answer cell, `cell` is the top-left cell of the merge.
7. `README.md` (zh-TW): one table describing each fixture and what parser behaviour it tests; state that 01/02 are the TA's official samples.
8. `<repo>/fixtures/guided-notes/_build/make_fixtures.py`: the openpyxl script that generates 03–05 and 90–92, and `_build/verify_fixtures.py`: an INDEPENDENT structural parser (find the header row by searching for the three header labels, respect merged ranges, no hard-coded coordinates) that parses every fixture and compares to `expected.json`, printing PASS/FAIL per file and exiting non-zero on any FAIL.

## Acceptance criteria (mechanical)
- `cmp` shows 01/02 identical to the TA samples.
- `python3 -I fixtures/guided-notes/_build/verify_fixtures.py` run from `<repo>` prints PASS for all 8 files and exits 0 (invalid files PASS when the parser rejects them with the expected kind of error).
- `expected.json` for 01 has 6 questions / 6 blanks and for 02 has 4 questions / 6 blanks.
- No answers are filled in any fixture; all questions are short-answer.
- Python: use system `python3` with openpyxl (already installed, version 3.0.10). No new packages.

## Non-goals / limits
- Do not write application code, do not touch any file outside `fixtures/guided-notes/`, do not modify the files in `docs/`, no git commands, no network needed.
- Stop and report if openpyxl cannot reproduce something rather than faking it.

## Final message format (short)
結果 TLDR: <one sentence>
做了什麼: <file list, one line each>
證據: <the verify command and its real output>
風險與未完成: <bullets or 無 + reason>

## 助理

我先建立獨立驗證器與預期結果，確認缺檔時會失敗，再產生所有試算表。
