# Quickstart: 匯出結果（export）

## 前置

依 [002 quickstart](../002-guided-notes-import/quickstart.md) 與 [003 quickstart](../003-buzz-in/quickstart.md) 啟動系統（`npm run build && npm start`）並先 reset 到乾淨活動。老師分頁 T 開 `/teacher` 並登入；學生分頁至少兩個：第一組 A1、第二組 B。

測試用學習單在 `fixtures/guided-notes/`（`01-official-single.xlsx` 官方單題、`02-official-group.xlsx` 官方題組、`03`～`05` 其他版面），預期結果在 `fixtures/guided-notes/expected.json`。

## 自動驗證

```bash
npm test          # 含 csvBuilder 轉義、xlsxEditor 位元組替換、匯出用例的權限／階段／內容檢查
npm run test:e2e  # 含老師匯入、作答、結束、下載兩種檔案的完整流程
npm run check     # 型別、lint 與 PlantUML 圖檔檢查
```

預期：全部通過。匯出整合測試至少驗證 5 份 fixture 匯出後每個答案都落在 `expected.json` 所列的空格位置（SC-001）、填空格以外的内容與原檔相同（SC-002）、CSV 每一列與看板一致（SC-004）。

## 人工驗證（對應驗收情境）

老師分頁 T；學生分頁 A1（第一組）、B（第二組）。匯入 `fixtures/guided-notes/02-official-group.xlsx`（4 題、6 個空格；第 1、2 題為題組）並確認，使第 1、2 題各有 2 個空格。

