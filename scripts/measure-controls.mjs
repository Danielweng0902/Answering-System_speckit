#!/usr/bin/env node
/** 量測控制項高度：輸入框與同列按鈕是否真的同高（Philip 的原始痛點）。 */
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SHOT_PASSWORD;
if (!PASSWORD) throw new Error('SHOT_PASSWORD 未設定');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW' });
const teacher = await ctx.newPage();
await teacher.goto(`${BASE}/teacher`);
await teacher.getByLabel('老師密碼').fill(PASSWORD);
await teacher.getByRole('button', { name: '登入', exact: true }).click();
await teacher.getByRole('button', { name: '開啟搶答', exact: true }).waitFor();
await teacher.waitForTimeout(500);

const report = await teacher.evaluate(() => {
  const rows = [];
  for (const section of document.querySelectorAll('section')) {
    const title = section.querySelector('h2')?.textContent?.slice(0, 8) ?? '(無標題)';
    for (const el of section.querySelectorAll('button, input:not([type="file"])')) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      rows.push({
        section: title,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 12),
        cls: (el.getAttribute('class') ?? '').slice(0, 34),
        type: el.getAttribute('type') ?? '-',
        height: Math.round(r.height),
        width: Math.round(r.width),
      });
    }
  }
  return rows;
});

for (const r of report) {
  console.log(
    `${r.section.padEnd(10)} ${r.tag.padEnd(7)} type=${String(r.type).padEnd(8)} ${r.text.padEnd(12)} h=${String(r.height).padStart(3)} ${r.cls}`,
  );
}
const heights = [...new Set(report.map((r) => r.height))].sort((a, b) => a - b);
console.log('\n不同高度:', heights.join(', '));
await browser.close();
