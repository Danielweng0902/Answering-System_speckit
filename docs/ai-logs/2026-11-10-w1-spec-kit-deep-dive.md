# W1 Spec Kit deep-dive

- session id：`ses_e3be669c7ffeGRK6KwnQX0Xkux`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：7

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the research sub-agent for this task.

You are a research worker. Do the work yourself; do not spawn or delegate to other agents.

## ① Goal & Why
A 2-person student subgroup will build a course final project (a classroom "buzz-in answering" web system) using GitHub Spec Kit (`specify-cli`). The course tutorial (written for Windows + Codex) uses:
`specify init --here --integration codex --script ps --ignore-agent-tools` (Claude Code users swap in `claude`, Mac users use `--script sh`), and the flow
constitution → specify → clarify → plan → tasks → analyze → implement → converge (converge = check code vs spec/plan/tasks and append missing work to tasks.md).
The tutorial also says the project can be split into several sub-features, each with its own spec/plan/tasks, and warns "make sure `.specify/feature.json` points at the sub-feature you are developing".
The graders check these Spec Kit artifacts: constitution, spec, plan, tasks, and diagrams (PlantUML). We will most likely use Claude Code on macOS (maybe also Codex or OpenCode). We need VERIFIED, current facts about Spec Kit to design our team workflow. Today is 2026-11-10.

