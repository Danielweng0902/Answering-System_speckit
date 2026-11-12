import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_MESSAGES } from '@classroom/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { importQuestions } from './helpers.js';

const officialSingleFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/01-official-single.xlsx', import.meta.url),
);
const officialGroupFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/02-official-group.xlsx', import.meta.url),
);
const duplicateNumberFixturePath = fileURLToPath(
  new URL(
    '../../fixtures/guided-notes/91-invalid-duplicate-number.xlsx',
    import.meta.url,
  ),
);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const screenshotDirectory = join(
  repositoryRoot,
  'docs/verification/002-screenshots',
);

function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定，請透過 Playwright config 注入');
  }
  return value;
}

async function loginAsTeacher(page: Page): Promise<void> {
  await page.goto('/teacher');
  await page.getByLabel('老師密碼').fill(requireTeacherPassword());
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '開啟搶答', exact: true }),
  ).toBeVisible();
}

/** 單獨執行也能從共用活動的搶答中或已結束回到準備中。 */
async function resetToPreparing(page: Page): Promise<void> {
  if (await page.getByText('目前階段：搶答中').isVisible()) {
    await page.getByRole('button', { name: '結束搶答', exact: true }).click();
    await expect(page.getByText('目前階段：已結束')).toBeVisible();
  }
  if (await page.getByText('目前階段：已結束').isVisible()) {
    await page.getByRole('button', { name: '重設活動', exact: true }).click();
    await page.getByRole('button', { name: '確認重設', exact: true }).click();
    await expect(page.getByText('目前階段：準備中')).toBeVisible();
  }
}

async function capture(locator: Locator, filename: string): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await locator.page().waitForLoadState('networkidle');
  // locator.screenshot 亦會等待元素停止移動；停用動畫避免擷取到過渡畫面。
  await locator.screenshot({
    animations: 'disabled',
    path: join(screenshotDirectory, filename),
  });
}

test.skip(
  process.env.SCREENSHOTS !== '1',
  '畫面截圖僅在 SCREENSHOTS=1 時執行',
);

test('T056：擷取匯入摘要、錯誤與確認後題目清單', async ({ page }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  await loginAsTeacher(page);
  await resetToPreparing(page);

  // 先建立確定的 01 題庫，避免依賴其他 spec 或先前手動執行的狀態。
  await importQuestions(page);
  const importRegion = page.getByRole('region', { name: '匯入學習單' });
  const questionList = page.getByRole('region', { name: '題目清單' });
  const summary = importRegion.getByRole('region', { name: '匯入摘要' });

  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(officialSingleFixturePath);
  await expect(summary).toContainText('共 6 題、6 個空格');
  await expect(importRegion).toHaveAttribute('aria-busy', 'false');
  await capture(importRegion, '01-summary-single.png');
  await summary.getByRole('button', { name: '取消', exact: true }).click();
  await expect(summary).toHaveCount(0);

  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(officialGroupFixturePath);
  await expect(summary).toContainText('確認後會取代現有題目');
  await expect(summary).toContainText('共 4 題、6 個空格');
  await expect(summary).toContainText('第 1、2 題是題組');
  await expect(summary).toContainText('第 1 題（題組，2 個空格）');
  await expect(importRegion).toHaveAttribute('aria-busy', 'false');
  await capture(importRegion, '02-summary-group-replace.png');
  await summary
    .getByRole('button', { name: '確認匯入', exact: true })
    .click();
  await expect(summary).toHaveCount(0);
  await expect(
    questionList.getByRole('list', { name: '已匯入題目' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(questionList).toContainText('題組，2 個空格');

  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(duplicateNumberFixturePath);
  await expect(importRegion.getByRole('alert')).toContainText('題號 3 重複');
  await expect(importRegion).toHaveAttribute('aria-busy', 'false');
  await capture(importRegion, '03-error-duplicate.png');

  // 只模擬同源 API 回應，不會連到輸入的 Google 試算表網址。
  await page.route('**/api/questions/import/link', async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'LINK_NOT_SHARED',
          message: ERROR_MESSAGES.LINK_NOT_SHARED,
        },
      }),
    });
  });
  await page
    .getByLabel('Google 試算表連結')
    .fill('https://docs.google.com/spreadsheets/d/not-shared/edit');
  await page.getByRole('button', { name: '讀取', exact: true }).click();
  await expect(importRegion.getByRole('alert')).toContainText(
    ERROR_MESSAGES.LINK_NOT_SHARED,
  );
  await expect(importRegion.getByRole('alert')).toContainText(
    '把共用設定改成知道連結者可檢視',
  );
  await expect(importRegion).toHaveAttribute('aria-busy', 'false');
  await capture(importRegion, '04-error-link-not-shared.png');

  await expect(questionList).toContainText('第 4 題');
  await expect(questionList).not.toContainText('第 6 題');
  await capture(questionList, '05-question-list.png');
});
