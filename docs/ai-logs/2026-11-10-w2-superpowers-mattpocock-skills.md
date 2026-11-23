# W2 Superpowers + mattpocock skills

- session id：`ses_e3be62facffev3gBVMGmnC7mxu`
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
A 2-person student subgroup will build a course final project (a classroom "buzz-in answering" web system) with GitHub Spec Kit as the MANDATORY process: graders check Spec Kit artifacts (constitution.md, spec.md, plan.md, tasks.md, PlantUML diagrams) and that code, documents and the demo video are consistent with each other. The flow is constitution → specify → clarify → plan → tasks → analyze → implement → converge. The team wants to add agent skills on top: obra/superpowers, mattpocock/skills, and "grill-with-docs" or "/grill-me". The main risk is that some skills run their own pipeline and write their own spec/plan files, creating a SECOND source of truth next to Spec Kit's. We need verified facts to decide which skills to use, in which phase, and which to avoid. Today is 2026-11-10.

## Tasks
1. obra/superpowers (https://github.com/obra/superpowers): latest version/release; list EVERY skill with a one-line purpose. Classify each as (a) pipeline/process skills that create their own design/plan artifacts or drive the whole workflow (e.g. brainstorming, writing-plans, executing-plans, subagent-driven-development) — state exactly which files/directories they write (e.g. docs/plans/..., docs/superpowers/specs/...) — or (b) discipline skills that can run inside any workflow (e.g. test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents). Give install methods for Claude Code, Codex, Cursor and OpenCode. A local copy exists under ~/.agents/skills/ (folders: brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, using-superpowers, dispatching-parallel-agents, writing-skills). Read their SKILL.md frontmatter and note if the local copy looks older than upstream.
2. mattpocock/skills (https://github.com/mattpocock/skills): list EVERY skill with a one-line purpose. In particular verify whether `grill-me` and `grill-with-docs` exist, their exact names, and what they do: what "docs" does grill-with-docs read or write (e.g. CONTEXT.md, ADRs, a glossary/ubiquitous language)? Also check skills such as write-a-prd / to-prd, prd-to-issues / to-issues, prd-to-plan, tdd, triage, improve-codebase-architecture, ubiquitous-language, design-an-interface, request-refactor-plan (whatever really exists). Give the install method (e.g. `npx skills add ...`) and compatibility with Claude Code / Codex / Cursor / OpenCode.
3. Look for existing community guidance or repos that combine GitHub Spec Kit with superpowers (e.g. a Spec Kit extension or bridge that calls superpowers TDD/review skills) and with grill-me style interviewing. Give links, and say whether each is maintained.
4. Build a compatibility matrix (markdown table): skill | best Spec Kit phase (constitution / specify / clarify / plan / tasks / analyze / implement / converge / code review & PR) | conflict risk (does it create parallel spec/plan artifacts or take over the flow? low/med/high) | recommendation (use / use with care / avoid) | one-line reason.

## ② Acceptance criteria
- Report file `/Users/Pig0902/Answering-System_speckit/_research/W2-skills.md` exists, written in Traditional Chinese (zh-TW) with English technical terms, with sections 1–4.
- Every factual claim cites its source (URL, or `local: <path>`); unverifiable items are marked `UNVERIFIED`. Never invent skill names — if a name the user mentioned does not exist, say so and give the closest real one.

## ③ Report format (your final message, keep it short)
結果 TLDR: <one sentence>
報告路徑: <path>
五個最重要發現: <5 bullets>
未驗證/風險: <bullets, or 無 + reason>

## ④–⑦ Scope and limits
- Read-only research. Write ONLY `/Users/Pig0902/Answering-System_speckit/_research/W2-skills.md`.
- Do not install any skill or plugin, do not modify ~/.agents, ~/.claude, ~/.codex or any config, do not create repos/commits/issues/PRs.
- Useful fetch methods: `gh api repos/<owner>/<repo>/contents/<path>`, `gh release list -R <owner>/<repo>`, `curl -sL https://raw.githubusercontent.com/<owner>/<repo>/main/<path>`, or your web fetch tool.

## 助理

All facts gathered. Now writing the report.

## 助理

結果 TLDR: superpowers 的 pipeline 類 skill（brainstorming、writing-plans、using-superpowers）會在 `docs/superpowers/specs|plans/` 自建第二真相來源，只該用它的 6 個 discipline skill；mattpocock 的 `grill-me`、grill-with-docs 確實存在且適合 clarify/specify 階段，但 PRD 系名字（write-a-prd、prd-to-issues 等）全部不存在。

報告路徑： /Users/Pig0902/Answering-System_speckit/_research/W2-skills.md

五個最重要發現：
- **superpowers 最新 v7.0.2（2026-11-03），15 個 skill**；本機 `~/.agents/skills/` 快照缺 `diagnosing-superpowers`、executing-plans/TDD/writing-plans 內文對不上 v6.3.0，判定為約 v6.0.x 時代的手動複製版，明顯過時須先更新。
- **第二真相來源製造者只有三個**：`brainstorming`（寫 `docs/superpowers/specs/*-design.md` 並 commit）、`writing-plans`（寫 `docs/superpowers/plans/`）、`using-superpowers`（bootstrap 強制優先觸發、接管整個流程）——矩陣中全標 High／避免。
- **grill-me、grill-with-docs 都存在**：grill-me 只呼叫底層 `grilling`（純訪談、不寫檔，衝突 Low）；grill-with-docs = grilling＋domain-modeling，會寫 **`GLOSSARY.md`（舊名 CONTEXT.md）＋ `docs/adr/NNNN-*.md`**，屬 Medium 衝突、須納入評審文件體系才用。使用者提的 `write-a-prd` / `to-prd` / `prd-to-issues` / `to-issues` / `prd-to-plan` / `ubiquitous-language` / `design-an-interface` / `request-refactor-plan` **皆不存在**，最接近的分別是 `to-spec`、`to-tickets`、`wayfinder`、`domain-modeling`、`codebase-design`、`improve-codebase-architecture`（其中 to-spec/to-tickets 因發 spec/ticket 到 issue tracker 反而標 High／避免）。
- **mattpocock 明確把 Spec Kit 當反面教材**（README: "Spec-Kit try to help by owning the process…take away your control"），其 skill 小而可組合；OpenCode 有一等官方支援：`npx skills@latest add mattpocock/skills -a opencode`。
- **社群已有現成橋接**：lihan3238/speckit-superpowers-bridge（⭐54，"Spec Kit writes WHAT. Superpowers enforces HOW"，把 brainstorming 限縮在 pre-spec window、tasks.md 經 adapter 餵 executing-plans）是最成熟解；dchuk/speckit-craft 提供 grill 指令移植但僅兩天提交即停更；Spec Kit 本體已到 v1.3.3 且有官方 extension 機制。

未驗證/風險：
- lihan3238 橋接器官方驗證止於 Spec Kit 1.0.12＋superpowers 6.4.2，對最新 1.3.3／7.0.2 相容性 UNVERIFIED，且其最後 push 為 2026-09-28（半活躍）。
- 本機 superpowers 快照精確版本號 UNVERIFIED（手動複製＋有修改，無單一 tag 可對應）。
- 子細節：`chmltn/spec-kit-grill` 未查證、mattpocock in-progress 區 8 個 skill 是官方自述 beta 可隨時消失。
