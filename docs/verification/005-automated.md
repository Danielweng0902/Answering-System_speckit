# 005 公平順位與投影看板：自動驗證紀錄（T029／T031）

日期：2026-11-17。以下指令均在 repository root 實際執行；沒有把「應該可跑」當作已驗證。

## 指令與輸出摘要

| 指令 | 結果 | 實際輸出摘要 |
|---|---|---|
| `npm test` | PASS | shared：`No test files found`（`--passWithNoTests`）；server：**44 files、367 tests 全過**；web：**17 files、90 tests 全過** |
| `npm run test:e2e` | PASS | Playwright `Running 17 tests using 1 worker` → **15 passed、2 skipped**；skipped 為既有需 `SCREENSHOTS=1` 的 002／003 截圖測試。005 新增的 `005-fairness.spec.ts` 通過 |
| `npm run check` | PASS | shared／server／web／e2e typecheck、ESLint（`--max-warnings=0`）、`scripts/check-diagrams.sh`（4 張 005 圖已重出 PNG）全過；最後輸出 `PASS 圖表檢查通過` |
| `npm audit` | **找到已知 moderate threat；exit 1** | 與 004 相同：`@typescript-eslint/*` 開發期相依鏈的 **7 moderate severity vulnerabilities**。未執行會降版且帶 breaking change 的 `npm audit fix --force`；005 沒有改動任何相依版本 |

## Success Criteria 對照

| 驗收 | 負責的自動測試 | 結果／限制 |
|---|---|---|
| SC-001：6 組 × 6 題同速作答時，成功題數最多與最少相差不超過 1 | `server/tests/unit/answerSettlement.test.ts`「6 組 × 6 題同速作答」 | PASS；實測各組各 1 題，差 0 |
| SC-002：未啟用時 100% 等同先到先得 | `answerSettlement.test.ts`「未啟用時順位與搶答成功組別完全等同先到先得」；`server/tests/integration/fairnessCommands.test.ts`「啟用時…未啟用時先到先得」 | PASS；既有 003 的 `answerResults`／`answerVisibility` 測試亦全數未變（003 語意未被改動） |
| SC-003：同一份送達紀錄重算 100 次結果相同 | `answerSettlement.test.ts`「同一輸入重算 100 次結果完全相同」 | PASS |
| SC-004：搶答中投影看板的作答資訊為 0 項 | `server/tests/integration/projector.test.ts`「搶答中的投影快照完全不含答案、送出狀態與送出數量」**直接斷言封包內容**（`"answers"`／`"rank"`／`"cells"` 都不存在）；`e2e/tests/005-fairness.spec.ts` 同時檢查畫面 | PASS；作答資料在伺服器端就沒有送出 |
| SC-005：投影看板字體適合後排辨識 | 自動測試不涵蓋 | **待人工驗證**（T037），證據為 `docs/verification/005-screenshots/projector-revealed.png` |
| SC-006：老師能用一句話說明規則 | 自動測試不涵蓋 | **待人工驗證**（T037）；介面上的說明文字為「同一題 3 秒內送出的組別視為同批，批內依『已搶答成功題數』由少到多決定順位」 |

## 各功能點的測試對照

| 功能 | 測試 |
|---|---|
| 公平順位判定純函式（批次、成功題數、邊界、作廢連鎖重算、決定性） | `server/tests/unit/answerSettlement.test.ts`（12 案例） |
| 判定入口與投影層（結果、看板、學生順位） | `server/tests/integration/fairnessCommands.test.ts`（9 案例） |
| 公平順位開關指令（權限、階段、冪等、廣播） | `server/tests/integration/fairnessCommands.test.ts` |
| 投影快照、揭曉指令、重設清空 | `server/tests/integration/projector.test.ts`（5 案例） |
| CSV 第 8 欄「公平順位」與公平順位 | `server/tests/unit/csvBuilder.test.ts`、既有 `exportCommands.test.ts`／`exportRoutes.test.ts` |
| 老師端開關與投影按鈕、投影頁呈現 | `web/tests/teacher/FairnessSetting.test.tsx`、`web/tests/projector/ProjectorPage.test.tsx` |
| 端對端（開關 → 作答 → 投影不外洩 → 逐題揭曉） | `e2e/tests/005-fairness.spec.ts` |

## 沒有涵蓋到的部分

- **T034 另一位組員審查**：尚未進行。
- **T037 人工驗證（19 個步驟）**：尚未進行；SC-005、SC-006 只能由人工驗證判定。
- **T033 的 GLM 安全覆核**：本次工作階段沒有可用的 GLM worker，改由主控自我覆核（見 `005-security-review.md`），仍建議在 PR 上由另一位組員覆核。
