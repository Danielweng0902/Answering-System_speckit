import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const screenshotDirectory = join(repositoryRoot, 'docs/verification/007-screenshots');

function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定');
  }
  return value;
}

/**
 * 007 i18n：語言預設依使用者的系統語言，也可���右上角切換並記住。
 */

test('系統語言是英文時，介面預設顯示英文；切換成中文後重新整理仍保留', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  // 這個 context 的系統語言是英文 → 介面預設英文。
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  await page.goto('/student');
  // 學生端尚未進組別時的畫面：英文版。
  await expect(page.getByRole('heading', { name: 'Student' })).toBeVisible();
  await expect(page.getByText('Choose your group')).toBeVisible();

  // 切換成中文 → 立刻變中文。
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: '學生端' })).toBeVisible();

  // 重新整理：選擇記在 localStorage → 仍是中文。
  await page.reload();
  await expect(page.getByRole('heading', { name: '學生端' })).toBeVisible();

  // 切回英文 → 重新整理後仍是英文。
  await page.getByRole('button', { name: 'EN' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Student' })).toBeVisible();

  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'student-en.png'),
    fullPage: true,
  });

  await context.close();
});

test('老師端也能切換英文（表格與按鈕的英文排版）', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  await page.goto('/teacher');
  await page.getByLabel('Teacher password').fill(requireTeacherPassword());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start buzzing' })).toBeVisible();

  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'teacher-en.png'),
    fullPage: true,
  });

  await context.close();
});

test('系統語言是繁體中文時，介面預設顯示繁體中文', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ locale: 'zh-TW' });
  const page = await context.newPage();

  await page.goto('/student');
  await expect(page.getByRole('heading', { name: '學生端' })).toBeVisible();
  await expect(page.getByText('選擇組別')).toBeVisible();

  await context.close();
});
