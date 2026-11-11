# Guided Notes 測試資料

這個目錄保存匯入 Guided Notes 時所用的結構化測試檔。解析器必須透過「題號／題目／作答」表頭與合併範圍定位，不能假設固定工作表、列、欄或題目數。01 與 02 是 TA 提供的官方範例，01、02 以外的檔案由 `_build/make_fixtures.py` 產生；所有檔案的預期結構由 `expected.json` 記錄，並由 `_build/verify_fixtures.py` 獨立檢查。

| 檔案 | 測試重點 | 預期解析行為 |
|---|---|---|
| `01-official-single.xlsx` | TA 官方單題範例：標準工作表 `學習單`、表頭列、每題一列，題目間有空白列。 | 視為有效；找到 6 題、6 個空作答格。 |
| `02-official-group.xlsx` | TA 官方題組範例：題號儲存格垂直合併，子題作答格含 `（1）`、`（2）` 前綴。 | 視為有效；找到 4 題、6 個作答格，並保留子題前綴。 |
| `03-shifted-layout.xlsx` | 新標題、額外說明列與類別欄；表頭不在第 4 列、題號不在 B 欄、合併範圍與空白列數量也不同。 | 視為有效；依表頭與合併範圍找到 8 題、8 個空作答格。 |
| `04-mixed-groups.xlsx` | 單題與 3 個題組交錯；其中一個題組有 3 個子題；所有作答格用 `G:I` 合併，寬度不同於官方範例。 | 視為有效；找到 7 題、11 個作答格；各題組仍屬於同一題號。 |
| `05-two-sheets.xlsx` | 第一張為 `說明`，真正的 Guided Notes 在第二張 `學習單`。 | 視為有效；掃過第一張後在第二張找到 5 題、5 個空作答格。 |
| `90-invalid-no-header.xlsx` | 欄位名稱刻意不是 `題號`、`題目`、`作答`。 | 視為無效；錯誤為 `missing header row`。 |
| `91-invalid-duplicate-number.xlsx` | 表頭格式正確，但題號 `3` 出現兩次。 | 視為無效；錯誤為 `duplicate question number: 3`。 |
| `92-invalid-empty.xlsx` | 只有正確表頭，沒有任何數字題號。 | 視為無效；錯誤為 `no questions`。 |

重新產生與檢查方式：

```bash
python3 -I fixtures/guided-notes/_build/make_fixtures.py
python3 -I fixtures/guided-notes/_build/verify_fixtures.py
```

產生器不會覆寫 01／02；官方範例如需更新，應從 `docs/` 重新透過檔案複製取得。
