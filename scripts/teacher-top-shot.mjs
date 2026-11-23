#!/usr/bin/env node
/** 拍老師端上半段（含區塊間距），裁成設計負責人看得清楚的高度。 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SHOT_PASSWORD;
if (!PASSWORD) throw new Error('SHOT_PASSWORD 未設定');
const outDir = process.argv[2] ?? '/tmp/teacher-shot';
const CLIP_HEIGHT = Number(process.env.SHOT_CLIP_HEIGHT ?? '2600');
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/guided-notes/01-official-single.xlsx',
);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-TW',
  deviceScaleFactor: 2,
});
const teacher = await ctx.newPage();
await teacher.goto(`${BASE}/teacher`);
await teacher.getByLabel('老師密碼').fill(PASSWORD);
await teacher.getByRole('button', { name: '登入', exact: true }).click();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();

const cookieHeader = (await ctx.cookies())
  .filter((c) => c.name.startsWith('classroom'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');
const setup = io(BASE, {
  transports: ['websocket'],
  extraHeaders: { Cookie: cookieHeader },
  forceNew: true,
});
await new Promise((res, rej) => {
  setup.on('connect', res);
  setup.on('connect_error', rej);
});
for (let i = 0; i < 12; i += 1) {
  await setup.emitWithAck('group:create', { name: `測試組 ${String(i + 1).padStart(2, '0')}` });
}
setup.disconnect();

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
await teacher.waitForTimeout(800);

// 區塊之間的間距（--space-block 取代 --space-10 的成果）
const gaps = await teacher.evaluate(() => {
  const nodes = [...document.querySelectorAll('[class*="_section_"]')];
  const rects = nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return {
      title: n.querySelector('h2')?.textContent?.slice(0, 8) ?? '(無標題)',
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
    };
  });
  return {
    sections: rects,
    // 區塊之間的「空白」＝下一個區塊的頂端 − 前一個區塊的底端
    gaps: rects.slice(1).map((r, i) => r.top - (rects[i]?.bottom ?? r.top)),
    totalHeight: Math.round(document.documentElement.scrollHeight),
  };
});
console.log('區塊位置與間距:', JSON.stringify(gaps, null, 2));

await teacher.screenshot({
  path: join(outDir, 'teacher-top.png'),
  fullPage: true,
  clip: { x: 0, y: 0, width: 1440, height: Math.min(CLIP_HEIGHT, gaps.totalHeight) },
});
console.log('saved teacher-top.png');
await browser.close();
