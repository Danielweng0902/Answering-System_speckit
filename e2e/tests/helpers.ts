import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const officialSingleFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/01-official-single.xlsx', import.meta.url),
);

/** 上傳官方單題範本、確認摘要 6 題 6 空格，並等待第 6 題出現在題目清單。 */
export async function importQuestions(page: Page): Promise<void> {
  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(officialSingleFixturePath);

  const summary = page.getByRole('region', { name: '匯入摘要' });
  await expect(summary).toContainText('共 6 題、6 個空格');
  await summary
    .getByRole('button', { name: '確認匯入', exact: true })
    .click();
  await expect(summary).not.toBeVisible();

  await expect(
    page.getByRole('region', { name: '題目清單' }),
  ).toContainText('第 6 題');
}