## Tasks
1. Version: installed CLI is `specify` 1.2.1 at ~/.local/bin/specify (run `specify version`). Find the latest released version on GitHub (github/spec-kit releases: `gh release list -R github/spec-kit -L 15` or https://github.com/github/spec-kit/releases). Summarize notable changes since 1.0 (especially: converge, feature.json, extensions/presets/hooks, skills mode, anything about multiple features or teams).
2. Commands & integrations: from the official docs (start at https://github.github.com/spec-kit/quickstart.html and https://github.github.com/spec-kit/reference/integrations.html, follow links within https://github.github.com/spec-kit/ ) and the repo README: list EVERY command with a one-line purpose (constitution, specify, clarify, plan, tasks, analyze, checklist, implement, converge, taskstoissues, or whatever exists now). List supported `--integration` values and how commands are invoked in each (e.g. `/speckit.plan` slash command in Claude Code vs `$speckit-plan` skill in Codex). List `specify init` options (`specify init --help`).
3. Multi-feature mechanics: how a new feature directory/branch is created (e.g. specs/NNN-name/ and git branch), what `.specify/feature.json` contains and how it is updated/switched, how two people can develop two features in parallel on separate git branches, and which files are likely merge-conflict hotspots.
4. Extension points: constitution, `.specify/templates/*`, any extension / preset / hook system (e.g. `specify extension ...`), and how one would enforce a custom rule such as "during the specify phase, generate PlantUML component/class/sequence diagrams into ./diagrams/ and render them to PNG". Mention any community extensions relevant to UML/diagrams, verification, or bridging to obra/superpowers skills, with links.
5. Hands-on check: create fresh temp dirs with `mktemp -d /tmp/speckit-try.XXXX` (NEVER inside <repo>). In one: `git init` then `specify init --here --integration claude --script sh` (add `--ignore-agent-tools` and answer prompts non-interactively, e.g. `yes | ...` or a `--force` flag if it exists). Record the generated file tree (`find . -maxdepth 4 -not -path './.git/*' | sort`) and the list of generated commands/skills. Repeat with `--integration codex` and `--integration opencode` in separate temp dirs if supported. Record exact error output if something fails.

## ② Acceptance criteria
- Report file `<repo>/_research/W1-speckit.md` exists, written in Traditional Chinese (zh-TW) with English technical terms, with sections 1–5 above.
- Every factual claim is tagged with its source: a URL, or `local: <command>`. Anything you could not verify is marked `UNVERIFIED`. Do not invent command names or flags.
- Section 5 contains the real file trees from the commands you ran (trim to the relevant parts if very long).

## ③ Report format (your final message, keep it short)
結果 TLDR: <one sentence>
報告路徑: <path>
五個最重要發現: <5 bullets>
未驗證/風險: <bullets, or 無 + reason>

## ④ Scope / ⑤ Non-goals / ⑥ Allowed paths / ⑦ Stop conditions
- Write ONLY `<repo>/_research/W1-speckit.md` plus temp dirs under /tmp.
- Do NOT modify anything else in <repo>; do not touch ~/.claude, ~/.codex, ~/.config or any global config; do not run `uv tool upgrade`/install; do not create GitHub repos, commits, issues or PRs.
- If a command needs credentials or would change global state, skip it and note that in the report.

## 助理

I'll start by verifying the local CLI and checking upstream releases in parallel.

## 助理

The tool catalog note doesn't change my approach — I'll continue with shell + fetch tools. Local CLI is 1.2.1; latest upstream is v1.3.3 (2026-11-09). Now let me dig into integrations, new subcommands, and release notes.

## 助理

Now let me run the three hands-on inits in /tmp and fetch the key reference pages in parallel.

## 助理

Two key behaviors verified: no git branch is auto-created in core, and feature numbering scans `specs/` (merge-collision risk confirmed in script logic). Let me test the bundled `git` extension install in the temp Claude project, and fetch the extension docs.

## 助理

All verification complete. One final local check (PlantUML availability for the custom-rule design), then I'll write the report.

## 助理

結果 TLDR: Spec Kit 已完成核心驗證——本機 1.2.1 實測三種 integration 的 init／feature 建立／git extension 安裝全部成功，課程講義的 `feature.json` 提醒完全正確（它是 per-checkout 指標、已被 gitignore、branch 生成交給 opt-in `git` extension），但 **1.3.0 起 `taskstoissues` 已移出 core**、最新版已 1.3.3，PlantUML 強制產圖需自訂 preset/extension hook 且本機無 plantuml 需另行安裝。

報告路徑: `<repo>/_research/W1-speckit.md`

五個最重要發現:
- **版本差異**：本機 1.2.1，最新 v1.3.3（2026-11-09）；1.3.0 起 core 移除 `/speckit.taskstoissues`，改用 bundled `github` extension，但 1.2.1 init 三種 agent 都仍產生該指令。【releases + local 檔案樹】
- **Feature 解析不靠 git branch**：`SPECIFY_FEATURE_DIRECTORY` → `.specify/feature.json`（實測內容 `{"feature_directory":"specs/001-buzz-answer-flow"}`）→ 報錯；feature.json 被 `.specify/.gitignore` 忽略；core 腳本不建分支，`specify extension add git` 後 `before_specify → speckit.git.feature` mandatory hook 才建。【local: common.sh + 實測】
- **雙人平行最大地雷是 NNN 編號碰撞**：編號＝本 checkout `specs/` 最大號 +1，兩條 branch 極易拿到同號；需先分配號碼或用 `--number N`/timestamp。混合 agent 團隊官方建議 `--integration none` 基底、commit 前切回。【script 源碼 + integrations/index.html】
- **三種課程 agent 呼叫形式不同**：Claude=`/speckit-*`（`.claude/skills/`，1.2.1 預設 skills）、Codex=`$speckit-*`（`.agents/skills/`）、opencode=`/speckit.*`（`.opencode/commands/`）；完整 9 個核心指令（含 converge 的 append-only 定義）與 43 個 `--integration` keys 已列表。【local init 輸出 + 官方 docs】
- **PlantUML 規則可行但需自製**：用 `.specify/templates/overrides/`/preset 改模板＋指令，或自製 extension 掛 `after_specify` mandatory hook（hooks/events/runtime events/workflow YAML 機制均驗證）；render 需 Java+plantuml（本機有 Java 21、無 plantuml）；社群有 Illustrate、Data Model Diagram 等圖表擴充及三個 obra/superpowers 橋接，但無 PlantUML 專用件。

未驗證/風險:
- 1.3.x 的 init 產物未實測（任務禁止升級 CLI），相關行為依 release note 推論。
- 只跑 CLI/shell，未啟動 agent 實際執行 `/speckit-*` 指令（已以生成的 SKILL.md／command 模板佐證行為）。
- PlantUML render 指令（plantuml.jar/`-png`）與 `brew install plantuml` 未實跑；Windows PowerShell 未驗證。
- 社群 catalog 均為第三方、discovery-only，使用前需自審碼。
