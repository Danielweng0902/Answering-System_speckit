# W3 pstack + AI-DLC + PlantUML

- session id：`ses_e3be5f638ffe7gTCl2qOG9J5Cx`
- 日期：2026-11-10
- 模型：nchc/Kimi-K3-max
- 輪次：8

> 本檔由 `scripts/export-ai-logs.mjs` 匯出：只保留對話本身，
> 工具呼叫與推理內容未收錄，機敏值已換成佔位符。

---

## 使用者

Act as the research sub-agent for this task.

You are a research worker. Do the work yourself; do not spawn or delegate to other agents.

## ① Goal & Why
A 2-person student subgroup builds a course final project (a classroom "buzz-in answering" web system) with GitHub Spec Kit as the mandatory process. Three supporting topics need verified facts. Today is 2026-11-10; the machine is macOS (Apple Silicon), Java 21 is installed, Graphviz `dot` is NOT installed, PlantUML is NOT installed.

### Topic A: pstack
https://github.com/cursor/plugins/tree/main/pstack — what is it? List its contents (skills, commands, rules, agents, hooks, MCP servers) with one-line purposes, its intended workflow, license, and whether its parts can be used outside Cursor (e.g. copied as plain SKILL.md skills into Claude Code or Codex). Say which parts would duplicate or conflict with Spec Kit's own spec/plan/tasks flow, and which parts are complementary (e.g. review, QA, release).

### Topic B: AI-DLC
The course references "AIDLC" slides (AI-Driven Development Life Cycle) and a "Diagram First Development" rule. Summarize the public AWS AI-DLC methodology: phases (e.g. Inception / Construction / Operations), rituals (e.g. Mob Elaboration / Mob Construction), artifacts, and the awslabs "aidlc-workflows" repo if it exists (what it contains, how it is used with coding agents). Keep it to about one page, with links.

### Topic C: PlantUML toolchain on macOS
The course requires: during the specify phase, generate PlantUML component, class and sequence diagrams as `.puml` files in `./diagrams/`, then run `java -jar plantuml.jar "./diagrams/*.puml"` to render PNGs into the same directory. Find out:
1. The official download location of plantuml.jar (GitHub releases of plantuml/plantuml), the current version, and the license variants (GPL / MIT / LGPL ... jars).
2. Whether class and component diagrams need Graphviz `dot`, and how to avoid that with the built-in Smetana layout (`!pragma layout smetana` inside the file, and/or a command-line option). Give the exact working syntax.
3. Hands-on proof: in a temp dir created with `mktemp -d /tmp/plantuml-try.XXXX` (NEVER inside /Users/Pig0902/Answering-System_speckit), download the jar, write a tiny class diagram, component diagram and sequence diagram (include a few Chinese labels such as 老師 / 學生 / 組別 to check CJK font rendering), render them with Java 21, confirm the PNG files exist (`ls -la`), and note any font or layout problems. Also record the exact commands that worked and the time they took.
4. Recommend how a team on mixed Mac/Windows should pin the PlantUML version (e.g. a script `scripts/render-diagrams.sh` that downloads a pinned jar into a git-ignored `tools/` folder), and whether to commit the jar or not.

## ② Acceptance criteria
- Report file `/Users/Pig0902/Answering-System_speckit/_research/W3-pstack-aidlc-plantuml.md` exists, written in Traditional Chinese (zh-TW) with English technical terms, with sections A, B, C.
- Every factual claim cites its source (URL, or `local: <command>`); unverified items are marked `UNVERIFIED`. Section C.3 includes the real commands and real `ls -la` output.
- You may copy the rendered test PNGs to `/Users/Pig0902/Answering-System_speckit/_research/plantuml-test/` so they can be inspected.

## ③ Report format (your final message, keep it short)
結果 TLDR: <one sentence>
報告路徑: <path>
五個最重要發現: <5 bullets>
未驗證/風險: <bullets, or 無 + reason>

## ④–⑦ Scope and limits
- Write ONLY the report file, the optional `_research/plantuml-test/` folder, and temp dirs under /tmp.
- Do NOT install anything globally (no brew, no global npm), do not modify any config in ~/, do not create repos/commits/issues/PRs.
- If a download fails twice, stop that sub-task and report the exact error.

## 助理

我會先查證三個主題的官方來源，接著在 `/tmp` 實測 PlantUML，最後把含指令、輸出與來源的繁中報告寫入指定路徑。

## 助理

已確認主題 A/B/C 官方來源與環境：Java 21、`dot` 不存在，PlantUML 官方目前穩定版為 `v1.2026.9`。接著我會萃取 pstack 完整清單並實測三種圖。

## 助理

實測會分兩輪驗證：檔內 `!pragma layout smetana` 與 CLI `-Playout=smetana`；共通語境為未安裝 `dot` 的 Java 21。

## 助理

三張圖已成功輸出，含中文的 class/component/sequence 都在無 `dot` 環境完成。現在我會整理證據快照、移植限制與 Spec Kit 分工建議。

## 助理

我會直接讀取剛產生的 PNG，確認中文標籤是否可辨識；讀取完成後寫入最後報告。

## 助理

我將把已驗證的事實、實測輸出、未驗證項與跨平台腳本建議寫成單一繁中報告。

## 助理

結果 TLDR: 三個主題均已完成查證；PlantUML 以 Java 21 成功實測，三張含中文標籤的 UML PNG 均在未安裝 Graphviz 的環境產生。

報告路徑: [\`W3-pstack-aidlc-plantuml.md\`](/Users/Pig0902/Answering-System_speckit/_research/W3-pstack-aidlc-plantuml.md)

五個最重要發現:
- **pstack**：MIT plugin，含 58 skills、23 playbooks、2 agents，沒有獨立 commands/rules/hooks/MCP server；Claude Code 有官方 adapter，但 Codex 不能假設可直接使用。
- **Spec Kit 分工**：pstack 的 poteto-mode/architect/playbooks 與 plan/tasks 路由重疊；建議只取 TDD、evidence-based review、驗證及技術寫作作為輔助。
- **AI-DLC**：原始方法論為 Inception／Construction／Operations 與 Mob 工作模式；現行 `awslabs/aidlc-workflows` 已擴成 5 phases／33 stages，並提供多種 coding-agent harnesses。
- **PlantUML**：最新 stable 為 `v1.2026.9`；檔內 `!pragma layout smetana` 與 CLI `-Playout=smetana` 都已實測成功，class/component 不需 `dot`。
- **實測與 pinning**：下載 1.63 秒，三圖 render 2.88 秒，中文沒有缺字；建議固定版本及 SHA-256、jar 放 git-ignored `tools/`，不要 commit jar。PNG/PUML 已保存至 [\`plantuml-test/\`](/Users/Pig0902/Answering-System_speckit/_research/plantuml-test/)。

未驗證/風險:
- Windows、PowerShell script 與 Windows CJK 字型呈現未實機測試。
- pstack 複製到 Codex 的實際執行相容性未測試。
- AWS 官方資料未找到「Diagram First Development」正式規則，項目中應視為課程規定而非 AWS 已驗證規範。
