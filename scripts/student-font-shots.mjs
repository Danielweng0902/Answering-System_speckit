#!/usr/bin/env node
/**
 * 學生端作答區的字級對照（開發用，不影響產品程式）。
 *
 * 用途：拍「修前 / 修後」的學生端作答區，證明輸入框字級在窄視窗
 * 到底有沒有生效 —— 這是純看總截圖看不出來的事。
 *
 * 用法：
 *   npm run build && TEACHER_PASSWORD=... npm start
 *   SHOT_PASSWORD=... node scripts/student-font-shots.mjs <輸出資料夾> <before|after>
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SHOT_PASSWORD;
if (!PASSWORD) throw new Error('SHOT_PASSWORD 未設定：密碼不進版本控制，請用環境變數傳入');
const outDir = process.argv[2] ?? '/tmp/student-font-shots';
const variant = process.argv[3] ?? 'after';
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/guided-notes/01-official-single.xlsx',
);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-TW',
  deviceScaleFactor: 2,
});
const student = await ctx.newPage();
await student.goto(`${BASE}/student`);

// ── 老師端建立一個組別，讓學生端有東西可答 ──
const teacherCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-TW',
});
const teacher = await teacherCtx.newPage();
await teacher.goto(`${BASE}/teacher`);
await teacher.getByLabel('老師密碼').fill(PASSWORD);
await teacher.getByRole('button', { name: '登入', exact: true }).click();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

const cookieHeader = (await teacherCtx.cookies())
  .filter((cookie) => cookie.name.startsWith('classroom'))
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ');
const setup = io(BASE, {
  transports: ['websocket'],
  extraHeaders: { Cookie: cookieHeader },
  forceNew: true,
});
await new Promise((resolve, reject) => {
  setup.on('connect', resolve);
  setup.on('connect_error', reject);
});
await setup.emitWithAck('group:create', { name: '測試組 01' });
setup.disconnect();

// ── 匯入官方題目（學生端要有題目才有作答區）──
const fixture = await readFile(FIXTURE);
await teacher.setInputFiles('input[name="guided-notes-file"]', {
  name: '01-official-single.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: fixture,
});
await teacher.getByRole('button', { name: '確認匯入', exact: true }).waitFor({ timeout: 15_000 });
await teacher.getByRole('button', { name: '確認匯入', exact: true }).click();
await teacher.waitForTimeout(1500);
await teacher.reload();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

// ── 開搶答（學生端只在「搶答中」顯示作答區）──
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).click();
await teacher.getByText('目前階段：搶答中').waitFor();

// ── 學生端進場 ──
const firstGroup = student.locator('button').filter({ hasText: '測試組' }).first();
await firstGroup.waitFor();
await firstGroup.click();
await student.waitForTimeout(1200);

// ── 量測三個關鍵字級（computed style）──
const fonts = await student.evaluate(() => {
  const pick = (selector) => {
    const el = document.querySelector(selector);
    return el === null ? null : getComputedStyle(el).fontSize;
  };
  return {
    題目: pick('[class*="_prompt_"]'),
    題目標題: pick('[class*="_questionTitle_"]'),
    輸入框: pick('[class*="_input_"]'),
    字數計數: pick('[class*="_counter_"]'),
    docScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  };
});
console.log(`[${variant}] 字級量測（學生端 390px）:`, JSON.stringify(fonts, null, 2));

// ── 拍作答區（只拍前兩題：驗收要看的是字級層級，不是全部題目）──
const area = student.locator('section[aria-labelledby="answer-area-title"]');
await area.scrollIntoViewIfNeeded();
await student.waitForTimeout(400);
const firstTwo = student.locator('section[aria-labelledby^="question-"]').nth(1);
await firstTwo.scrollIntoViewIfNeeded();
await student.waitForTimeout(300);
const box = await firstTwo.boundingBox();
if (box === null) throw new Error('找不到題目區塊');
await student.screenshot({
  path: join(outDir, `student-answer-area-${variant}.png`),
  clip: {
    x: 0,
    y: Math.max(0, box.y - 8),
    width: 390,
    height: Math.min(700, 844 - Math.max(0, box.y - 8)),
  },
});
console.log(`saved student-answer-area-${variant}.png`);

await browser.close();
