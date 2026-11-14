# 003 buzz-in 三模型獨立驗證與交叉覆核

> 日期：2026-11-14
> 範圍：`003-buzz-in` 分支，`ee6326e` 之後的未提交收尾修正（T059–T061），以及本輪新增 T062–T063。
> 主控：Kimi K3 Max。本文件只記錄驗證與裁決；T052 的 23 步人工驗證仍未執行，不能視為收斂完成。

## 參與模型與角色

| 模型（皆由 NCHC） | 使用重點 | 輸出類型 |
|---|---|---|
| `nchc/GLM-5.3-max` | 深度安全、可見範圍、事務與契約邊界 | 獨立盲審 → 交叉覆核 → 完成前審查 |
| `nchc/MiniMax-M3.1-Flash` | 快速、廣覆蓋的 FR/AC、UI 與文件走查 | 獨立盲審 → 交叉覆核 |
| `nchc/Muse-Spark-Open-816B-A42B` | 跨層架構、持久化與快照不變量 | 獨立盲審（工具受限）→ 交叉覆核 |

## 獨立盲審結果摘要

- **GLM**：確認 T060 的 ack、廣播例外、log 去敏及草稿修正核心路徑；指出「換組／token 只在前端受限」是 001 層共同規格問題，不應在 003 單方面修改；另指出 per-socket snapshot 拋例可能中止整個廣播迴圈（G5，原標推測）。
- **MiniMax**：確認 T059 草稿修復與 T061 測試 client 文件可執行；發現任一題送出中其他題按鈕仍可點（M2）、作廢錯誤跨快照／phase 殘留（M3）、確認 UI 在 cell 狀態往返後可能自行彈回（M4），並把看板前綴與已作廢結果呈現判定為文字解讀問題（M6）。
- **Muse**：讀取工具受限，明確標注未讀到若干檔案；提出的 winner、T060、草稿生命週期三項都只是「待驗證推測」，不能直接採納。

## 交叉覆核裁決

| 主張 | 裁決 | 處置 |
|---|---|---|
| G5：單一 socket 的 snapshot/emit 例外可能中止後續廣播 | **接受**（GLM 確認程式路徑，MiniMax 也確認） | 實作 T063，改為 per-socket try/catch |
| M2：送出中其他題可按但靜默 ignored | **接受**（GLM 確認，屬 UX 修正） | 實作 T062：任一題送出中停用全部送出按鈕 |
| M3：作廢錯誤跨 phase/cell 殘留 | **接受** | 實作 T062；GLM 完成前審查再指出 `submitted → voided → submitted` 後舊錯誤會重現，因此以 cell signature 綁定錯誤 |
| M4：cell 狀態往返後舊確認 UI 會自行彈回 | **接受** | 實作 T062；以 phase/state/answers/rank 組成 cell signature，只在簽名仍相符時顯示確認 |
| MiniMax 初期建議「submitted 後不顯示舊錯誤」 | **反駁** | Kimi 實作後由正式 E2E 反證：同組第二人撞車收到 `ALREADY_SUBMITTED` 時，快照同時也是 submitted，錯誤必須保留，因此撤回 |
| Muse U1：`decideWinner` 未過濾作廢作答 | **反駁** | `answerRanks.ts` 明確略過 `voidedAt !== null` |
| Muse U2：T060 commit 後廣播例外仍待證明 | **反駁** | 現行 `commandRouter.ts` 已攔截，`errorHandling.test.ts` 已覆蓋全域與定向 |
| Muse U3：reset 後草稿可能殘留 | **反駁** | 草稿 key 含 `sessionId`，啟用新 session 時會清理舊 session |
| G4：open 中可經 `/api/student/join` 取新組 token | **接受但保留決策** | 這涉及 001 FR-012／D21、token 身分與 OpenSpec 組共同行為；`003` 不自行改 |
| M6：看板「第 N 格」與「依前綴順序」衝突 | **反駁作為 bug** | 順序要求已滿足；是否把原前綴送進 teacher protocol 屬規格擴張 |
| MiniMax M7：手冊 `// 2 → // 4` 應改成 `// 3` | **反駁** | 第 3 步是程式碼塊下方 ack prose；改註解反而破壞與 quickstart 的對應 |

## T062／T063 實作結果

- `AnswerArea`：任一題等待 ack 時，所有題的送出按鈕停用；ack 失敗後仍會在 `finally` 解鎖，學生可重試。
- `AnswerBoard`：作廢確認與錯誤各自綁定目前 cell 的 phase/state/answers/rank signature；cell 被他人作廢、活動結束或該組重新送出後，不會沿用舊 UI 狀態。
- `broadcaster`：全域與定向廣播都以每個 socket 獨立保護；單一連線建立 snapshot 或 emit 失敗只記固定字串 `Broadcast state failed.`，不攜帶 snapshot、identity、payload 或例外內容，且不中止其餘連線。

## 驗證證據

| 層級 | 指令／證據 | 結果 |
|---|---|---|
| Web 聚焦測試 | `cd web && ../node_modules/.bin/vitest run tests/AnswerArea.test.tsx tests/teacher/AnswerBoard.test.tsx` | **16 passed** |
| Server 聚焦測試 | `cd server && ../node_modules/.bin/vitest run tests/integration/errorHandling.test.ts` | **6 passed** |
| 完整單元／整合 | `npm test` | server **291 passed**、web **73 passed** |
| 型別／lint／圖表 | `npm run check` | **全部通過** |
| End-to-end | `npm run test:e2e` | **13 passed、2 skipped** |
| Diff 檢查 | `git diff --check` | **通過** |
| 完成前安全審查 | GLM-5.3-max 只讀複查最新 T062/T063 diff | **無 High／Medium 阻擋** |

## 未完成與需決策

1. **T052 人工驗證**：23 步尚未由設計與驗證負責人執行；本輪所有自動測試與模型審查都不能替代它。
2. **換組／token**：001 FR-012／D21 與 student token 身分模型需使用者與 OpenSpec 組決策；本分支不改。
3. **看板原前綴顯示**：若要顯示「（1）（2）」需修改 teacher protocol 與投影資料，是規格變更請求，不是本輪 bug fix。
4. **本文件不代表已收斂**：只有全部 task 完成、T052 紀錄填畢且自動驗證齊全後，才能收斂／送審。
