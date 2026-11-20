import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const screenshotDirectory = join(repositoryRoot, 'docs/verification/007-screenshots');
const officialGroupFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/02-official-group.xlsx', import.meta.url),
);

/**
 * 造一份「作答格已經有內容」的學習單。
 *
 * 官方的 02 fixture 沒預填答案，所以不會產生 BLANK_HAS_CONTENT 警告；
 * 真實情境是老師把寫過答案的試算表再匯進來（Philip 回報的警告就是這樣來的）。
 */
async function buildFixtureWithAnswers(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(officialGroupFixturePath);
  const sheet = workbook.getWorksheet('學習單');
  if (sheet === undefined) {
    throw new Error('fixture 找不到學習單工作表');
  }
  sheet.getCell('G11').value = '已有答案';
  sheet.getCell('G13').value = '已有答案';
  const path = join(tmpdir(), '02-with-existing-answers.xlsx');
  await workbook.xlsx.writeFile(path);
  return path;
}

/**
 * 把活動回到「準備中」——匯入學習單只在準備中允許（其他 e2e 可能把活動
 * 留在「已結束」）。
 */
async function resetToPreparing(page: Page): Promise<void> {
  // 先等階段文字出現，再判斷要做什麼（避免頁面還沒載完就跳過重設）。
  await expect(page.getByText(/Current phase: (Preparing|Buzzing|Ended)/)).toBeVisible();

  // 注意：「結束搶答」在「已結束」時仍看得到但已停用（isVisible 會去點一個
  // 按不了的按鈕而卡住 → 用 isEnabled）；「重設活動」只在「已結束」時存在
  // （不存在時 isEnabled 會一直等 → 用 count 判斷）。
  const endBuzzing = page.getByRole('button', { name: 'End buzzing', exact: true });
  if (await endBuzzing.isEnabled()) {
    await endBuzzing.click();
    await expect(page.getByText('Current phase: Ended')).toBeVisible();
  }
  const reset = page.getByRole('button', { name: 'Reset activity', exact: true });
  if ((await reset.count()) > 0) {
    await reset.click();
    await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await expect(page.getByText('Current phase: Preparing')).toBeVisible();
  }
}

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
  // WCAG 3.1.1（Language of Page）：頁面宣告的語言要跟畫面一致，
  // 否則螢幕閱讀器會用中文發音規則念英文（2026-11-19 review）。
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // 切換成中文 → 立刻變中文，<html lang> 也跟著改。
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: '學生端' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');

  // 重新整理：選擇記在 localStorage → 仍是中文，<html lang> 也是。
  await page.reload();
  await expect(page.getByRole('heading', { name: '學生端' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');

  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'student-zh-TW.png'),
    fullPage: true,
  });

  // 切回英文 → 重新整理後仍是英文，<html lang> 也是。
  await page.getByRole('button', { name: 'EN' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Student' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'student-en.png'),
    fullPage: true,
  });

  await context.close();
});

test('英文版的匯入警告有翻譯（Philip 回報：匯入 Google 試算表的警告沒翻譯）', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  await page.goto('/teacher');
  await page.getByLabel('Teacher password').fill(requireTeacherPassword());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start buzzing' })).toBeVisible();
  await resetToPreparing(page);

  // 作答格已有內容的學習單 → 伺服器會給 BLANK_HAS_CONTENT 警告。
  await page
    .getByLabel('Upload xlsx file', { exact: true })
    .setInputFiles(await buildFixtureWithAnswers());

  const summary = page.getByRole('region', { name: 'Import summary' });
  await expect(summary).toContainText('already has content in');
  await expect(summary).toContainText('G11');
  // 中文原文不該出現在英文版。
  await expect(summary).not.toContainText('已有內容');

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
  await resetToPreparing(page);

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
