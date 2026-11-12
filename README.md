# 課堂搶答系統（SpecKit 組）

NCU SE6005 軟體工程期末專題。老師在電腦上開活動、建立組別；學生用手機或電腦選組進場；老師開啟、結束搶答時，全班畫面在 2 秒內同步。

> 這份 README 給組員看：怎麼裝、怎麼跑、怎麼在教室用手機實測、怎麼跑測試。系統規格以 `specs/` 為準，README 不是規格。

## 目前進度

| 子功能 | 狀態 |
|---|---|
| 001 活動與組別進場 | Phase 1–8 完成：老師登入、組別管理、學生選組與更換、開啟／結束搶答、全班同步、重新整理與斷線重連、倒數計時自動結束、重設活動。Phase 9（收尾與完整人工驗證）未做 |
| 002 Guided Notes 匯入 | Phase 1–6 完成：上傳 xlsx 或貼 Google 試算表連結、匯入摘要與確認、不同版面與題組、錯誤說明；沒有題目時不能開啟搶答。人工驗證（T057）未做 |
| 003 搶答作答 | 只有 spec 與圖（學生端「作答區」目前是佔位畫面） |
| 004 匯出 | 只有 spec 與圖 |
| 005 公平性與其他 | 只有 spec 與圖 |

逐項進度看 [`specs/001-activity-session/tasks.md`](specs/001-activity-session/tasks.md) 的勾選狀態。

## 1. 安裝

需要：

- **Node.js 24 以上**（用到內建的 `node:sqlite`）。用 `node -v` 確認。
- Git。

```bash
git clone https://github.com/Danielweng0902/Answering-System_speckit.git
cd Answering-System_speckit
npm install
```

## 2. 設定老師密碼

```bash
cp .env.example .env        # Windows：copy .env.example .env
```

打開 `.env`，在 `TEACHER_PASSWORD=` 後面填一個密碼（自己決定，不要用真實帳號的密碼）。

- `.env` 已被 `.gitignore` 排除，**不要 commit、不要貼到群組或 issue**。
- 沒有設定密碼時，老師端會顯示「系統尚未設定老師密碼」並拒絕登入，這是規格要求的行為。
- `PORT` 預設 3000；`DATA_DIR` 是 SQLite 資料檔的位置，預設 `./data`（已被 git 排除）。

## 3. 啟動

**正式模式**（實機測試、demo 用這個）：

```bash
npm run build
npm start
```

看到 `Server listening on ...` 就是啟動成功。在本機瀏覽器開 <http://localhost:3000>。

**開發模式**（改程式時用，存檔會自動重新載入）：

```bash
npm run dev
```

開發模式的前端由 Vite 提供，網址看終端機輸出（通常是 <http://localhost:5173>），API 與 Socket 會自動轉到 3000 埠的伺服器。

## 4. 操作流程

首頁選「老師」或「學生」，或直接開：

| 誰 | 網址 | 做什麼 |
|---|---|---|
| 老師 | `/teacher` | 輸入 `.env` 的密碼登入 → 新增、改名、刪除組別 → 匯入學習單（上傳 xlsx 或貼 Google 試算表連結 → 看摘要 → 確認匯入）→ 看各組是否在線 → 開啟搶答（可勾選「設定倒數」）→ 結束搶答 → 重設活動（需再確認） |
| 學生 | `/student` | 點自己的組別進場（不需要帳號密碼）→ 等待畫面 → 搶答中／已結束畫面；準備中可以「更換組別」 |

規則重點：

- 組名去除前後空白後 1–30 字，不能重複，最多 50 組。
- 只有「準備中」可以改組別；開啟搶答後組別固定。
- 沒有組別或題目時不能開啟搶答；開啟前必須先確認匯入學習單。
- Google 試算表需設為「知道連結者可檢視」才能用連結匯入；未開放時，請下載成 xlsx 後上傳。
- 階段只能「準備中 → 搶答中 → 已結束」；已結束後老師可以「重設活動」回到準備中，組別保留。
- 倒數 10 秒到 60 分鐘（10–3600 秒）；時間到自動結束，所有人看到的剩餘時間以伺服器為準。
- 重新整理頁面或斷線重連後，會回到原本的身分與目前階段（老師不用重新登入，學生不用重新選組）；伺服器重啟後階段、組別、倒數也會保留。斷線時畫面上方會顯示「重新連線中…」。

## 5. 實機測試（教室或宿舍，用手機連）

伺服器會接受同一個網路內其他裝置的連線。

1. 電腦和手機連**同一個 Wi-Fi**。
2. 在電腦上用正式模式啟動（`npm run build && npm start`）。
3. 查電腦的區網 IP：
   - macOS：`ipconfig getifaddr en0`
   - Windows：`ipconfig`，看「IPv4 位址」
   - Linux：`hostname -I`
4. 手機瀏覽器開 `http://<電腦的 IP>:3000/student`，例如 `http://192.168.1.23:3000/student`。
5. 老師用電腦開 `http://localhost:3000/teacher`。

連不上時依序檢查：

- 防火牆：macOS 第一次啟動時若跳出「是否允許 node 接受連入連線」，選允許；Windows 要允許 Node.js 通過「私人網路」。
- 學校或公共 Wi-Fi 常開啟「用戶端隔離」，裝置之間互連不了。改用手機熱點：電腦和其他手機都連到同一支手機的熱點。
- 網址要用 `http://`，不是 `https://`。

建議的實測劇本（對照 [001](specs/001-activity-session/quickstart.md) 與 [002](specs/002-guided-notes-import/quickstart.md) 的 quickstart）：

