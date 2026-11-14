# 003 buzz-in 中程安全複查紀錄（唯讀）

- **日期**：2026-11-13
- **複查者**：GLM-5.3-max（唯讀複查 worker，只回報不改程式；playbook §8）
- **範圍**：003 已完成部分（T001–T025、T034–T037、T042–T046）——送出與順位、可見範圍三層（快照／revision／封包）、輸入驗證、持久化、草稿
- **對照**：`specs/003-buzz-in/spec.md`、`contracts/socket-events.md`、`data-model.md`、`.specify/memory/constitution.md`
- **暫緩範圍（非缺陷）**：US3（`answer:void`、board、progress）、US5（題組顯示）、Polish

## 結論

在已實作範圍內**沒有發現違反 spec、constitution 或洩漏的缺陷**。SC-001／002／005／006／007 都有對應且通過的測試。`npm test`（35 files／274 tests）、web 測試（12 files／61 tests）、`npm run test:e2e`（10 passed, 1 skipped 既有）由複查者實際執行全部通過。

## 重點查核結果（摘要）

1. **FR／AC 一致**：`answer:submit` 觸發順序與 contracts 完全一致；成功 ack 只有 `{ ok: true }`；rank 由伺服器判定、不採用戶端時間；`maxRank` 含已作廢、號碼不重用；reset 只能 closed→preparing，confirm 遇既有作答的路徑不可達。
2. **可見範圍（原則 VI、SC-002）**：快照內容、per-role revision、定向封包三層都通過；其他推知作答事件的側通道（presence、revision、錯誤代碼、廣播時序）都查過，沒有可用訊號。
3. **輸入驗證（原則 III）**：strictObject 擋偽造 `groupId`；trim＋code point 1–200；所有檢查在 `BEGIN IMMEDIATE` 內、失敗 ROLLBACK，整合測試以完整 DB＋固定時鐘快照驗證失敗後完全不變、不占順位。
4. **機敏資料（原則 IV）**：log 只記事件名稱；草稿只存 localStorage；快照不含原檔與 sourceUrl。
5. **寫死位置（原則 V）**：production 程式無儲存格座標；測試 helper 的 `G${n+4}` 是測試資料建構，不違反。
6. **並行與順序（research R2）**：`BEGIN IMMEDIATE`＋兩個唯一索引；SC-001 十組並發通過；同組 `Promise.all` 只有先到者成功；倒數到期與手動 close 共用同步 `closeCurrent()`，結束瞬間送出由到達順序決定；重啟在 listen 前處理過期倒數；reset 與 submit 因階段限制不可能交錯。
7. **T025 role 變換重設基準**：沒有可濫用路徑（同連線角色只能 student→guest 單向；重連會重設基準；被接受的低 revision 快照一律是伺服器當下重產的；單調規則是 UI 機制而非權限邊界）。
8. **草稿 localStorage**：只掃描刪除 `classroom.buzz-in.drafts.` 命名空間內非目前 session 的 key，不用 `clear()`。

## 發現與監督處置

| # | 發現 | 嚴重度 | 監督處置（2026-11-13） |
|---|---|---|---|
| 1 | FR-007（E1）多空格**指令路徑**沒有整合測試：現有整合測試全部單空格（`helpers.ts` 預設 `defaultBlanks` 單格），多空格只有直接寫 DB 的投影單元測試 | 低（測試涵蓋缺口，非實作缺陷） | **採納**：屬 T038（US5）範圍，提前於 US5 學生側派工補上（送出兩空格一起記錄一個 rank、單空格答案被拒） |
| 2 | `buildClosedMyAnswers` 以 `.at(-1)`（rank 最大）取最新作廢，US3 的 `findLatest` 需保持同語意 | 注意點 | **採納**：併入 T028 的 task 說明 |
| 3 | 同分頁多 tab 同組草稿互蓋（後寫者贏） | 規格範圍外 | 不處理（spec 明定草稿不同步、只要求單裝置保留） |
| 4 | `answerSubmitSchema` 的 `answers` 無陣列長度上限 | 強化建議 | 不處理（筆數由空格數檢查擋下，Socket.IO 有 1MB 上限；不構成行為缺漏） |
| 5 | `AnswerArea` 在 render 期間的 initializer 執行 localStorage 清理 | 觀察 | 不處理（key 重掛載＋冪等，行為正確） |

## 給 US3 的注意點（T028）

`findLatest(questionId, groupId)`（含已作廢取最新一筆）與 `buildClosedMyAnswers` 的 `.at(-1)`（依 position、rank 排序後取最後一筆＝rank 最大＝最新）語意必須一致，避免兩處對「最新作廢」的判定不同。
