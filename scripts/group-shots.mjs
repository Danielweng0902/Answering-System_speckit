#!/usr/bin/env node
/**
 * 組別管理版面（名稱＋按鈕同一列）的視覺驗收工具（開發用，不影響產品程式）。
 *
 * 用途：拍攝 Constitution 原則 IX 要求的三張截圖（老師端、學生端、手機寬度），
 * 並實測「每一列的高度」，讓密度成果（每列 67 px）有可重現的量測依據，
 * 而不是只靠 CSS 註解裡的一個數字。
 *
 * 用法：
 *   # 1. 先起正式 build 的伺服器（腳本不會自己啟動）
 *   npm run build && TEACHER_PASSWORD=... npm start
 *
 *   # 2. 拍攝
 *   SHOT_PASSWORD=... node scripts/group-shots.mjs docs/verification/015-group-list-inline-actions-screenshots
 *
 * 環境變數：
 *   SHOT_BASE     伺服器網址（預設 http://127.0.0.1:3000）
 *   SHOT_PASSWORD 老師密碼（**必填**，沒有預設值：密碼不進版本控制）
 *   SHOT_GROUPS   建立的組別數（預設 12；100 是 D20 的上限）
 *
 * 產生的畫面：
 *   01-teacher-group-list-desktop       老師端組別管理（桌面 1440px，一般狀態）
 *   02-teacher-group-rename             老師端組別管理（改名中，表單獨佔一列）
 *   03-teacher-group-list-mobile        老師端組別管理（手機寬度 390px）
 *   04-teacher-group-list-mobile-long-name  最長組名（30 字）那一列的細節
 *   05-student-mobile                   學生端（手機寬度 390px；證明本次改動沒有連動）
 *
 * 註：老師端自 2026-11-22（D18）改用 HttpOnly cookie 認證，所以 Socket.IO
 * 連線必須帶上同一個 browser context 的 cookie。
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SHOT_PASSWORD;
if (PASSWORD === undefined || PASSWORD === '') {
  throw new Error('SHOT_PASSWORD 未設定：密碼不進版本控制，請用環境變數傳入');
}
const outDir = process.argv[2] ?? 'docs/verification/015-group-list-inline-actions-screenshots';
const groupCount = Number(process.env.SHOT_GROUPS ?? '12');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

async function newContext(width, height) {
  return browser.newContext({
    viewport: { width, height },
    locale: 'zh-TW',
    deviceScaleFactor: 2,
  });
}

/** 拍整頁（老師端組別管理在頁面上方，整頁才看得到它在整體版面中的位置）。 */
async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  console.log(`saved ${name}.png`);
}

// ── 老師端：登入並取得 cookie ──
const teacherCtx = await newContext(1440, 900);
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
  // 最後一組用「最長合法組名」（30 字，不可斷開的拉丁字母），
  // 讓窄視窗截圖同時驗證 overflow-wrap: anywhere 不會把頁面撐寬。
  const name =
    index === groupCount - 1 ? 'W'.repeat(30) : `測試組 ${String(index + 1).padStart(2, '0')}`;
  const ack = await setup.emitWithAck('group:create', { name });
  if (ack?.ok === true) created += 1;
}
setup.disconnect();
console.log(`groups created: ${created}/${groupCount}`);

await teacher.reload();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

// ── 量測「每一列」的高度（密度成果的可重現依據）──
const rowHeights = await teacher
  .locator('ul[aria-label="組別清單"] > li')
  .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
const uniqueHeights = [...new Set(rowHeights)];
console.log(`每列高度（px）: ${uniqueHeights.join(', ')}（${rowHeights.length} 列）`);

