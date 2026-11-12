import { expect, test } from '@playwright/test';
import { importQuestions } from './helpers.js';

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

    // 伺服器要求先確認題目才能開啟搶答。
    await importQuestions(teacherPage);

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

/**
 * T074：依 quickstart 人工驗證表的 12 個步驟走完整流程。
 * 略過／調整的步驟在各處以註解說明：
 * - e2e 所有測試共用同一個伺服器與資料庫且依序執行，進場時活動已是
 *   「已結束」，先以「重設活動」→「確認重設」回到準備中。
 * - 步驟 3（無組別拒絕開啟）：共用資料庫通常已有前面測試建立的組別，
 *   只有組別清單為空時才驗證。
 * - 步驟 10 改為老師手動「結束搶答」，不實際等待 30 秒倒數歸零
 *   （倒數歸零自動結束已由 server countdown 整合測試涵蓋）。
 * - 步驟 11（重新啟動伺服器）無法在 e2e 中共用伺服器上進行，略過；
 *   持久化行為由 server restart 整合測試涵蓋。
 */
test('quickstart 人工驗證表流程：登入、設組、倒數開啟、結束、重設', async ({
  browser,
}) => {
  const WRONG_PASSWORD_ATTEMPT = '這不是老師密碼';
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    const studentOnePage = await studentOneContext.newPage();
    const studentTwoPage = await studentTwoContext.newPage();

    // 步驟 1：錯誤密碼被拒絕，留在登入畫面（AC-001-12）。
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(WRONG_PASSWORD_ATTEMPT);
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(teacherPage.getByRole('alert')).toContainText('密碼錯誤');
    await expect(teacherPage.getByLabel('老師密碼')).toBeVisible();

    // 步驟 2：正確密碼進入老師端（AC-001-11）。
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(teacherPage.getByLabel('新增組別名稱')).toBeVisible();

    // 準備：共用資料庫下前一個測試已把活動推到「已結束」，先重設回準備中。
    const phaseText = await teacherPage
      .getByText(/^目前階段：/)
      .textContent();
    if (phaseText?.includes('已結束')) {
      await teacherPage.getByRole('button', { name: '重設活動' }).click();
      await teacherPage.getByRole('button', { name: '確認重設' }).click();
    }
    await expect(teacherPage.getByText('目前階段：準備中')).toBeVisible();

    // 學生 B、C 開啟學生端待命。
    await studentOnePage.goto('/student');
    await studentTwoPage.goto('/student');

    // 步驟 3：沒有組別時開啟搶答會被拒絕並提示先建立組別（AC-001-04）。
    // 共用資料庫通常已有前面測試建立的組別；此情境已由 server 的
    // activity:open 整合測試涵蓋，只在清單剛好為空時順帶驗證。
    const groupList = teacherPage.getByRole('list', { name: '組別清單' });
    const phaseControl = teacherPage.getByRole('region', { name: '搶答控制' });
    if ((await groupList.getByRole('listitem').count()) === 0) {
      await phaseControl.getByRole('button', { name: '開啟搶答' }).click();
      await expect(phaseControl.getByRole('alert')).toContainText(
        '請先建立至少一個組別',
      );
      await expect(teacherPage.getByText('目前階段：準備中')).toBeVisible();
    }

    // 步驟 4：新增「甲組」「乙組」（用新組名避免與前面的測試重複），
    // B、C 的組別選單在 2 秒內出現兩組（AC-001-14、06）。
    const groupManager = teacherPage.getByRole('region', { name: '組別管理' });
    await groupManager.getByLabel('新增組別名稱').fill('甲組');
    await groupManager
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(groupList).toContainText('甲組');
    await groupManager.getByLabel('新增組別名稱').fill('乙組');
    await groupManager
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(groupList).toContainText('乙組');
    for (const page of [studentOnePage, studentTwoPage]) {
      const picker = page.getByRole('list', { name: '可選組別' });
      await expect(picker).toContainText('甲組');
      await expect(picker).toContainText('乙組');
    }

    // 步驟 5：空白、重複、超過 30 字的組名各自被拒絕並說明原因（AC-001-15）。
    await groupManager.getByLabel('新增組別名稱').fill('   ');
    await groupManager
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(groupManager.getByRole('alert')).toContainText('請輸入組名');

    await groupManager.getByLabel('新增組別名稱').fill('甲組');
    await groupManager
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(groupManager.getByRole('alert')).toContainText(
      '已經有同名的組別',
    );

    await groupManager.getByLabel('新增組別名稱').fill('組'.repeat(31));
    await groupManager
      .getByRole('button', { name: '新增組別', exact: true })
      .click();
    await expect(groupManager.getByRole('alert')).toContainText(
      '組名最多 30 個字',
    );

    // 步驟 6：B 選甲組、C 選乙組，各自顯示組名與「準備中」（AC-001-07）。
    await studentOnePage
      .getByRole('button', { name: '甲組', exact: true })
      .click();
    await expect(
      studentOnePage.getByText('甲組', { exact: true }),
    ).toBeVisible();
    await expect(studentOnePage.getByText('目前階段：準備中')).toBeVisible();
    await studentTwoPage
      .getByRole('button', { name: '乙組', exact: true })
      .click();
    await expect(
      studentTwoPage.getByText('乙組', { exact: true }),
    ).toBeVisible();
    await expect(studentTwoPage.getByText('目前階段：準備中')).toBeVisible();

    // 002 起開啟搶答前必須先有題目；自行匯入，不依賴其他測試留下的狀態。
    await importQuestions(teacherPage);

    // 步驟 7：以 30 秒倒數開啟搶答，三個畫面 2 秒內顯示搶答中，
    // 剩餘時間相差不超過 1 秒（都在 29–30 秒）（AC-001-01、22）。
    await phaseControl.getByLabel('設定倒數').check();
    await phaseControl.getByLabel('倒數秒數').fill('30');
    await phaseControl.getByRole('button', { name: '開啟搶答' }).click();
    for (const page of [teacherPage, studentOnePage, studentTwoPage]) {
      await expect(page.getByText('目前階段：搶答中')).toBeVisible();
      await expect(page.getByRole('timer')).toHaveText(
        /^剩餘時間 00:(29|30)$/,
      );
    }

    // 步驟 8：B 重新整理頁面，仍是甲組、搶答中（AC-001-18）。
    await studentOnePage.reload();
    await expect(
      studentOnePage.getByText('甲組', { exact: true }),
    ).toBeVisible();
    await expect(studentOnePage.getByText('目前階段：搶答中')).toBeVisible();

    // 步驟 9：搶答中嘗試新增組別被拒絕（AC-001-16）——
    // 介面上組別管理的控制項在搶答中整組停用（FR-010），組別清單不變。
    await expect(groupManager.getByLabel('新增組別名稱')).toBeDisabled();
    await expect(
      groupManager.getByRole('button', { name: '新增組別', exact: true }),
    ).toBeDisabled();
    await expect(groupList).toContainText('甲組');
    await expect(groupList).toContainText('乙組');

    // 步驟 10（調整）：quickstart 為等 30 秒倒數歸零自動結束；為節省 e2e
    // 時間改由老師按「結束搶答」，三個畫面 2 秒內顯示已結束（AC-001-02、24）。
    // 倒數歸零自動結束已由 server countdown 整合測試涵蓋。
    await phaseControl.getByRole('button', { name: '結束搶答' }).click();
    for (const page of [teacherPage, studentOnePage, studentTwoPage]) {
      await expect(page.getByText('目前階段：已結束')).toBeVisible();
    }

    // 步驟 11（略過）：重新啟動伺服器無法在 e2e 共用的伺服器上進行；
    // 重啟後階段與組別一致由 server 的 restart 整合測試涵蓋（AC-001-21）。

    // 步驟 12：重設活動並確認，三個畫面回到準備中，組別保留（AC-001-27）。
    await phaseControl.getByRole('button', { name: '重設活動' }).click();
    await phaseControl.getByRole('button', { name: '確認重設' }).click();
    for (const page of [teacherPage, studentOnePage, studentTwoPage]) {
      await expect(page.getByText('目前階段：準備中')).toBeVisible();
    }
    await expect(groupList).toContainText('甲組');
    await expect(groupList).toContainText('乙組');
    await expect(
      studentOnePage.getByText('甲組', { exact: true }),
    ).toBeVisible();
    await expect(
      studentTwoPage.getByText('乙組', { exact: true }),
    ).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
  }
});
