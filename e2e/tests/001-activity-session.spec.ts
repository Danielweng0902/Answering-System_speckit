import { expect, test } from '@playwright/test';

/**
 * US1（AC-001-01、02）：老師開啟與結束搶答，老師端與兩組學生端的
 * 階段文字都同步更新。密碼由 playwright.config.ts 以隨機值注入。
 */
function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定，請透過 Playwright config 注入');
  }
  return value;
}

test('老師開啟後三個畫面顯示搶答中，結束後顯示已結束', async ({ browser }) => {
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    const studentOnePage = await studentOneContext.newPage();
    const studentTwoPage = await studentTwoContext.newPage();

    // 老師登入並建立兩個立即使用的組別；第三組留在準備階段建立，
    // 供下一個測試在共用資料庫已結束後登入一個獨立組別。
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();

    await expect(teacherPage.getByLabel('新增組別名稱')).toBeVisible();
    await teacherPage.getByLabel('新增組別名稱').fill('第一組');
    await teacherPage
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(
      teacherPage.getByRole('list', { name: '組別清單' }),
    ).toContainText('第一組');

    await teacherPage.getByLabel('新增組別名稱').fill('第二組');
    await teacherPage
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(
      teacherPage.getByRole('list', { name: '組別清單' }),
    ).toContainText('第二組');

    await teacherPage.getByLabel('新增組別名稱').fill('第三組');
    await teacherPage
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(
      teacherPage.getByRole('list', { name: '組別清單' }),
    ).toContainText('第三組');

    // 兩位學生各自選擇不同的組別進場。
    await studentOnePage.goto('/student');
    await studentOnePage
      .getByRole('button', { name: '第一組', exact: true })
      .click();
    await expect(studentOnePage.getByText('目前階段：準備中')).toBeVisible();
    await expect(
      studentOnePage.getByText('第一組', { exact: true }),
    ).toBeVisible();

    await studentTwoPage.goto('/student');
    await studentTwoPage
      .getByRole('button', { name: '第二組', exact: true })
      .click();
    await expect(studentTwoPage.getByText('目前階段：準備中')).toBeVisible();

    // 老師開啟搶答，三個頁面都顯示搶答中。
    await teacherPage.getByRole('button', { name: '開啟搶答' }).click();
    await expect(teacherPage.getByText('目前階段：搶答中')).toBeVisible();
    await expect(studentOnePage.getByText('目前階段：搶答中')).toBeVisible();
    await expect(studentTwoPage.getByText('目前階段：搶答中')).toBeVisible();

    // 老師結束搶答，三個頁面都顯示已結束。
    await teacherPage.getByRole('button', { name: '結束搶答' }).click();
    await expect(teacherPage.getByText('目前階段：已結束')).toBeVisible();
    await expect(studentOnePage.getByText('目前階段：已結束')).toBeVisible();
    await expect(studentTwoPage.getByText('目前階段：已結束')).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
  }
});

test('重新整理後學生保留組別與目前階段，老師保留登入身分', async ({
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

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage
      .getByRole('button', { name: '第三組', exact: true })
      .click();
    await expect(
      studentPage.getByText('第三組', { exact: true }),
    ).toBeVisible();

    // E2E 全部測試共用同一個伺服器；上一個測試已把活動推進到 closed，
    // 而「重設活動」屬 Phase 8，因此此輪驗證已結束階段的重新整理。
    await expect(studentPage.getByText('目前階段：已結束')).toBeVisible();

    await studentPage.reload();
    await expect(
      studentPage.getByText('第三組', { exact: true }),
    ).toBeVisible();
    await expect(studentPage.getByText('目前階段：已結束')).toBeVisible();

    await teacherPage.reload();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await expect(teacherPage.getByLabel('老師密碼')).not.toBeVisible();
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});
