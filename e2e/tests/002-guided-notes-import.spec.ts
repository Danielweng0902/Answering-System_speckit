import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
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
const STUDENT_GROUP_NAME = '匯入測試組';

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

/** 本檔的測試接續前一個測試的狀態；搶答中或已結束先重設回準備中（題目保留）。 */
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

/** 單獨執行本測試時題庫可能為空，先匯入 01 讓「已有題目」成立。 */
async function ensureQuestionsImported(page: Page): Promise<void> {
  const questionList = page.getByRole('region', { name: '題目清單' });
  if (
    await questionList.getByText('尚未匯入題目', { exact: true }).isVisible()
  ) {
    await importQuestions(page);
  }
}

test('老師查看摘要、取消後再確認，學生看不到題目且可以開啟搶答', async ({
  browser,
}) => {
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

    // 此檔排在 001 後執行，共用活動可能已結束；重設會保留題目與組別。
    if (await teacherPage.getByText('目前階段：搶答中').isVisible()) {
      await teacherPage
        .getByRole('button', { name: '結束搶答', exact: true })
        .click();
      await expect(teacherPage.getByText('目前階段：已結束')).toBeVisible();
    }
    if (await teacherPage.getByText('目前階段：已結束').isVisible()) {
      await teacherPage
        .getByRole('button', { name: '重設活動', exact: true })
        .click();
      await teacherPage
        .getByRole('button', { name: '確認重設', exact: true })
        .click();
      await expect(teacherPage.getByText('目前階段：準備中')).toBeVisible();
    }

    const groupManager = teacherPage.getByRole('region', { name: '組別管理' });
    if (
      !(await groupManager
        .getByText(STUDENT_GROUP_NAME, { exact: true })
        .isVisible())
    ) {
      await teacherPage.getByLabel('新增組別名稱').fill(STUDENT_GROUP_NAME);
      await teacherPage
        .getByRole('button', { name: '新增組別', exact: true })
        .click();
    }
    await expect(
      teacherPage.getByRole('list', { name: '組別清單' }),
    ).toContainText(STUDENT_GROUP_NAME);

    const questionList = teacherPage.getByRole('region', {
      name: '題目清單',
    });
    const hadNoQuestions = await questionList
      .getByText('尚未匯入題目', { exact: true })
      .isVisible();
    const questionsBeforePreview = await questionList.textContent();

    // 001 可能已匯入題目；只有確實處於空題庫時才驗證此錯誤。
    if (hadNoQuestions) {
      await teacherPage
        .getByRole('button', { name: '開啟搶答', exact: true })
        .click();
      await expect(teacherPage.getByRole('alert')).toContainText('請先匯入題目');
      await expect(teacherPage.getByText('目前階段：準備中')).toBeVisible();
    }

    await teacherPage
      .getByLabel('上傳 xlsx 檔', { exact: true })
      .setInputFiles(officialSingleFixturePath);

    const summary = teacherPage.getByRole('region', { name: '匯入摘要' });
    await expect(summary).toContainText('工作表：學習單');
    await expect(summary).toContainText('共 6 題、6 個空格');
    for (let number = 1; number <= 6; number += 1) {
      await expect(summary).toContainText(`第 ${number} 題`);
    }

    await summary.getByRole('button', { name: '取消', exact: true }).click();
    await expect(summary).not.toBeVisible();
    await expect(questionList).toHaveText(questionsBeforePreview ?? '');
    if (hadNoQuestions) {
      await expect(questionList).toContainText('尚未匯入題目');
    }

    await importQuestions(teacherPage);
    for (let number = 1; number <= 6; number += 1) {
      await expect(questionList).toContainText(`第 ${number} 題`);
    }

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage
      .getByRole('button', { name: STUDENT_GROUP_NAME, exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();
    await expect(
      studentPage.getByRole('region', { name: '題目清單' }),
    ).toHaveCount(0);
    await expect(studentPage.getByText(/第 [1-6] 題/)).toHaveCount(0);

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    await expect(teacherPage.getByText('目前階段：搶答中')).toBeVisible();
    await expect(studentPage.getByText('目前階段：搶答中')).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});

test('已有 01 的題目時上傳 02，確認後取代為 4 題並顯示題組標示', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await loginAsTeacher(teacherPage);
    await resetToPreparing(teacherPage);
    await ensureQuestionsImported(teacherPage);

    const questionList = teacherPage.getByRole('region', { name: '題目清單' });
    // 接續前一個測試時是 01 的 6 題；單獨執行時由 ensureQuestionsImported 匯入。
    await expect(questionList).toContainText('第 6 題');

    await teacherPage
      .getByLabel('上傳 xlsx 檔', { exact: true })
      .setInputFiles(officialGroupFixturePath);

    const summary = teacherPage.getByRole('region', { name: '匯入摘要' });
    await expect(summary).toContainText('確認後會取代現有題目');
    await expect(summary).toContainText('工作表：學習單');
    await expect(summary).toContainText('共 4 題、6 個空格');
    await expect(summary).toContainText('第 1、2 題是題組');
    await expect(summary).toContainText('第 1 題（題組，2 個空格）');
    await expect(summary).toContainText('第 3 題（單題，1 個空格）');
    await expect(summary).toContainText('前綴：（1）、（2）');

    await summary
      .getByRole('button', { name: '確認匯入', exact: true })
      .click();
    await expect(summary).not.toBeVisible();

    const items = questionList
      .getByRole('list', { name: '已匯入題目' })
      .getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(questionList).toContainText('第 4 題');
    await expect(questionList).toContainText('題組，2 個空格');
    await expect(questionList).toContainText('單題，1 個空格');
    await expect(questionList).not.toContainText('第 5 題');
    await expect(questionList).not.toContainText('第 6 題');
  } finally {
    await teacherContext.close();
  }
});

test('已有題目時上傳 91，看到題號 3 重複的訊息且題目清單不變', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await loginAsTeacher(teacherPage);
    await resetToPreparing(teacherPage);
    await ensureQuestionsImported(teacherPage);

    const questionList = teacherPage.getByRole('region', { name: '題目清單' });
    const questionsBeforeFailure = await questionList.textContent();

    await teacherPage
      .getByLabel('上傳 xlsx 檔', { exact: true })
      .setInputFiles(duplicateNumberFixturePath);

    await expect(teacherPage.getByRole('alert')).toContainText('題號 3 重複');
    await expect(
      teacherPage.getByRole('region', { name: '匯入摘要' }),
    ).toHaveCount(0);
    await expect(questionList).toHaveText(questionsBeforeFailure ?? '');
  } finally {
    await teacherContext.close();
  }
});
