#!/usr/bin/env node
/**
 * 字級與密度的視覺檢查工具（開發用，不影響產品程式）。
 *
 * 用途：調整 `web/src/styles/tokens.css` 之後，用同一組情境重拍截圖，
 * 直接比對三個畫面（老師端／學生端／投影看板）的變化，避免每次都靠印象判斷。
 *
 * 用法：
 *   # 1. 先起正式 build 的伺服器（腳本不會自己啟動）
 *   npm run build && npm start
 *
 *   # 2. 拍攝（50 組 / 100 組兩種規模）
 *   node scripts/token-shots.mjs /tmp/shots-50 base
 *   node scripts/token-shots.mjs /tmp/shots-100 dense
 *
 * 環境變數：
 *   SHOT_BASE     伺服器網址（預設 http://127.0.0.1:3000）
 *   SHOT_PASSWORD 老師密碼（預設讀 .env 的 TEACHER_PASSWORD）
 *
 * 產生的畫面：
 *   01-teacher-prepared   老師端（準備中，含匯入的題目）
 *   02-teacher-open       老師端（搶答中，看板最長的狀態）
 *   03-student-open       學生端（手機寬度，搶答中）
 *   04-student-answered   學生端（手機寬度，已作答）
 *   05-teacher-closed     老師端（已結束）
 *   06-projector-reveal   投影看板（已結束＋全部揭曉）→ 8 公尺判讀用
 *   07-student-results    學生端（結果）
 *
 * 註：老師端自 2026-11-22（D18）改用 HttpOnly cookie 認證，所以投影頁
 * 必須在**同一個 browser context** 另開分頁，才能沿用 cookie。
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SHOT_PASSWORD ?? 'token-demo-pw-2026';
const outDir = process.argv[2] ?? '/tmp/token-shots';
const scenario = process.argv[3] ?? 'base';
const groupCount = scenario === 'dense' ? 100 : 50;
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/guided-notes/01-official-single.xlsx',
);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

async function newPage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'zh-TW',
    deviceScaleFactor: 2,
  });
  return context;
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  console.log(`saved ${name}.png`);
}

// ── 老師端：登入並取得 cookie ──
const teacherCtx = await newPage(1440, 900);
const teacher = await teacherCtx.newPage();
await teacher.goto(`${BASE}/teacher`);
await teacher.getByLabel('老師密碼').fill(PASSWORD);
await teacher.getByRole('button', { name: '登入', exact: true }).click();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

const cookies = await teacherCtx.cookies();
const cookieHeader = cookies
  .filter((cookie) => cookie.name.startsWith('classroom'))
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ');

// ── 用 cookie 另開一條 Socket.IO 連線建立組別 ──
const setup = io(BASE, {
  transports: ['websocket'],
  extraHeaders: { Cookie: cookieHeader },
  forceNew: true,
});
await new Promise((resolve, reject) => {
  setup.on('connect', resolve);
  setup.on('connect_error', reject);
});

let created = 0;
for (let index = 0; index < groupCount; index += 1) {
  const name = `測試組 ${String(index + 1).padStart(2, '0')}`;
  const ack = await setup.emitWithAck('group:create', { name });
  if (ack?.ok === true) created += 1;
}
setup.disconnect();
console.log(`groups created: ${created}/${groupCount}`);

// ── 匯入官方題目（走老師端 UI：上傳 → 看摘要 → 確認匯入）──
const fixture = await readFile(FIXTURE);
await teacher.setInputFiles('input[name="guided-notes-file"]', {
  name: '01-official-single.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: fixture,
});
await teacher.getByRole('button', { name: '確認匯入', exact: true }).waitFor({ timeout: 15_000 });
await teacher.getByRole('button', { name: '確認匯入', exact: true }).click();
await teacher.waitForTimeout(1200);
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

await teacher.reload();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();
await shot(teacher, `01-teacher-prepared-${groupCount}groups`);

// ── 開搶答 ──
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).click();
await teacher.getByText('目前階段：搶答中').waitFor();
await shot(teacher, `02-teacher-open-${groupCount}groups`);

// ── 學生端（手機寬度）──
const studentCtx = await newPage(390, 844);
const student = await studentCtx.newPage();
await student.goto(`${BASE}/student`);
const firstGroup = student.locator('button').filter({ hasText: '測試組' }).first();
await firstGroup.waitFor();
await firstGroup.click();
await student.waitForTimeout(900);
await shot(student, `03-student-open-${groupCount}groups`);

// ── 學生作答（讓揭曉結果有內容）──
// 用 aria-label 精準定位輸入框；前 3 題各填一個答案 → 揭曉後投影看板
// 會有贏家組別與答案（8 公尺判讀要看的就是這張）。
const inputs = student.locator('input[aria-label*="第"]');
const inputCount = await inputs.count();
console.log('student answer inputs:', inputCount);
for (let index = 0; index < Math.min(3, inputCount); index += 1) {
  const field = inputs.nth(index);
  await field.click();
  await field.fill(`測試答案 ${index + 1}`);
  await field.blur();
}
await student.waitForTimeout(400);

for (let index = 0; index < 3; index += 1) {
  // 可讀名稱是中文「送出第 N 題」（視覺上才是「送出 Q N」）。
  const button = student.getByRole('button', {
    name: `送出第 ${index + 1} 題`,
    exact: true,
  });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await student.waitForTimeout(600);
  }
}
await student.waitForTimeout(400);
await shot(student, `04-student-answered-${groupCount}groups`);

// ── 投影看板（同一個 context 才有 cookie）──
const projector = await teacherCtx.newPage();
await projector.setViewportSize({ width: 1920, height: 1080 });
await projector.goto(`${BASE}/projector`);
await projector.waitForTimeout(1500);
await shot(projector, `04-projector-open-${groupCount}groups`);

// ── 結束搶答 ──
await teacher.getByRole('button', { name: '結束搶答', exact: true }).click();
await teacher.getByText('目前階段：已結束').waitFor();
await teacher.waitForTimeout(600);
await shot(teacher, `05-teacher-closed-${groupCount}groups`);

// ── 揭曉結果（8 公尺判讀用的關鍵畫面）──
await teacher.getByRole('button', { name: '全部揭曉', exact: true }).click();
await teacher.waitForTimeout(1200);
await projector.reload();
await projector.waitForTimeout(1500);
await shot(projector, `06-projector-reveal-${groupCount}groups`);

await student.reload();
await student.waitForTimeout(1200);
await shot(student, `07-student-results-${groupCount}groups`);

await browser.close();
console.log('done →', outDir);