| 步驟 | 操作 | 預期 | 驗收情境 |
|---|---|---|---|
| 1 | T 匯入 02 並確認；A1、B 分別加入第一組、第二組 | 老師端顯示題號 1–4；第 1、2 題有「（1）」「（2）」兩個輸入欄 | AC-004-01 前置 |
| 2 | T 開啟搶答 | A1、B 看到全部題號 | — |
| 3 | T 在「準備中」或「搶答中」找匯出按鈕 | 按鈕不提供；若直接呼叫匯出，系統拒絕並說明結束後才能匯出 | AC-004-05、FR-016 |
| 4 | A1 填完第 1 題兩個空格並送出；B 填完第 1 題兩個空格並送出 | 只有先送出者搶答成功；兩邊 2 秒內看到結果 | AC-004-01 前置 |
| 5 | A1 作答第 2 題（單題）；第 3、4 題不作答 | 對應題目有作答，其餘無人作答 | AC-004-02 前置 |
| 6 | T 按結束搶答 | 切到結果畫面 | — |
| 7 | T 按「匯出 Guided Notes」 | 下載一個 xlsx 檔，檔名為「搶答結果_日期時間.xlsx」 | FR-007 |
| 8 | 用 Excel 或 LibreOffice 開啟下載的檔 | 第 1 題兩個填空格分別是「（1）答案」「（2）答案」；第 2 題是該組答案；第 3、4 題維持空白；標題、題號、題目敘述、合併格、欄寬、框線與原檔相同 | AC-004-01、02、03、08 |
| 9 | T 先重設活動回到「準備中」（題目仍保留），再把匯出的檔案重新上傳到老師端做匯入測試 | 能被解析，題數與空格數與原檔相同 | SC-005 |
| 10 | T 按「匯出 CSV」 | 下載一個 CSV 檔；用 Excel 開啟中文不亂碼 | AC-004-12、FR-012 |
| 11 | 檢查 CSV 內容 | 第一列是 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間`；每個空格一列；依題號、順位、空格序排序；「是否搶答成功」為「是／否」 | AC-004-10、11、FR-010、011 |
| 12 | 找一個答案含逗號、引號或換行的活動匯出 | 該答案仍在同一欄位，沒有錯位 | AC-004-13、FR-013 |
| 13 | 找一個答案以 `=`、`+`、`-`、`@` 開頭的活動匯出 | 用試算表開啟時該內容顯示為文字，不是公式 | AC-004-14、FR-014 |
| 14 | 在沒有任何組別作答的活動（重設後）結束搶答再匯出 CSV | 只得到欄位名稱一列 | AC-004-15 |
| 15 | T 連續匯出兩次 | 兩次的檔案**內容**相同（檔名因時間戳可能不同） | AC-004-07、FR-008 |
| 16 | 用學生身分 A1 嘗試匯出 | 系統拒絕 | AC-004-06、FR-016 |
| 17 | 學生 A1 在作答期間被老師作廢（需 003 的作廢功能），該組不再送出；結束後匯出 | 該題在 xlsx 維持原內容（空白），CSV 沒有該組的列 | AC-004-16、17 |
| 18 | T 重設活動後再匯出 | 系統拒絕（活動已重設回「準備中」，回 `409 INVALID_PHASE`；重設不清除題目，所以不是「沒有學習單」） | Edge case |

步驟 11～13 需要能輸入特殊字元的活動；若不便操作，以自動測試的案例為準（`server/tests/integration/exportCommands.test.ts` 與 `server/tests/unit/csvBuilder.test.ts`）。

### 匯出檔的格式保真檢查（SC-002）

要把匯出檔與原檔做嚴格比對時，用這段指令（會檢查文字、合併、欄寬、列高、框線、字型、對齊）：

```bash
# 匯出檔與原檔各解壓成目錄後逐項比對
node -e "
const JSZip=require('jszip'),fs=require('fs');
(async()=>{
  const a=await JSZip.loadAsync(fs.readFileSync(process.argv[1]));
  const b=await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const names=[...new Set([...Object.keys(a.files),...Object.keys(b.files)])].filter(n=>!a.files[n]?.dir&&!b.files[n]?.dir);
  for(const n of names){
    const x=a.file(n),y=b.file(n);
    if(!x||!y){console.log('僅存在於其中一邊:',n);continue;}
    const bx=await x.async('nodebuffer'),by=await y.async('nodebuffer');
    if(!bx.equals(by))console.log('內容不同:',n);
  }
  console.log('比對完成');
})();
" <原檔路徑> <匯出檔路徑>
```

預期：只會列出 `xl/worksheets/sheetN.xml`（答案寫入的工作表）內容不同；其餘項目（`styles.xml`、`theme1.xml`、`sharedStrings.xml`、`workbook.xml`、`[Content_Types].xml` 等）都不會出現，表示除填格外完全沒動過（SC-002）。

## 測試 client（步驟 3、16 使用）

步驟 3（未結束時嘗試匯出）與步驟 16（學生身分嘗試匯出）在正式 UI 沒有操作入口（按鈕只在已結束且老師身分顯示）。做法是在**該身分所在的瀏覽器分頁**開 DevTools Console，用 `fetch` 帶上該分頁的 token 直接呼叫端點：

```js
// 1. 以該分頁身分呼叫匯出端點；token 只留在分頁內，不要複製或貼出
const response = await fetch('/api/export/guided-notes', {
  headers: { Authorization: `Bearer ${sessionStorage.getItem('classroom.session.token')}` },
});
console.log(response.status, await response.json());
```

預期：

- 學生分頁：`403`，`error.code` 為 `FORBIDDEN`（AC-004-06）。
- 搶答中的老師分頁：`409`，`error.code` 為 `INVALID_PHASE`（AC-004-05）。
- 已結束的老師分頁：`200`，`response.headers.get('content-type')` 為 xlsx 的型別。

## 已知限制與不在本次範圍

- **不寫回雲端**：匯出永遠是下載新檔案，不會修改 Google 試算表（Feature Contract D12、clarify 2026-11-14）。
- **CSV 固定 7 欄**：不包含「是否啟用公平順位」；005 實作公平順位時再由兩組同意調整 D13（clarify 2026-11-14）。
- **作廢的作答不列入**：被作廢且未重送的作答不算搶答成功（003 D24、clarify 2026-11-14）。

介面合約見 [contracts/http-api.md](./contracts/http-api.md)，資料模型見 [data-model.md](./data-model.md)，技術研究見 [research.md](./research.md)。