1. 老師先輸入錯誤密碼，確認顯示錯誤；再輸入正確密碼。
2. 不建組直接按「開啟搶答」，確認被拒絕。
3. 新增「第一組」「第二組」，確認手機上的組別清單 2 秒內出現。
4. 新增空白、重複、31 個字的組名，確認各自被拒絕並說明原因。
5. 兩支手機各選一組，確認顯示組名與「準備中」，老師端看到兩組「在線」。
6. 有組別但尚未匯入題目時按「開啟搶答」，確認被拒絕。
7. 上傳 `fixtures/guided-notes/01-official-single.xlsx`，看摘要後按「取消」，題目清單仍為空。
8. 再上傳同一檔並「確認匯入」，確認老師端顯示題號 1–6、學生端看不到題目。
9. 使用已設為「知道連結者可檢視」的 Google 試算表連結讀取，確認摘要與上傳檔案相同。
10. 老師開啟搶答，所有畫面 2 秒內顯示「搶答中」；再結束，顯示「已結束」。
11. 搶答中老師嘗試新增組別，確認被拒絕。
12. 重設活動後，勾選「設定倒數」輸入 9，確認被拒絕；改成 30 開啟，所有手機顯示的剩餘時間相差不超過 1 秒，時間到自動顯示「已結束」。
13. 搶答中把一支手機的頁面重新整理，確認仍是原組別與搶答中；關掉手機 Wi-Fi 幾秒再打開，確認出現「重新連線中…」後恢復。
14. 在電腦上按 Ctrl+C 停止伺服器再 `npm start`，確認所有畫面重連後階段與組別不變。
15. 已結束時按「重設活動」再按「取消」，確認仍是已結束；再按一次並「確認重設」，所有畫面回到準備中，組別還在。

把結果（日期、裝置、哪一步不符合預期）記在 `docs/verification/`。

## 6. 自動測試

```bash
npm test          # 單元＋整合測試（server、web）
npm run check     # 型別檢查、ESLint、圖表檢查
npm run test:e2e  # 端對端測試：會先 build，再用 Playwright 開三個瀏覽器（老師＋兩組學生），含重新整理情境
```

第一次跑 e2e 前要安裝瀏覽器：

```bash
npx --prefix e2e playwright install chromium
```

e2e 會用隨機密碼與暫存資料夾啟動 3100 埠的伺服器，不會動到你的 `.env` 與 `data/`。

## 7. 專案結構

```text
shared/   前後端共用的協定型別與 zod schema
server/   Node.js 伺服器：Express（HTTP API）＋ Socket.IO（即時同步）＋ SQLite
web/      React 前端（Vite）
e2e/      Playwright 端對端測試
specs/    Spec Kit 規格：每個子功能的 spec、plan、tasks、contracts、data-model
diagrams/ PlantUML 原始檔與 PNG（評分依據，也是圖的唯一正本）
design/   介面設計規範（DESIGN.md 與線框圖待補）
docs/     執行手冊、兩組共用約定、驗證紀錄
fixtures/ Guided Notes 匯入的測試檔
```

## 8. 開發流程（組員必讀）

- 規格是唯一依據：`specs/<NNN-name>/` 的 `spec.md`、`plan.md`、`tasks.md` 與 `.specify/memory/constitution.md`。流程是 constitution → specify → clarify → plan → tasks → analyze → implement → converge。
- AI 代理的規則在 [`AGENTS.md`](AGENTS.md)；分工、派工格式與驗收關卡在 [`docs/EXECUTION-PLAYBOOK.md`](docs/EXECUTION-PLAYBOOK.md)。
- AI 工具的設定與 skill（`CLAUDE.md`、`opencode.json`、`.claude/`、`.agents/`、`.opencode/` 等）不進版本控制，各自在本機設定。要用 Spec Kit 指令時，先安裝 `specify` CLI，再在專案根目錄執行 `specify init --here --ai <工具>` 產生；產生的檔案已被 `.gitignore` 排除。`.specify/`（constitution 與範本）有進版本控制，不要刪。
- `main` 是組員看的主線；新功能或實驗在分支上做，完成後開 PR 合併回 `main`。
- 一個子功能一個 branch、一個 PR，不直接 push 到 `main`。
- 會改變系統行為的修改，要先經另一小組（OpenSpec 組）同意，共同約定在 [`docs/shared/FEATURE-CONTRACT.md`](docs/shared/FEATURE-CONTRACT.md)。
- 改了 `diagrams/*.puml` 要用 `scripts/render-diagrams.sh` 重新產生 PNG。
- 密碼、金鑰只放 `.env`，不得出現在程式、文件、log 或 git 歷史。

## 9. 待決的規格問題（需要兩組討論）

實作時發現、尚未決定的地方，詳細說明見 [`docs/verification/`](docs/verification/)：

1. 學生的組別被刪除後重新連線，伺服器把他當訪客，不會送 contract 寫的 `session:invalid`。
2. 學生進場的 API 不帶舊身分，所以學生在搶答中仍可重新選組，繞過「只能在準備中更換組別」。
3. 不存在的 `/api/*` 路徑回 HTML 404，與「所有回應為 JSON」不一致。
4. 伺服器內部錯誤沒有對應的錯誤代碼，目前伺服器不回覆；前端在 10 秒後逾時並顯示「伺服器沒有回應」（contracts 沒有規定逾時）。
5. 安全複查的低風險建議：組名的零寬字元、全域登入節流、session 過期、連線來源白名單。