// ── 驗證「名稱與按鈕真的在同一列」（不靠目視，靠 bounding box）──
const layout = await teacher.evaluate(() => {
  const rows = [...document.querySelectorAll('ul[aria-label="組別清單"] > li')];
  const row = rows[0];
  if (row === undefined) throw new Error('找不到組別列');
  const header = row.querySelector('div');
  const actions = row.querySelector('div:nth-child(2)');
  if (header === null || actions === null) throw new Error('找不到名稱或按鈕欄');
  const h = header.getBoundingClientRect();
  const a = actions.getBoundingClientRect();
  return {
    headerTop: Math.round(h.top),
    headerBottom: Math.round(h.bottom),
    actionsTop: Math.round(a.top),
    actionsBottom: Math.round(a.bottom),
    // 垂直中心差距小於一行高度 → 視覺上在同一列
    centerDelta: Math.round(Math.abs((h.top + h.bottom) / 2 - (a.top + a.bottom) / 2)),
    rowHeight: Math.round(row.getBoundingClientRect().height),
  };
});
console.log('同一列驗證:', JSON.stringify(layout));
if (layout.centerDelta > layout.rowHeight / 2) {
  throw new Error(`名稱與按鈕不在同一列（中心差距 ${layout.centerDelta}px）`);
}

await shot(teacher, '01-teacher-group-list-desktop');

// ── 改名中：表單應該獨佔一列 ──
await teacher.getByRole('button', { name: '改名 測試組 01', exact: true }).click();
await teacher.locator('input[name="rename-group-name"]').waitFor();
const renameRowHeight = await teacher
  .locator('ul[aria-label="組別清單"] > li')
  .first()
  .evaluate((row) => Math.round(row.getBoundingClientRect().height));
console.log(`改名中的列高（px）: ${renameRowHeight}`);

// 改名表單的頂端應該在該列名稱的下方（獨佔下一列），不是擠在右側。
const renameLayout = await teacher.evaluate(() => {
  const row = document.querySelector('ul[aria-label="組別清單"] > li');
  if (row === null) throw new Error('找不到組別列');
  const header = row.querySelector('div');
  const form = row.querySelector('form');
  if (header === null || form === null) throw new Error('找不到名稱或改名表單');
  const h = header.getBoundingClientRect();
  const f = form.getBoundingClientRect();
  return {
    headerBottom: Math.round(h.bottom),
    formTop: Math.round(f.top),
    formLeft: Math.round(f.left),
    headerLeft: Math.round(h.left),
  };
});
console.log('改名表單獨佔一列驗證:', JSON.stringify(renameLayout));
if (renameLayout.formTop < renameLayout.headerBottom) {
  throw new Error('改名表單沒有落在名稱下方（可能被擠在同一列）');
}
await shot(teacher, '02-teacher-group-rename');

// ── 手機寬度 ──
await teacher.setViewportSize({ width: 390, height: 844 });
await teacher.waitForTimeout(600);
await shot(teacher, '03-teacher-group-list-mobile');

// ── 手機寬度 + 最長組名（驗證不會水平溢出）──
const mobileOverflow = await teacher.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  docScrollWidth: document.documentElement.scrollWidth,
}));
console.log('手機寬度溢出檢查:', JSON.stringify(mobileOverflow));
if (mobileOverflow.docScrollWidth > mobileOverflow.viewportWidth) {
  throw new Error(
    `手機寬度下出現水平溢出（${mobileOverflow.docScrollWidth} > ${mobileOverflow.viewportWidth}）`,
  );
}
await teacher.locator('ul[aria-label="組別清單"] > li').last().scrollIntoViewIfNeeded();
await teacher.waitForTimeout(400);
// 拍「最長組名」那一列本身（整頁截圖看不到差異，這裡要的是那一列的細節）
await teacher
  .locator('ul[aria-label="組別清單"] > li')
  .last()
  .screenshot({ path: join(outDir, '04-teacher-group-list-mobile-long-name.png') });
console.log('saved 04-teacher-group-list-mobile-long-name.png');

// ── 學生端（手機寬度）：證明本次改動沒有連動 ──
const studentCtx = await newContext(390, 844);
const student = await studentCtx.newPage();
await student.goto(`${BASE}/student`);
const firstGroup = student.locator('button').filter({ hasText: '測試組' }).first();
await firstGroup.waitFor();
await firstGroup.click();
await student.waitForTimeout(900);
await shot(student, '05-student-mobile');

await browser.close();
console.log('done →', outDir);
