# W5 draw.io MCP research

- session id：`ses_e3bc70489ffe78NzymhTTOtxpR`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：10

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the research sub-agent for this task.

You are a research worker. Do the work yourself; do not spawn or delegate to other agents.

## Goal & Why
A student team builds a course project with GitHub Spec Kit. The course REQUIRES PlantUML: component, class and sequence diagrams as `.puml` files in `./diagrams/`, rendered to PNG by the PlantUML CLI (this is graded and cannot be dropped). The user additionally wants diagrams they can open and edit by hand in draw.io (diagrams.net), and asked whether a draw.io MCP server (or similar) exists so an AI coding agent (Claude Code, OpenCode) can create and edit draw.io diagrams. Machine: macOS Apple Silicon, Node 26, Java 21, no draw.io desktop app installed. Today is 2026-11-10.

## Tasks
1. Find draw.io MCP servers and agent skills. Check at least: `jgraph/drawio-mcp` (official?), `lgazo/drawio-mcp-server`, any others with real usage, and any draw.io agent skill (e.g. a "drawio-skill"). For each: repo URL, stars, last push date, license, what it does (tools exposed: create/open diagram, edit cells, export, PlantUML/Mermaid/CSV import?), whether it needs the draw.io desktop app, a browser extension, or works headless, and the exact install/config for Claude Code (`claude mcp add ...` or `.mcp.json`) and OpenCode (`opencode.json` mcp section). Verify with `gh api repos/<owner>/<repo>` and by reading the README; mark anything unverified as UNVERIFIED.
2. PlantUML ↔ draw.io: can draw.io currently import PlantUML as EDITABLE shapes (not an embedded image)? What is the status of draw.io's PlantUML support in 2026 (it was announced as being phased out)? Are there working converters from `.puml` to editable `.drawio` (and the reverse)? Give links and state clearly what works today.
3. `.drawio` file workflow in git: `.drawio` (XML), `.drawio.svg` and `.drawio.png` (editable images with embedded diagram), the VS Code extension `hediet.vscode-drawio`, and headless export to PNG (draw.io desktop CLI `drawio -x -f png`, docker images, or other tools). What is the lightest way on macOS and in GitHub Actions?
4. Recommendation: given PlantUML stays the graded source for the three required diagram types, propose 2 options for adding draw.io (for example: draw.io for an extra hand-editable architecture/UI-flow/state diagram; or keeping a `.drawio` twin of each PlantUML diagram) with the cost and the drift risk of each, and say which you would pick for a 2-person team with 19 days.

## Acceptance criteria
- Report at `/Users/Pig0902/Answering-System_speckit/_research/W5-drawio.md`, written in Traditional Chinese (zh-TW) with English technical terms, sections 1–4, every factual claim citing a URL or `local: <command>`.
- Do not invent repo names, tool names or flags.

## Final message format (short)
結果 TLDR: <one sentence>
報告路徑: <path>
五個最重要發現: <5 bullets>
未驗證/風險: <bullets>

## Limits
- Write ONLY that report file (plus temp dirs under /tmp made with mktemp). Do not install anything globally, do not modify any config in ~/, do not add MCP servers to any config, do not touch other files in /Users/Pig0902/Answering-System_speckit, no repos/commits/PRs.

## 助理

I'll start by verifying the GitHub repos and gathering information about draw.io MCP servers.

## 助理

Continuing the research. Let me fetch the READMEs and more details on both repos.

## 助理

Now I'll fetch the tool-server README and check for the drawio skill and other MCP servers.

## 助理

I have official MCP data. Now let me verify the drawio skill, other repos, and the PlantUML status in draw.io.

## 助理

Continuing the research with PlantUML status and the remaining repos.

## 助理

Official docs page still documents PlantUML insertion. Kimi needs to check the "phased out" announcement status, the desktop CLI docs, and converters.

## 助理

The new AGENTS.md rules are noted (they're project context, compatible with my task). Continuing research — Kimi found drawio-desktop #219 says client-side PlantUML parser was **added** in 30.3.6 (2026-07-09). Kimi will now verify the desktop CLI docs, drawio-export action, and the blog status.

## 助理

Verified drawio-export. Now checking the GitHub Action, the PlantUML-export plugin discussion, lgazo's tool list, and next-ai MCP.

## 助理

Almost done verifying. Response batches before writing the report:
