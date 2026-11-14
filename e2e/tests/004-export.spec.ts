import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { importQuestions } from './helpers.js';

const verificationDirectory = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'docs',
  'verification',
  '004-screenshots',
);
const downloadDirectory = join(verificationDirectory, 'downloads');

function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定，請透過 Playwright config 注入');
  }
  return value;
}

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

async function addGroup(page: Page, name: string): Promise<void> {
  const groupManager = page.getByRole('region', { name: '組別管理' });
  await groupManager.getByLabel('新增組別名稱').fill(name);
  await groupManager
    .getByRole('button', { name: '新增組別', exact: true })
    .click();
  await expect(page.getByRole('list', { name: '組別清單' })).toContainText(
    name,
  );
}

test('US1／US3：老師 closed 下載 Guided Notes 與 CSV，學生沒有按鈕（T013、T024、T030）', async ({
  browser,
}, testInfo) => {
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const suffix = String(Date.now()).slice(-6);
    const groupName = `匯出驗證組${suffix}`;
    await addGroup(teacherPage, groupName);
    await importQuestions(teacherPage);

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage.getByRole('button', { name: groupName, exact: true }).click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    await teacherPage.getByRole('button', { name: '開啟搶答', exact: true }).click();
    await expect(studentPage.getByText('目前階段：搶答中')).toBeVisible();
    const answer = `e2e 匯出勝出答案 ${suffix}`;
    const question = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await question.getByLabel('第 1 題答案', { exact: true }).fill(answer);
    await question.getByRole('button', { name: '送出第 1 題', exact: true }).click();
    await expect(
      question.getByText(`本組已送出：${answer}`, { exact: true }),
    ).toBeVisible({ timeout: 2_000 });

    await teacherPage.getByRole('button', { name: '結束搶答', exact: true }).click();
    await expect(teacherPage.getByText('目前階段：已結束')).toBeVisible();
    await expect(
      studentPage.getByRole('button', { name: '匯出 Guided Notes', exact: true }),
    ).toHaveCount(0);

    // T030：保存可由同一測試重現的 closed 老師端視覺證據。
    await mkdir(downloadDirectory, { recursive: true });
    const exportSection = teacherPage.getByRole('region', { name: '匯出結果' });
    await exportSection.scrollIntoViewIfNeeded();
    await teacherPage.screenshot({
      path: join(verificationDirectory, 'teacher-closed-full-page.png'),
      fullPage: true,
    });
    await exportSection.screenshot({
      path: join(verificationDirectory, 'teacher-closed-export-buttons.png'),
    });

    const exportedPath = testInfo.outputPath('guided-notes.xlsx');
    const downloadPromise = teacherPage.waitForEvent('download');
    await teacherPage
      .getByRole('button', { name: '匯出 Guided Notes', exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^搶答結果_\d{8}_\d{4}\.xlsx$/,
    );
    await download.saveAs(exportedPath);

    const bytes = await readFile(exportedPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.getWorksheet('學習單');
    expect(worksheet?.getCell('G5').text).toBe(answer);
    expect(worksheet?.getCell('G7').text).toBe('');
    expect(bytes.length).toBeGreaterThan(2_000);
    await copyFile(
      exportedPath,
      join(downloadDirectory, 'guided-notes.xlsx'),
    );

    const csvPath = testInfo.outputPath('results.csv');
    const csvDownloadPromise = teacherPage.waitForEvent('download');
    await teacherPage.getByRole('button', { name: '匯出 CSV', exact: true }).click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(
      /^搶答結果_\d{8}_\d{4}\.csv$/,
    );
    await csvDownload.saveAs(csvPath);
    const csvBytes = await readFile(csvPath);
    await copyFile(csvPath, join(downloadDirectory, 'results.csv'));
    expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvLines = csvBytes.subarray(3).toString('utf8').split('\r\n');
    expect(csvLines).toHaveLength(2);
    expect(csvLines[0]).toBe(
      '題號,空格序,組別,答案,順位,是否搶答成功,送出時間',
    );
    expect(csvLines[1]).toContain(`1,1,${groupName},${answer},1,是,`);
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});
