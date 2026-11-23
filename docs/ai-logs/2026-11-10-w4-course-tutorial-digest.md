# W4 Course tutorial digest

- session id：`ses_e3be5bb5fffeIgRkjfpRqilubf`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：3

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the research sub-agent for this task.

You are a research worker. Do the work yourself; do not spawn or delegate to other agents.

## ① Goal & Why
A 4-person student team is split into two subgroups for a software-engineering final project ("Vibe Coding 課堂搶答系統", a classroom buzz-in answering system): the SpecKit subgroup (us) and the OpenSpec subgroup. The course rule says both subgroups' systems must have IDENTICAL functionality, and any change during implementation must be discussed with the other subgroup. The TAs grade OpenSpec artifacts (proposal, spec, design, tasks) and SpecKit artifacts (constitution, spec, plan, tasks, diagrams). We need a precise digest of the course's tutorial material so we can (a) follow the course's expected workflow exactly and (b) design a coordination protocol between the two subgroups.

## Inputs (all local, read-only)
- Extracted text (thin, because the slides are mostly screenshots): `<repo>/_research/raw/OpenSpec_簡易小投票器_一次完成_完整教學.txt`, `<repo>/_research/raw/OpenSpec開發簡易流程圖.txt`, `<repo>/_research/raw/SpecKit 教學.txt`
- Page images (read them with your image-capable read tool; they hold the real content): `<repo>/_research/raw/png/OpenSpec_簡易小投票器_一次完成_完整教學/p01.png` … `p33.png`, `<repo>/_research/raw/png/OpenSpec開發簡易流程圖/p01.png`, `<repo>/_research/raw/png/SpecKit 教學/p01.png` … `p22.png`

## Tasks
1. OpenSpec tutorial (33 pages): step-by-step digest of the workflow: install, `openspec init` options, config profile/update, explore → propose → apply → verify → sync → archive, and "固化規則" (openspec/config.yaml). For each step give: the exact command or prompt shown, what the AI produces (file paths such as openspec/changes/<name>/proposal.md, design.md, tasks.md, specs/...), and any tip or warning on the slide. Note the example prompts used for the lunch-voting app.
2. OpenSpec flowchart (1 page): transcribe it as an ordered list including the loop-back rules (when to return to Explore, when to open a new Change after archive).
3. SpecKit tutorial: transcribe the content that exists only in images, especially page 2 (the "AI-DLC Work Flow" diagram), page 8 (the list of installed skills), pages 9–10 (Codex Desktop setup), page 11 (the workflow diagram with steps 1–8), page 18 (implement tips) and page 21 (final-project tips). Quote prompts exactly.
4. Alignment analysis: build a table mapping OpenSpec artifacts ↔ SpecKit artifacts (proposal ↔ ?, spec ↔ spec, design ↔ plan/diagrams, tasks ↔ tasks, verify ↔ analyze/converge, archive ↔ ?). Then list concrete "alignment points" the two subgroups must agree on BEFORE writing specs so that both systems end up functionally identical (for example: shared feature list and scope of optional features, user roles and login method, activity phases/state machine, the buzz-in winner rule, Guided Notes import/export behaviour, CSV columns, UI flow for the demo video). Mark which items come directly from the slides and which are your own suggestions.

## ② Acceptance criteria
- Report file `<repo>/_research/W4-course-tutorials.md` exists, written in Traditional Chinese (zh-TW) with English technical terms, sections 1–4.
- Every item from the slides cites its page (e.g. `[OpenSpec p12]`, `[SpecKit p11]`). Anything unreadable is marked `UNREADABLE` instead of guessed.

## ③ Report format (your final message, keep it short)
結果 TLDR: <one sentence>
報告路徑: <path>
五個最重要發現: <5 bullets>
未驗證/風險: <bullets, or 無 + reason>

## ④–⑦ Scope and limits
- Read-only except for writing that one report file. Do not modify the PDFs, the extracted files or anything else; no repos/commits; no network access is needed.

## 助理

我會先交叉核對擷取文字與全部頁面圖，再將完整的逐頁摘要、雙邊 artifact 對照與事前協調清單寫入指定報告。所有投影片內容會標註頁碼，無法辨識處會明確記為 `UNREADABLE`。

## 助理

結果 TLDR: 已完成 56 頁課程教材研究，並整理出 OpenSpec／SpecKit workflow、artifact 對照與兩組事前協調協定。

報告路徑: `<repo>/_research/W4-course-tutorials.md`

五個最重要發現:
- OpenSpec 主線是 install → init → explore → propose → apply → verify → sync → archive → 固化規則；`Sync` 與 `Archive` 是不同動作，不能混同。
- OpenSpec 未 archive 時可回 Explore 並把新需求合併原 Propose；已 archive 後必須開新 Change。
- SpecKit p2 的 AI-DLC 只有六階段，但實際課程 workflow 是八步，另加入 `analyze` 與 `converge` 兩個回圈。
- 只有 spec、tasks、apply／implement 有較直接對應；proposal、verify、sync、archive 都不能硬配成單一 SpecKit artifact。
- 兩份午餐示例的功能與 tech stack 其實不同，期末專案必須先凍結共同 Feature Contract、acceptance matrix 與 demo flow。

未驗證/風險:
- `[OpenSpec p32]` 的完整 YAML 細字無法可靠辨識，已標為 `UNREADABLE`。
- `[SpecKit p14]` 右上 AI 選項截圖細節過小，未猜寫，已標為 `UNREADABLE`。
- SpecKit diagrams 沒有投影片中的固定產生指令或路徑；報告中相關對照與協調方式已明確標為 `[本研究建議]`。
